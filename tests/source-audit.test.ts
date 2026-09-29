import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockedUrlError } from '../src/net/url-guard.js';
import { classifyGitError, RepoError, validateRepoUrl } from '../src/source/repo.js';
import { buildSourceReport } from '../src/source/report.js';
import { executeSourceAudit } from '../src/source/run.js';
import { resolveRef, buildIndex } from '../src/source/refs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'source', 'sit statik ë ç');
const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});
/** Dosje e përkohshme me hapësira dhe ë/ç në emër. */
function tempDir(name = 'projekt ë ç me hapësira'): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'src-audit-'));
  temps.push(base);
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function write(dir: string, rel: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
/** Kopje rekursive. (fs.cpSync në Node 24.11/Windows e rrëzon procesin me shtigje si "ë ç".) */
function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}
const where = (r: { findings: { code: string; file: string; line?: number }[] }, code: string) => r.findings.filter((f) => f.code === code).map((f) => `${f.file}${f.line ? `:${f.line}` : ''}`);

describe('Audit i dosjes: projekt statik shembull (shteg me hapësira dhe ë/ç)', () => {
  it('çdo gjetje ka path relativ, rresht kur njihet, provë dhe sugjerim', async () => {
    const r = await executeSourceAudit({ kind: 'folder', target: FIXTURE });
    expect(r.project).toMatchObject({ type: 'static', webRoot: '' });
    expect(where(r, 'MISSING_LOCAL_ASSET')).toEqual(['assets/stil.css:3', 'index.html:15']);
    expect(where(r, 'BROKEN_LOCAL_LINK')).toEqual(['index.html:11']);
    expect(where(r, 'LOCAL_PATH_CASE_MISMATCH')).toEqual(['index.html:16']);
    expect(where(r, 'LOCAL_PATH_OUTSIDE_ROOT')).toEqual(['galeria.html:12']);
    expect(where(r, 'IMG_MISSING_ALT')).toEqual(['index.html:15']);
    expect(where(r, 'ROBOTS_BLOCKS_ALL')).toEqual(['robots.txt:2']);
    expect(where(r, 'MISSING_META_DESCRIPTION')).toEqual(['rreth nesh.html:3']);
    expect(where(r, 'MISSING_H1')).toEqual(['rreth nesh.html']); // pa element → pa rresht të shpikur
    expect(where(r, 'SITEMAP_LOC_NOT_IN_FILES')).toEqual(['sitemap.xml:5']);
    const dup = r.findings.find((f) => f.code === 'DUPLICATE_TITLE')!;
    expect(dup).toMatchObject({ file: 'galeria.html', line: 5, related: [{ file: 'rreth nesh.html', line: 5 }] });
    for (const f of r.findings) {
      expect(f.file, f.code).not.toMatch(/\\|^[A-Z]:/); // relativ, me "/"
      expect(f.evidence, f.code).toBeTruthy();
      expect(f.suggestion, f.code).toBeTruthy();
    }
    // "rreth%20nesh.html" dhe url(../img/foto%20%C3%AB.png) zgjidhen (s'janë të prishura)
    expect(r.findings.some((f) => /rreth%20nesh|foto%20/.test(f.evidence))).toBe(false);
    expect(r.checks.find((c) => c.id === 'local-links')!.observations!.join(' ')).toMatch(/1 linke pa \.html u zgjidhën me fallback/);
  });

  it('raporti: i ndarë nga auditi i URL-së — pa Health Score/Lighthouse, me burimin dhe mbulimin', async () => {
    const rep = buildSourceReport(await executeSourceAudit({ kind: 'folder', target: FIXTURE }));
    expect(rep).toMatchObject({ reportType: 'source-audit', reportSchemaVersion: 'source-1', source: { kind: 'folder', name: 'sit statik ë ç' } });
    expect(rep).not.toHaveProperty('health');
    expect(rep).not.toHaveProperty('lighthouse');
    expect(rep).not.toHaveProperty('categories');
    expect(rep.scope).toMatch(/Pa Health Score, pa Lighthouse/);
    expect(rep.coverage).toMatchObject({ htmlFiles: 4, htmlRead: 4, truncated: false });
    expect(rep.notFromFiles.map((n) => n.check)).toEqual(expect.arrayContaining(['Health Score', 'Performance / Lighthouse']));
  });
});

