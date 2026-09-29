import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditReport } from '../src/report/json.js';
import { fixture } from './helpers.js';
import { startFixtureSite, type FixtureSite } from './fixture-site.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server: http.Server;
let host = '';
let robotsTxt = 'User-agent: *\nDisallow: /admin\n';
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-auditor-test-'));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') return void res.writeHead(200, { 'content-type': 'text/plain' }).end(robotsTxt);
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fixture('good.html'));
    if (req.url === '/leaky') {
      // Faqe që tenton të arrijë adresa lokale nga browser-i (localhost s'është në allowlist, vetëm 127.0.0.1:port)
      const port = (server.address() as AddressInfo).port;
      return void res.writeHead(200, { 'content-type': 'text/html' }).end(
        `<!doctype html><html lang="en"><head><title>Leaky page test</title></head><body><h1>x</h1><img src="http://localhost:${port}/pixel.png" alt="p"><script>fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{})</script></body></html>`,
      );
    }
    if (req.url === '/blocked/') {
      // Imiton përgjigjen reale të gjecaj.al përmes IPv6/WARP
      return void res.writeHead(403, { 'content-type': 'text/plain', server: 'cloudflare', 'cf-ray': 'test-ray-SOF' }).end('Access denied\n');
    }
    if (req.url === '/style.css') return void res.writeHead(200, { 'content-type': 'text/css' }).end('body{font-family:sans-serif}');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

