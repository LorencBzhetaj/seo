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