describe('Audit i dosjes: raste kufitare', () => {
  it('symlink/junction që del jashtë dosjes s\'ndiqet: asgjë nga jashtë s\'lexohet', async () => {
    const dir = tempDir();
    const outside = path.join(path.dirname(dir), 'jashte');
    write(outside, 'sekret.html', `<html><body>${'sk_live_' + 'a'.repeat(24)}</body></html>`);
    write(dir, 'index.html', '<!doctype html><html lang="sq"><head><title>Faqja kryesore e testit</title><meta name="viewport" content="width=device-width"><meta name="description" content="d"></head><body><h1>x</h1></body></html>');
    fs.symlinkSync(outside, path.join(dir, 'lidhje jashtë'), 'junction');
    fs.mkdirSync(path.join(dir, 'brenda'));
    fs.symlinkSync(path.join(dir, 'brenda'), path.join(dir, 'lak'), 'junction');
    const r = await executeSourceAudit({ kind: 'folder', target: dir });
    expect(where(r, 'SYMLINK_OUTSIDE_ROOT')).toEqual(['lidhje jashtë']);
    expect(r.coverage.skipped.symlink!.examples).toEqual(['lak (brenda)']);
    expect(r.findings.some((f) => f.code === 'POSSIBLE_SECRET')).toBe(false);
    expect(r.coverage.filesSeen).toBe(1);
  });

  it('skedarë të mëdhenj: HTML mbi kufirin s\'lexohet (partial, me arsye); imazh 1.2 MB → LARGE_IMAGE', async () => {
    const dir = tempDir();
    write(dir, 'index.html', '<!doctype html><html lang="sq"><head><title>Faqja kryesore e testit</title><meta name="viewport" content="width=device-width"><meta name="description" content="d"></head><body><h1>x</h1><img src="foto.jpg" alt="f"></body></html>');
    write(dir, 'e-madhe.html', `<html><body>${'<p>tekst</p>'.repeat(10_000)}</body></html>`);
    write(dir, 'foto.jpg', Buffer.alloc(1_250_000, 1));
    const r = await executeSourceAudit({ kind: 'folder', target: dir }, { limits: { maxFileBytes: 64 * 1024 } });
    expect(r.coverage.skipped['too-large']!.examples[0]).toMatch(/^e-madhe\.html \(\d+ KB\)$/);
    expect(r.coverage).toMatchObject({ htmlFiles: 2, htmlRead: 1, truncated: true });
    expect(r.checks.find((c) => c.id === 'html-seo')!.observations!.join(' ')).toMatch(/1 HTML mbi kufirin e leximit s'u kontrolluan: e-madhe\.html/);
    expect(r.findings.find((f) => f.code === 'LARGE_IMAGE')).toMatchObject({ file: 'foto.jpg', severity: 'medium' });
    expect(r.findings.some((f) => f.file === 'e-madhe.html')).toBe(false); // s'ka gjetje nga përmbajtje e palexuar
  });

  it('kufiri i numrit të skedarëve → truncated, me listën e të anashkaluarve', async () => {
    const dir = tempDir();
    for (let i = 0; i < 12; i++) write(dir, `f${String(i).padStart(2, '0')}.txt`, 'x');
    const r = await executeSourceAudit({ kind: 'folder', target: dir }, { limits: { maxFiles: 5 } });
    expect(r.coverage).toMatchObject({ filesSeen: 5, truncated: true });
    expect(r.coverage.skipped['max-files']!.count).toBe(7);
  });

  it('pa HTML: kontrollet e HTML-së skipped me arsye, jo "pass"; projekt unknown', async () => {
    const dir = tempDir();
    write(dir, 'README.md', '# Vetëm dokumentim');
    write(dir, 'app.js', 'console.log(1)');
    const rep = buildSourceReport(await executeSourceAudit({ kind: 'folder', target: dir }));
    expect(rep.project.type).toBe('unknown');
    for (const id of ['html-seo', 'local-links', 'duplicates']) {
      expect(rep.checks.find((c) => c.id === id)).toMatchObject({ status: 'skipped', reason: "S'u gjet asnjë skedar HTML në dosje." });
    }
    expect(rep.status).toBe('partial');
    expect(rep.findings).toEqual([]);
  });

  it('Next.js: HTML kërkon build → skipped me udhëzim; robots nga public/; .env lokal jashtë public/ s\'raportohet', async () => {
    const dir = tempDir();
    write(dir, 'package.json', JSON.stringify({ name: 'x', scripts: { build: 'next build' }, dependencies: { next: '15.0.0', react: '19.0.0' } }));
    write(dir, 'next.config.mjs', 'export default {};');
    write(dir, 'app/page.tsx', 'export default function Page() { return <h1>Hi</h1>; }');
    write(dir, 'public/robots.txt', 'User-agent: *\nDisallow: /\n');
    write(dir, '.env', 'SECRET=abc');
    write(dir, 'public/.env', 'SECRET=abc');
    const r = await executeSourceAudit({ kind: 'folder', target: dir });
    expect(r.project).toMatchObject({ type: 'nextjs', webRoot: 'public' });
    expect(r.project.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.checks.find((c) => c.id === 'html-seo')).toMatchObject({ status: 'skipped' });
    expect(r.checks.find((c) => c.id === 'html-seo')!.reason).toMatch(/Next\.js: faqet renderohen nga React \(build\/server\).*Ekzekuto build vetë dhe audito output-in \(out\//);
    expect(where(r, 'ROBOTS_BLOCKS_ALL')).toEqual(['public/robots.txt:2']);
    expect(where(r, 'SENSITIVE_FILE')).toEqual(['public/.env']);
  });

  it('sekretet maskohen gjithmonë; .env në sit statik raportohet', async () => {
    const dir = tempDir();
    const key = 'sk_live_' + 'Z9'.repeat(12);
    write(dir, 'index.html', '<!doctype html><html lang="sq"><head><title>Faqja kryesore e testit</title><meta name="viewport" content="width=device-width"><meta name="description" content="d"></head><body><h1>x</h1></body></html>');
    write(dir, '.env', `STRIPE=${key}\n`);
    write(dir, 'js/app.js', `\n\nconst k = "${key}";\n`);
    const r = await executeSourceAudit({ kind: 'folder', target: dir });
    expect(where(r, 'SENSITIVE_FILE')).toEqual(['.env']);
    expect(where(r, 'POSSIBLE_SECRET').sort()).toEqual(['.env:1', 'js/app.js:3']);
    expect(JSON.stringify(buildSourceReport(r))).not.toContain(key);
    expect(r.findings.find((f) => f.file === 'js/app.js')!.evidence).toBe('sk_l…(32 karaktere, i maskuar)');
  });

  it('Git LFS pointer → i anashkaluar me arsye (repo i paplotë), jo imazh "i vogël"', async () => {
    const dir = tempDir();
    write(dir, 'img/foto.png', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123456\n');
    const r = await executeSourceAudit({ kind: 'folder', target: dir });
    expect(r.coverage.skipped['lfs-pointer']!.examples).toEqual(['img/foto.png']);
  });

  it('dosje që s\'ekziston → gabim i qartë', async () => {
    await expect(executeSourceAudit({ kind: 'folder', target: path.join(os.tmpdir(), 'nuk-ekziston-ë-ç') })).rejects.toThrow(/^Dosja s'u gjet/);
  });
});

describe('resolveRef', () => {
  const index = buildIndex([{ rel: 'a b/ë.html', abs: '', size: 1, ext: '.html' }, { rel: 'docs/index.html', abs: '', size: 1, ext: '.html' }, { rel: 'rreth.html', abs: '', size: 1, ext: '.html' }]);
  it('dekodim %20/UTF-8, dosje → index.html, fallback .html, skema të jashtme/placeholder', () => {
    expect(resolveRef('a%20b/%C3%AB.html', 'x.html', '', index)).toMatchObject({ status: 'ok', target: 'a b/ë.html' });
    expect(resolveRef('/docs/', 'a b/ë.html', '', index)).toMatchObject({ status: 'ok', target: 'docs/index.html' });
    expect(resolveRef('rreth', 'x.html', '', index)).toMatchObject({ status: 'ok', fallback: true });
    expect(resolveRef('https://e.com/x', 'x.html', '', index).status).toBe('external');
    expect(resolveRef('{{ url }}', 'x.html', '', index).status).toBe('skip');
    expect(resolveRef('../../x', 'a b/ë.html', '', index).status).toBe('outside');
  });
});

describe('Audit i repo-s (kopje e përkohshme, asgjë s\'ekzekutohet)', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  function makeRepo(extra: (dir: string) => void = () => {}): { url: string; commit: string } {
    const dir = tempDir('repo burim ë');
    copyDir(FIXTURE, dir);
    extra(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
    return { url: pathToFileURL(dir).href, commit: git(dir, 'rev-parse', 'HEAD') };
  }
  const tmpClones = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('website-auditor-repo-'));

  it('klon i cekët: commit-i në raport, gjetjet me path relativ, kopja fshihet; skriptet s\'ekzekutohen', async () => {
    const marker = path.join(os.tmpdir(), `postinstall-marker-${process.pid}`);
    const { url, commit } = makeRepo((d) => {
      write(d, 'package.json', JSON.stringify({ name: 'x', scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}','x')"`, prepare: 'node -e "process.exit(1)"' } }));
      write(d, '.env.production', 'X=1');
    });
    const before = tmpClones().length;
    const r = await executeSourceAudit({ kind: 'repo', target: url }, { allowFileRepo: true });
    expect(r.source).toMatchObject({ kind: 'repo', repo: { commit, branch: 'main' } });
    expect(r.source.repo!.clone).toMatch(/depth 1/);
    expect(where(r, 'MISSING_LOCAL_ASSET')).toEqual(['assets/stil.css:3', 'index.html:15']);
    expect(r.findings.find((f) => f.code === 'SENSITIVE_FILE')).toMatchObject({ file: '.env.production', message: 'Skedar i ndjeshëm në repo: .env.production' });
    expect(r.limitations.join(' ')).toMatch(/kopje e cekët e branch-it kryesor/);
    expect(fs.existsSync(marker)).toBe(false);
    expect(tmpClones().length).toBe(before);
  }, 60_000);

  it('repo mbi kufirin e madhësisë → ndërpritet, s\'auditohet kopja e paplotë, s\'mbeten skedarë', async () => {
    const { url } = makeRepo((d) => write(d, 'e-madhe.bin', Buffer.alloc(3 * 1024 * 1024, 7)));
    const before = tmpClones().length;
    const err = await executeSourceAudit({ kind: 'repo', target: url }, { allowFileRepo: true, repoLimits: { maxBytes: 512 * 1024 } }).then(() => { throw new Error("pritej gabim"); }, (e: unknown) => e as RepoError);
    expect(err).toBeInstanceOf(RepoError);
    expect(err.code).toBe('REPO_TOO_LARGE');
    expect(err.message).toMatch(/s'u auditua|kalon kufirin/);
    expect(tmpClones().length).toBe(before);
  }, 60_000);

  it('repo që s\'ekziston/private → mesazh për konfigurim të veçantë, pa prompt kredencialesh', async () => {
    const missing = pathToFileURL(path.join(os.tmpdir(), 'asnje-repo-ketu-ë')).href;
    const err = await executeSourceAudit({ kind: 'repo', target: missing }, { allowFileRepo: true }).then(() => { throw new Error("pritej gabim"); }, (e: unknown) => e as RepoError);
    expect(err.code).toBe('REPO_PRIVATE_OR_MISSING');
    expect(err.message).toMatch(/Repo private .* kërkon konfigurim të veçantë kredencialesh/);
  }, 30_000);

  it('validimi i URL-së: vetëm https publik, pa kredenciale; SSH dhe file:// refuzohen', async () => {
    await expect(validateRepoUrl('http://github.com/a/b.git')).rejects.toMatchObject({ code: 'REPO_URL_INVALID' });
    await expect(validateRepoUrl('git@github.com:a/b.git')).rejects.toThrow(/SSH s'mbështetet.*Repo private/);
    await expect(validateRepoUrl('https://user:token@github.com/a/b.git')).rejects.toThrow(/kredenciale/);
    await expect(validateRepoUrl('file:///C:/x')).rejects.toMatchObject({ code: 'REPO_URL_INVALID' });
    await expect(validateRepoUrl('https://127.0.0.1/a.git')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(validateRepoUrl('https://localhost/a.git')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('klasifikimi i gabimeve të git-it', () => {
    expect(classifyGitError("fatal: could not read Username for 'https://github.com': terminal prompts disabled").code).toBe('REPO_PRIVATE_OR_MISSING');
    expect(classifyGitError('remote: Repository not found.\nfatal: repository \'https://github.com/a/b/\' not found').code).toBe('REPO_PRIVATE_OR_MISSING');
    expect(classifyGitError('error: RPC failed; curl 18 transfer closed\nfatal: early EOF\nfatal: index-pack failed').code).toBe('REPO_INCOMPLETE');
    expect(classifyGitError('fatal: something else').code).toBe('REPO_CLONE_FAILED');
  });
});

describe('Mbulimi: çdo skedar i listuar ka trajtim të shpjeguar', () => {
  it('shembulli: 11 = 10 tekst + 1 aset binar (vetëm stat), në JSON dhe terminal', async () => {
    const { renderSourceTerminal } = await import('../src/source/report.js');
    const rep = buildSourceReport(await executeSourceAudit({ kind: 'folder', target: FIXTURE }));
    const a = rep.coverage.accounting;
    expect(a).toMatchObject({ filesSeen: 11, readAsText: 10, statOnly: { count: 1, byExt: { '.png': 1 } }, unread: { count: 0, byReason: {} }, notListed: 0 });
    expect(a.equation).toBe('11 = 10 lexuar si tekst + 1 asete binare (vetëm stat) + 0 tekst i palexuar');
    expect(a.readAsText + a.statOnly.count + a.unread.count).toBe(a.filesSeen);
    expect(rep.coverage.filesRead).toBe(a.readAsText);
    const text = renderSourceTerminal(rep);
    expect(text).toContain('11 skedarë: 10 lexuar si tekst · 1 asete binare (vetëm stat: 1 .png) · 0 tekst i palexuar');
    expect(text).toContain("0 hyrje të anashkaluara para listimit (s'numërohen te skedarët)");
  });

  it('raste të përziera: tekst i madh i palexuar, LFS, binar, symlink — ekuacioni mbetet i saktë', async () => {
    const dir = tempDir();
    write(dir, 'index.html', '<!doctype html><html lang="sq"><head><title>Faqja kryesore e testit</title></head><body><h1>x</h1></body></html>');
    write(dir, 'e-madhe.html', 'x'.repeat(100_000));
    write(dir, 'img/lfs.png', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n');
    write(dir, 'font.woff2', Buffer.alloc(2000, 3));
    write(dir, 'data.json', Buffer.from([0x7b, 0x00, 0x7d]));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    const r = await executeSourceAudit({ kind: 'folder', target: dir }, { limits: { maxFileBytes: 64 * 1024 } });
    const a = r.coverage.accounting;
    expect(a).toMatchObject({ filesSeen: 5, readAsText: 1, statOnly: { count: 1, byExt: { '.woff2': 1 } }, unread: { count: 3, byReason: { 'too-large': 1, 'lfs-pointer': 1, binary: 1 } }, notListed: 1 });
    expect(a.readAsText + a.statOnly.count + a.unread.count).toBe(a.filesSeen);
    // çdo skedar i palexuar ka arsyen te coverage.skipped
    const listed = Object.values(r.coverage.skipped).flatMap((x) => x!.examples.map((e) => e.replace(/ \(.*\)$/, '')));
    for (const rel of ['e-madhe.html', 'img/lfs.png', 'data.json']) expect(listed).toContain(rel);
  });
});

describe('Auditi i skedarëve: cilësia e përmbajtjes', () => {
  it('paragraf i përsëritur në 3 skedarë → sinjal me skedar:rresht; pamja skipped pa ekzekutuar kod', async () => {
    const dir = tempDir();
    const para = 'Ofrojmë shërbime të personalizuara për çdo klient me vëmendje të veçantë ndaj detajeve dhe kërkesave tuaja specifike.';
    const marker = path.join(path.dirname(dir), 'js-u-ekzekutua');
    for (const [i, name] of ['a.html', 'b.html', 'c.html', 'd.html', 'e.html', 'f.html'].entries()) {
      write(dir, name, `<!doctype html>\n<html lang="sq">\n<head><title>Faqja ${name} e testit | Sit</title></head>\n<body>\n<main>\n<h1>Faqja ${name}</h1>\n${i < 3 ? `<p>${para}</p>\n` : ''}<p>Tekst unik ${i} për faqen ${name} me disa fjalë të tjera që e dallojnë.</p>\n</main>\n<script>require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')</script>\n</body>\n</html>\n`);
    }
    const r = await executeSourceAudit({ kind: 'folder', target: dir });
    const f = r.findings.find((x) => x.code === 'REPEATED_CONTENT_BLOCK')!;
    expect(f).toMatchObject({ category: 'content', file: 'a.html', line: 7, confidence: 0.5, needsManualReview: true, related: [{ file: 'b.html' }, { file: 'c.html' }] });
    expect(f.whyItMatters).toMatch(/s'provon që teksti\/dizajni është krijuar nga AI/);
    expect(r.checks.find((c) => c.id === 'content-quality')!.status).toBe('info');
    expect(r.checks.find((c) => c.id === 'visual-identity')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/do të ekzekutonte kodin\/JS e projektit/) });
    expect(fs.existsSync(marker)).toBe(false);
  });
});