function runCli(args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

describe('CLI mbi server lokal (fixture)', () => {
  it('ekzekutim me një komandë: ruan JSON, status partial pa Lighthouse, issue me prova', async () => {
    const { code, stdout, stderr } = await runCli([`http://${host}/`, '--allow-local', host, '--no-lighthouse', '--out', outDir, '--json']);
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout) as AuditReport;

    const files = fs.readdirSync(outDir).filter((f) => f.startsWith('127.0.0.1-') && f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, files[0]!), 'utf8')).runId).toBe(report.runId);

    expect(report.status).toBe('partial');
    expect(report.health!.status).toBe('PARTIAL');
    expect(report.health!.score).toBeNull();
    expect(report.categories.performance).toBeNull();
    expect(report.modules.find((m) => m.module === 'performance')!.reason).toMatch(/çaktivizua/);
    expect(report.categories.seoTechnical).toBe(100);
    expect(report.scoringVersion).toBeTruthy();
    expect(report.ruleSetVersion).toBeTruthy();

    // Faqe http → NOT_HTTPS me provë; asnjë issue pa evidence/url/fix/severity
    expect(report.issues.find((i) => i.code === 'NOT_HTTPS')).toBeDefined();
    for (const i of report.issues) {
      expect(i.evidence.length, i.code).toBeGreaterThan(0);
      expect(i.evidence[0]!.url, i.code).toMatch(/^http/);
      expect(i.fix, i.code).toBeTruthy();
      expect(['critical', 'high', 'medium', 'low']).toContain(i.severity);
    }
    // Sekretet/cookies s'ruhen; konfigurimi i ruajtur s'ka fusha sekrete
    expect(JSON.stringify(report)).not.toMatch(/set-cookie":"[^[]/);
  });

  it('përmbledhja në terminal shfaq PARTIAL, kategoritë dhe rrugën e raportit', async () => {
    const { code, stdout } = await runCli([`http://${host}/`, '--allow-local', host, '--no-lighthouse', '--out', outDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('PARTIAL');
    expect(stdout).toContain('SEO (Technical)');
    expect(stdout).toMatch(/skipped: Lighthouse u çaktivizua/);
    expect(stdout).toContain('Raporti JSON:');
  });

  it('faqja kthen 403: raport i qartë "bllokuar për këtë klient", pa SEO 100 dhe pa rekomandime header-ash', async () => {
    const json = await runCli([`http://${host}/blocked/`, '--allow-local', host, '--no-lighthouse', '--out', outDir, '--json']);
    expect(json.code, json.stderr).toBe(0);
    const report = JSON.parse(json.stdout) as AuditReport;
    expect(report.access).toMatchObject({ state: 'blocked', httpStatus: 403, provider: 'Cloudflare', requestId: 'test-ray-SOF', bodySnippet: 'Access denied' });
    expect(report.categories.seoTechnical).toBeNull();
    expect(report.categories.security).toBeNull();
    expect(report.categories.availability).toBeNull();
    expect(report.health!.critical).toBe(0);
    // Serveri i testit është http://, prandaj NOT_HTTPS (fakt protokolli) mbetet; asnjë rekomandim header-ash.
    expect(report.issues.map((i) => i.code).sort()).toEqual(['HOMEPAGE_ACCESS_DENIED', 'NOT_HTTPS']);
    expect(report.issues.find((i) => i.code === 'HOMEPAGE_ACCESS_DENIED')!.needsManualReview).toBe(true);
    expect(report.limitations[0]).toMatch(/bllokua për këtë klient/);

    const text = await runCli([`http://${host}/blocked/`, '--allow-local', host, '--no-lighthouse', '--out', outDir]);
    expect(text.stdout).toContain('AUDITI U BLLOKUA PËR KËTË KLIENT — HTTP 403');
    expect(text.stdout).toContain('Ray/ID test-ray-SOF');
    expect(text.stdout).not.toMatch(/SEO (Technical)s+100/);
    expect(text.stdout).not.toContain('MISSING_');
  });

  it("--save-lhr pa Lighthouse: s'krijohet .lhr.json dhe CLI e thotë pse", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-lhr-cli-'));
    try {
      const { code, stderr } = await runCli([`http://${host}/`, '--allow-local', host, '--no-lighthouse', '--save-lhr', '--out', dir]);
      expect(code).toBe(0);
      expect(stderr).toContain("--save-lhr: LHR s'u ruajt — Lighthouse s'dha rezultat (Lighthouse u çaktivizua");
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.lhr.json'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('host lokal pa --allow-local refuzohet (exit 2)', async () => {
    const { code, stderr } = await runCli([`http://${host}/`, '--no-lighthouse', '--out', outDir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/URL e refuzuar/);
  });

  it('skema jo-http refuzohet (exit 2)', async () => {
    const { code } = await runCli(['file:///etc/passwd', '--no-lighthouse', '--out', outDir]);
    expect(code).toBe(2);
  });

  it('robots.txt që ndalon tool-in → ndalet (exit 3); --ignore-robots e lejon dhe e raporton si critical', async () => {
    robotsTxt = 'User-agent: *\nDisallow: /\n';
    try {
      const blocked = await runCli([`http://${host}/`, '--allow-local', host, '--no-lighthouse', '--out', outDir]);
      expect(blocked.code).toBe(3);
      expect(blocked.stderr).toMatch(/--ignore-robots/);

      const { code, stdout } = await runCli([`http://${host}/`, '--allow-local', host, '--no-lighthouse', '--ignore-robots', '--out', outDir, '--json']);
      expect(code).toBe(0);
      const report = JSON.parse(stdout) as AuditReport;
      expect(report.issues[0]!.code).toBe('ROBOTS_BLOCKS_HOMEPAGE');
      expect(report.issues[0]!.severity).toBe('critical');
    } finally {
      robotsTxt = 'User-agent: *\nDisallow: /admin\n';
    }
  });

  it.runIf(process.env.RUN_LIGHTHOUSE_TESTS === '1')(
    'me Lighthouse (Chrome real përmes guard proxy): performance matet, INP unavailable',
    async () => {
      const { code, stdout, stderr } = await runCli([`http://${host}/`, '--allow-local', host, '--out', outDir, '--json'], 180_000);
      expect(code, stderr).toBe(0);
      const report = JSON.parse(stdout) as AuditReport;
      expect(report.categories.performance).not.toBeNull();
      expect(report.categories.accessibility).not.toBeNull();
      const perf = report.modules.find((m) => m.module === 'performance')!;
      expect(perf.metrics.find((m) => m.id === 'inp')!.status).toBe('unavailable');
      expect(perf.metrics.find((m) => m.id === 'lcp')!.status).toBe('measured');
      expect((report.lighthouse as { formFactor: string }).formFactor).toBe('mobile');
      // https mungon → security s'është null; health gjenerohet (asnjë kategori kyçe s'mungon)
      expect(report.health!.score).not.toBeNull();
    },
    200_000,
  );

  it.runIf(process.env.RUN_LIGHTHOUSE_TESTS === '1')(
    '--save-lhr me Lighthouse: LHR i plotë pranë raportit, i lidhur me emër',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-lhr-lh-'));
      try {
        const { code, stdout, stderr } = await runCli([`http://${host}/`, '--allow-local', host, '--save-lhr', '--out', dir, '--json'], 180_000);
        expect(code, stderr).toBe(0);
        const report = JSON.parse(stdout) as AuditReport;
        const lhrFile = (report.lighthouse as { lhrFile?: string }).lhrFile!;
        const files = fs.readdirSync(dir).sort();
        expect(files).toHaveLength(2);
        expect(files).toContain(lhrFile);
        expect(files).toContain(lhrFile.replace(/\.lhr\.json$/, '.json'));
        const lhr = JSON.parse(fs.readFileSync(path.join(dir, lhrFile), 'utf8'));
        expect(lhr.lighthouseVersion).toBeTruthy();
        expect(lhr.configSettings.formFactor).toBe('mobile');
        expect(lhr.audits.metrics.details.items[0].observedLargestContentfulPaint).toBeTypeOf('number');
        expect(stderr).toContain('LHR i plotë (lokal, mos e shpërndaj pa e kontrolluar)');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    200_000,
  );

  it.runIf(process.env.RUN_LIGHTHOUSE_TESTS === '1')(
    "browser-i i Lighthouse s'arrin localhost / IP metadata (guard proxy)",
    async () => {
      const { code, stdout, stderr } = await runCli([`http://${host}/leaky`, '--allow-local', host, '--out', outDir, '--json'], 180_000);
      expect(code, stderr).toBe(0);
      const report = JSON.parse(stdout) as AuditReport;
      const blocked = (report.lighthouse as { blockedRequests: { url: string }[] }).blockedRequests.map((b) => b.url).join(' ');
      expect(blocked).toContain('localhost');
      expect(blocked).toContain('169.254.169.254');
      expect(report.limitations.join(' ')).toMatch(/u bllokuan/);
    },
    200_000,
  );
});

describe('CLI MVP-2: crawl mbi site lokal të kontrolluar', () => {
  let site: FixtureSite;
  beforeAll(async () => {
    site = await startFixtureSite({ productPages: 5 });
  });
  afterAll(async () => {
    await site.close();
  });
  const run = (extra: string[]) => runCli([`${site.base}/`, '--allow-local', site.host, '--no-lighthouse', '--out', outDir, '--json', ...extra], 120_000);

  it('faqja hyrëse dhe site-i ndahen: Health i faqes hyrëse s\'ndryshon me crawl; site ka numrat dhe URL-të pa kontroll', async () => {
    const withCrawl = await run(['--max-pages', '10']);
    const noCrawl = await run(['--no-crawl']);
    expect(withCrawl.code, withCrawl.stderr).toBe(0);
    expect(noCrawl.code, noCrawl.stderr).toBe(0);
    const a = JSON.parse(withCrawl.stdout) as AuditReport;
    const b = JSON.parse(noCrawl.stdout) as AuditReport;

    // MVP-1 i pandryshuar
    expect(a.categories).toEqual(b.categories);
    expect(a.issues.map((i) => i.code)).toEqual(b.issues.map((i) => i.code));
    expect(a.reportSchemaVersion).toBe('3');

    // Seksioni site
    const s = a.site as Extract<AuditReport['site'], { crawl: unknown }>;
    expect(s.status).toBe('partial');
    expect(s.crawl.pagesRequested).toBe(10);
    expect(s.crawl.limits).toMatchObject({ maxPages: 10, maxDepth: 3, concurrency: 2 });
    expect(Object.keys(s.crawl.notCheckedByReason)).toEqual(expect.arrayContaining(['robots', 'unsafe', 'resource', 'max-pages']));
    expect(s.crawl.notChecked.some((n) => n.url.endsWith('/wp-login.php') && n.reason === 'unsafe')).toBe(true);
    expect(s.categories.links).not.toBeNull();
    expect(s.categoryCoverage.duplicates).toMatchObject({ partial: true, scope: 'vetëm faqet e kontrolluara — jo rezultat për gjithë sitin' });
    expect(s.scopeNote).toMatch(/^Crawl i pjesshëm: 10 nga \d+ URL/);
    expect(s.issues.length).toBeGreaterThan(0);
    for (const i of s.issues) {
      expect(i.url, i.code).toBeTruthy();
      expect(i.evidence.length, i.code).toBeGreaterThan(0);
    }
    // Issue-t e site-it s'përzihen me ato të faqes hyrëse
    expect(a.issues.some((i) => i.code === 'BROKEN_INTERNAL_LINK')).toBe(false);

    expect((b.site as { status: string; reason: string })).toMatchObject({ status: 'skipped', reason: 'Crawl-i u çaktivizua (--no-crawl)' });
  });

  it('MVP-3: seksioni business me detektim, conversion dhe privacy pa score; asnjë formë e dërguar; Health i pandryshuar', async () => {
    const before = site.requests.length;
    const withBiz = await run(['--max-pages', '10']);
    const noBiz = await run(['--max-pages', '10', '--no-business']);
    expect(withBiz.code, withBiz.stderr).toBe(0);
    const a = JSON.parse(withBiz.stdout) as AuditReport;
    const b = JSON.parse(noBiz.stdout) as AuditReport;
    // Pikëzimi i MVP-1/MVP-2 s'varet nga MVP-3
    expect(a.health).toEqual(b.health);
    expect(a.categories).toEqual(b.categories);
    expect(a.site.categories).toEqual(b.site.categories);
    expect(b.business).toMatchObject({ status: 'skipped', reason: 'Modulet e biznesit u çaktivizuan (--no-business)' });

    const biz = a.business as Extract<AuditReport['business'], { detection: unknown }>;
    const d = biz.detection as Extract<typeof biz.detection, { site: unknown }>;
    expect(d.basis).toBe('crawl');
    expect(d.site.type).toBe('unknown'); // fixture pa sinjale lloji — s'hamendësohet
    expect(d.techStack.cms).toBe('unknown');
    expect(d.pages.find((p) => p.url.endsWith('/contact'))).toMatchObject({ type: 'contact' });
    expect(a.modules.find((m) => m.module === 'privacy')).toMatchObject({ score: null, status: 'info' });
    expect(biz.privacyDisclaimer).toMatch(/nuk është vlerësim ligjor/);
    const forms = a.modules.find((m) => m.module === 'conversion')!.checks.find((c) => c.id === 'forms')!;
    expect(forms.observations!.join(' ')).toMatch(/1 faqe: kontakt — 2 fusha .*action 127\.0\.0\.1:\d+\/contact-submit/);

    // SAFE: asnjë POST, asnjë kërkesë te action-i i formës, login apo shporta
    const during = site.requests.slice(before);
    expect(during.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
    expect(during.some((r) => /contact-submit|wp-login|\/cart\//.test(r.path))).toBe(false);
  });

  it('terminali tregon seksionin e crawl-it, kufijtë dhe URL-të pa kontroll', async () => {
    const { code, stdout } = await runCli([`${site.base}/`, '--allow-local', site.host, '--no-lighthouse', '--out', outDir, '--max-pages', '6']);
    expect(code).toBe(0);
    expect(stdout).toContain('SITE — CRAWL I KUFIZUAR (MVP-2)');
    expect(stdout).toMatch(/6 faqe të kërkuara \(\d+ HTML të analizuara\)/);
    expect(stdout).toMatch(/kufij: maks 6 faqe · thellësi 3 · concurrency 2/);
    expect(stdout).toMatch(/pa kontroll: \d+ — .*ndaluar nga robots\.txt/);
    expect(stdout).toContain('TOP — GJETJE PËR SHUMË FAQE');
    // Etiketat partial duken qartë: score-t s'paraqiten si rezultat për gjithë sitin
    expect(stdout).toMatch(/Crawl i pjesshëm: 6 nga \d+ URL të zbuluara u kontrolluan/);
    expect(stdout).toMatch(/Dyfishime & canonical\s+\d+ partial — vetëm \d+\/\d+ URL, jo për gjithë sitin/);
  });

  it('--max-pages jashtë kufirit → exit 2', async () => {
    const { code, stderr } = await runCli([`${site.base}/`, '--allow-local', site.host, '--max-pages', '500']);
    expect(code).toBe(2);
    expect(stderr).toContain('--max-pages duhet të jetë numër i plotë 1–100');
  });

  it('faqja hyrëse e bllokuar (403) → crawl-i s\'niset; site skipped me arsye; asnjë score site', async () => {
    const { code, stdout } = await runCli([`http://${host}/blocked/`, '--allow-local', host, '--no-lighthouse', '--out', outDir, '--json']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as AuditReport;
    expect(report.site.status).toBe('skipped');
    expect((report.site as { reason: string }).reason).toMatch(/Crawl-i s'u nis: faqja hyrëse s'u mor realisht/);
    expect(Object.values(report.site.categories).every((v) => v === null)).toBe(true);
  });
});

describe('CLI: auditi i skedarëve (--folder / --repo)', () => {
  const FIX = path.join(ROOT, 'tests', 'fixtures', 'source', 'sit statik ë ç');

  it('--folder me hapësira dhe ë/ç: raport source-audit i veçantë, pa Health Score/Lighthouse', async () => {
    const { code, stdout, stderr } = await runCli(['--folder', FIX, '--out', outDir, '--json']);
    expect(code, stderr).toBe(0);
    const r = JSON.parse(stdout) as { reportType: string; source: { kind: string; folder: string }; findings: { file: string; line?: number }[] };
    expect(r.reportType).toBe('source-audit');
    expect(r.source).toMatchObject({ kind: 'folder', folder: FIX });
    expect(r).not.toHaveProperty('health');
    expect(r.findings.some((f) => f.file === 'index.html' && f.line === 15)).toBe(true);
    expect(fs.readdirSync(outDir).some((n) => /^source-folder-sit_statik_e_c-\d{8}-\d{6}\.json$/.test(n))).toBe(true);
    const text = await runCli(['--folder', FIX, '--out', outDir]);
    expect(text.stdout).toMatch(/SOURCE AUDIT — .*sit statik ë ç/);
    expect(text.stdout).toMatch(/pa Health Score · pa Lighthouse · asgjë s'u ekzekutua/);
    expect(text.stdout).toMatch(/ku: {4}index\.html:15/);
  }, 60_000);

  it('hyrje të pavlefshme → exit 2: dosje që s\'ekziston, repo jo-https, --folder + --repo, URL + --folder', async () => {
    expect((await runCli(['--folder', path.join(outDir, 'nuk-ekziston ë'), '--out', outDir])).code).toBe(2);
    const http = await runCli(['--repo', 'http://github.com/a/b.git', '--out', outDir]);
    expect(http.code).toBe(2);
    expect(http.stderr).toMatch(/Vetëm https:\/\//);
    expect((await runCli(['--folder', FIX, '--repo', 'https://github.com/a/b.git'])).code).toBe(2);
    expect((await runCli(['https://example.com', '--folder', FIX])).code).toBe(2);
  }, 60_000);
});
