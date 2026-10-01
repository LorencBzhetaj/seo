import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVerifiedShortcut, expandEnv, installDirProblem, motwInstructions, noShortcutInstructions, OWNED, parseRegExport, pruneStale, ShortcutError } from '../src/app/setup.js';
import { findBrowser, noBrowserReason } from '../src/core/browser.js';
import { dashboardInstanceId, startDashboard, type Dashboard } from '../src/dashboard/server.js';
import { startFixtureSite, type FixtureSite } from './fixture-site.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const touch = (p: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
  return p;
};

describe('Shfletuesi për Lighthouse: Chrome i instaluar, pastaj Edge, pa paketim', () => {
  it('radha: config → CHROME_PATH → Chrome i instaluar → Edge; pa asnjë → bosh me arsye', () => {
    const cfg = touch(path.join(tmp, 'cfg', 'chrome.exe'));
    const envChrome = touch(path.join(tmp, 'env', 'chrome.exe'));
    const installed = touch(path.join(tmp, 'Google', 'Chrome', 'chrome.exe'));
    const edge = touch(path.join(tmp, 'pf86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const env = { 'PROGRAMFILES(X86)': path.join(tmp, 'pf86') };
    const none = () => [] as string[];

    expect(findBrowser(cfg, { env: { CHROME_PATH: envChrome }, chromeInstallations: none }).browser).toMatchObject({ path: cfg, source: 'config' });
    expect(findBrowser(path.join(tmp, 'mungon.exe'), { env: { CHROME_PATH: envChrome }, chromeInstallations: none })).toMatchObject({ browser: { path: envChrome, source: 'env' }, invalidConfigured: path.join(tmp, 'mungon.exe') });
    expect(findBrowser(undefined, { env, chromeInstallations: () => [path.join(tmp, 'x.exe'), installed] }).browser).toMatchObject({ path: installed, source: 'chrome', name: 'Google Chrome' });
    expect(findBrowser(undefined, { env, chromeInstallations: none }).browser).toMatchObject({ path: edge, source: 'edge', name: 'Microsoft Edge' });

    const missing = findBrowser(undefined, { env: {}, chromeInstallations: none });
    expect(missing.browser).toBeUndefined();
    expect(noBrowserReason(missing)).toMatch(/S'u gjet Chrome ose Edge.*kontrollet e tjera vazhduan/);
    const off = findBrowser(cfg, { env: { SEO_TOOL_BROWSER: 'none' }, chromeInstallations: () => [installed] });
    expect(off).toEqual({ disabled: true });
    expect(noBrowserReason(off)).toMatch(/SEO_TOOL_BROWSER=none/);
  });

  it('dashboard-i: tregon shfletuesin e gjetur, ose udhëzim kur mungon (forma e URL-së mbetet aktive)', async () => {
    const out = fs.mkdtempSync(path.join(tmp, 'out-'));
    const withEdge = await startDashboard({ outputDir: out, port: 0, findBrowser: () => ({ browser: { path: 'C:\\Edge\\msedge.exe', source: 'edge', name: 'Microsoft Edge' } }) });
    const a = await (await fetch(`${withEdge.url}audit`)).text();
    expect(a).toContain('<b>Microsoft Edge</b>');
    expect(a).toContain('Chrome s&#39;u gjet, u përdor Edge');
    expect(a).not.toContain('id="pa-shfletues"');
    await new Promise<void>((r) => withEdge.server.close(() => r()));

    const without: Dashboard & { url: string } = await startDashboard({ outputDir: out, port: 0, findBrowser: () => ({ invalidConfigured: 'D:\\gabim\\chrome.exe' }) });
    const res = await fetch(`${without.url}audit`);
    expect(res.headers.get('x-seo-tool')).toBe(dashboardInstanceId(out));
    const b = await res.text();
    expect(b).toContain('id="pa-shfletues"');
    expect(b).toContain('S&#39;u gjet Chrome ose Edge në këtë kompjuter.');
    expect(b).toContain('D:\\gabim\\chrome.exe');
    expect(b).toContain("Auditet e dosjes dhe të repo-s s'kanë nevojë për shfletues");
    expect(b).toMatch(/<button type="submit" >Nis auditin e URL-së<\/button>/);
    await new Promise<void>((r) => without.server.close(() => r()));
  });

  it('"Hap dosjen e raporteve": vetëm POST me token, hap vetëm dosjen e raporteve; pa Git → udhëzim dhe repo e çaktivizuar', async () => {
    const out = path.join(tmp, 'raportet-e-reja');
    const opened: string[] = [];
    const d = await startDashboard({ outputDir: out, port: 0, gitAvailable: () => false, findBrowser: () => ({}), openFolder: (dir) => opened.push(dir) });
    const origin = d.url.replace(/\/$/, '');
    const list = await (await fetch(d.url)).text();
    expect(list).toContain('action="/open-reports"');
    const post = (form: Record<string, string>, headers: Record<string, string> = {}) =>
      fetch(`${d.url}open-reports`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, ...headers }, body: new URLSearchParams(form) });
    expect((await post({ back: '/' })).status).toBe(403); // pa token
    expect((await post({ token: d.csrf, back: '/' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(opened).toEqual([]);
    const ok = await post({ token: d.csrf, back: '/audit', path: 'C:\\Windows' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/audit');
    expect(opened).toEqual([out]); // shtegu nga kërkesa injorohet
    expect(fs.existsSync(out)).toBe(true);
    expect((await post({ token: d.csrf, back: 'https://evil.example/' })).headers.get('location')).toBe('/');

    const form = await (await fetch(`${d.url}audit`)).text();
    expect(form).toContain('id="pa-git"');
    expect(form).toContain('git-scm.com/download/win');
    expect(form).toMatch(/<button type="submit" disabled>Nis auditin e repo-s<\/button>/);
    expect(form).toMatch(/<button type="submit" >Nis auditin e URL-së<\/button>/);
    await new Promise<void>((r) => d.server.close(() => r()));
  });

  it('identifikuesi i instancës varet nga dosja e raporteve (dev dhe programi i instaluar s\'ngatërrohen)', () => {
    expect(dashboardInstanceId('C:\\A\\output')).toBe(dashboardInstanceId('c:\\a\\OUTPUT'));
    expect(dashboardInstanceId('C:\\A\\output')).not.toBe(dashboardInstanceId('C:\\B\\output'));
    expect(dashboardInstanceId('C:\\A\\output')).not.toContain('output');
  });
});

describe('CLI pa shfletues: auditi i URL-së vazhdon pa Lighthouse dhe pa pamjen vizuale', () => {
  let site: FixtureSite;
  beforeAll(async () => {
    site = await startFixtureSite();
  });
  afterAll(() => site.close());

  it('Lighthouse/visual "skipped" me arsye; raporti shkruhet', async () => {
    const out = fs.mkdtempSync(path.join(tmp, 'cli-'));
    const { stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--progress-json', '--out', out, '--allow-local', site.host, '--max-pages', '3', '--', site.base], {
      env: { ...process.env, SEO_TOOL_BROWSER: 'none' },
    });
    expect(stderr).toMatch(/SEO_TOOL_BROWSER=none/);
    const file = fs.readdirSync(out).find((f) => f.endsWith('.json'))!;
    expect(stderr).toContain(`"file":"${file}"`);
    const report = fs.readFileSync(path.join(out, file), 'utf8');
    expect(report).toMatch(/Shfletuesi u çaktivizua \(SEO_TOOL_BROWSER=none\)/);
    expect(fs.existsSync(path.join(out, 'visual'))).toBe(false);
  }, 120_000);
});

describe('Instalimi: dosja, shkurtorja e verifikuar, shënimi nga interneti, përditësimi mbi të njëjtën dosje', () => {
  it('dosja e instalimit: refuzon dosjen e përkohshme (ZIP i pa nxjerrë), dosjen e të dhënave, rrjetin, karakteret e cmd', () => {
    const opts = { dataDir: 'C:\\Users\\a\\AppData\\Local\\SEO Tool', tempDir: 'C:\\Users\\a\\AppData\\Local\\Temp' };
    expect(installDirProblem('C:\\Programe ë ç\\SEO Tool', opts)).toBeUndefined();
    expect(installDirProblem('C:\\Users\\a\\AppData\\Local\\Programs\\SEO Tool', opts)).toBeUndefined();
    expect(installDirProblem('C:\\Users\\a\\AppData\\Local\\Temp\\Temp1_SEO-Tool.zip\\SEO Tool', opts)).toMatch(/Extract All/);
    expect(installDirProblem('C:\\Users\\a\\AppData\\Local\\SEO Tool\\program', opts)).toMatch(/dosja e raporteve/);
    expect(installDirProblem('C:\\Users\\a\\AppData\\Local', opts)).toMatch(/dosja e raporteve/);
    expect(installDirProblem('\\\\server\\share\\SEO Tool', opts)).toMatch(/rrjetit/);
    expect(installDirProblem('C:\\100%\\SEO Tool', opts)).toMatch(/karaktere/);
    // Regjistri lexohet nga `reg export` (UTF-16): ë/ç dhe \ / " të escape-uara ruhen saktë.
    const reg = '\uFEFFWindows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\X]\r\n"DisplayName"="SEO Tool"\r\n"InstallLocation"="C:\\\\Programe ë ç\\\\SEO Tool"\r\n"UninstallString"="\\"C:\\\\a b\\\\node.exe\\" uninstall"\r\n';
    expect(parseRegExport(reg, 'InstallLocation')).toBe('C:\\Programe ë ç\\SEO Tool');
    expect(parseRegExport(reg, 'UninstallString')).toBe('"C:\\a b\\node.exe" uninstall');
    expect(parseRegExport(reg, 'Mungon')).toBeUndefined();
    // REG_EXPAND_SZ (hex(2), UTF-16LE, në disa rreshta): Desktop i ridrejtuar te OneDrive
    const hex = [...Buffer.from('%USERPROFILE%\\OneDrive\\Desktop\0', 'utf16le')].map((b) => b.toString(16).padStart(2, '0'));
    const usf = `"Desktop"=hex(2):${hex.slice(0, 20).join(',')},\\\r\n  ${hex.slice(20).join(',')}\r\n"Personal"="x"\r\n`;
    expect(parseRegExport(usf, 'Desktop')).toBe('%USERPROFILE%\\OneDrive\\Desktop');
    expect(expandEnv('%USERPROFILE%\\OneDrive\\Desktop', { UserProfile: 'C:\\Users\\a' })).toBe('C:\\Users\\a\\OneDrive\\Desktop');
    expect(expandEnv('%MUNGON%\\x', {})).toBe('%MUNGON%\\x');
    // Çinstalimi fshin vetëm këto emra brenda dosjes, kurrë gjithë dosjen e përdoruesit.
    expect(OWNED).toEqual(['runtime', 'app', 'Instalo.cmd', 'Hap SEO Tool.cmd', 'seo-audit.cmd', 'LEXOME.txt', 'version.txt']);
  });

  it('përditësim mbi të njëjtën dosje: hiqen vetëm skedarët e vjetër të runtime\\ dhe app\\ që s\'janë në listën e versionit', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'prune-'));
    for (const f of ['runtime/node.exe', 'app/manifest.txt', 'app/dist/cli.js', 'app/dist/i-vjeter.js', 'app/node_modules/x-vjeter/index.js', 'shenimet e mia.txt', 'Instalo.cmd']) touch(path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'app', 'manifest.txt'), ['runtime/node.exe', 'app/manifest.txt', 'app/dist/cli.js'].join('\r\n'));
    expect(pruneStale(dir).sort()).toEqual(['app/dist/i-vjeter.js', 'app/node_modules/x-vjeter/index.js']);
    expect(fs.existsSync(path.join(dir, 'app', 'node_modules'))).toBe(false);
    for (const f of ['runtime/node.exe', 'app/dist/cli.js', 'shenimet e mia.txt', 'Instalo.cmd']) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    fs.rmSync(path.join(dir, 'app', 'manifest.txt'));
    expect(pruneStale(dir)).toEqual([]); // pa listë: s'fshihet asgjë
  });

  it('shënimi "nga interneti" s\'hiqet: udhëzim për kontrollin e burimit (SHA-256) dhe Unblock', () => {
    const t = motwInstructions(12, 'C:\\P\\SEO Tool');
    expect(t).toMatch(/s'hiqet automatikisht/);
    expect(t).toMatch(/certutil -hashfile .* SHA256/);
    expect(t).toMatch(/Properties .*Unblock/);
  });

  it.runIf(process.platform === 'win32')('shkurtorja: krijohet me WSH dhe verifikohet; pa WSH → gabim me udhëzim, pa shkurtore gjysmake', () => {
    const dir = path.join(tmp, 'Program ë ç', 'SEO Tool');
    const spec = { target: process.execPath, script: path.join(dir, 'app', 'dist', 'app', 'launch.js'), workingDir: dir, icon: process.execPath, description: 'SEO Tool' };
    const work = path.join(tmp, 'lnk');
    const lnk = buildVerifiedShortcut(spec, work);
    expect(fs.existsSync(lnk)).toBe(true);
    expect(fs.readdirSync(work)).toEqual([path.basename(lnk)]); // skripti dhe verifikimi u fshinë
    fs.rmSync(lnk);

    const prev = process.env.SEO_TOOL_CSCRIPT;
    process.env.SEO_TOOL_CSCRIPT = path.join(tmp, 's-ekziston', 'cscript.exe');
    try {
      expect(() => buildVerifiedShortcut(spec, work)).toThrow(ShortcutError);
      expect(fs.readdirSync(work)).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.SEO_TOOL_CSCRIPT;
      else process.env.SEO_TOOL_CSCRIPT = prev;
    }
    const msg = noShortcutInstructions("Windows Script Host (cscript.exe) s'punoi", dir);
    expect(msg).toMatch(/NUK u përfundua/);
    expect(msg).toContain('Hap SEO Tool.cmd');
    expect(msg).toContain(path.join(dir, 'runtime', 'node.exe'));
  });
});
