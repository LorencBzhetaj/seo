import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareReports } from '../src/dashboard/compare.js';
import { escapeHtml, externalLink, html } from '../src/dashboard/html.js';
import { startDashboard } from '../src/dashboard/server.js';
import { isReportName, listReports, readReport, screenshotPath, type Obj } from '../src/dashboard/store.js';
import { compareView, listView, sourceReportView, urlReportView, type Files } from '../src/dashboard/views.js';

// ------------------------------------------------------------ fixtures

const LH = { version: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenEmulation: { width: 412 }, hostUserAgent: 'Mozilla/5.0 HeadlessChrome/154.0.0.0', benchmarkIndex: 2500, failedAttempts: [] };
const cats = (perf: number) => ({ availability: 98, seoTechnical: 100, security: 95, performance: perf, accessibility: 94, bestPractices: 100 });
const issue = (code: string, url: string, o: Obj = {}) => ({ code, url, severity: 'medium', message: `${code} mesazh`, whyItMatters: 'pse', fix: 'si', evidence: [{ type: 'dom', url, detected: 'provë' }], module: 'seo-technical', confidence: 1, affectedPages: [url], priority: 10, needsManualReview: false, ...o });
const crawl = (pages: string[], discovered = pages.length + 10) => ({ pagesAnalyzed: pages.length, urlsDiscovered: discovered, truncated: discovered > pages.length, notCheckedByReason: { 'max-pages': { count: discovered - pages.length, meaning: 'kufiri i faqeve' } }, limits: { maxPages: pages.length }, pages: pages.map((u) => ({ url: u, finalUrl: u })) });
const PAGES = ['https://e.com/', 'https://e.com/a/', 'https://e.com/b/', 'https://e.com/c/'];

function urlReport(o: Obj = {}): Obj {
  return {
    reportSchemaVersion: '4', scoringVersion: '1.0', ruleSetVersion: '2026.09-quality1', url: 'https://e.com/', finalUrl: 'https://e.com/',
    startedAt: '2026-09-29T10:00:00.000Z', completedAt: '2026-09-29T10:02:00.000Z', status: 'completed', partialModules: [],
    lighthouse: LH, health: { score: 90, status: 'EXCELLENT', missingCategories: [] }, categories: cats(70),
    modules: [{ module: 'performance', category: 'performance', status: 'warning' }], issues: [issue('MISSING_HSTS', 'https://e.com/', { module: 'security' })], topImprovements: [],
    site: { status: 'partial', crawl: crawl(PAGES), categories: { links: 96 }, categoryCoverage: { links: { checked: 4, discovered: 14, partial: true } }, issues: [issue('MISSING_H1', 'https://e.com/a/', { module: 'onpage' })] },
    business: { status: 'partial', categories: { conversion: 100, privacy: null }, categoryCoverage: {}, issues: [] },
    quality: { status: 'partial', statuses: {}, visual: { captures: [] }, groups: [], issues: [] },
    limitations: ['Performance: një ekzekutim'],
    ...o,
  };
}

const sourceReport = (o: Obj = {}): Obj => ({
  reportSchemaVersion: 'source-1', reportType: 'source-audit', startedAt: '2026-09-29T09:00:00.000Z', completedAt: '2026-09-29T09:00:02.000Z', status: 'partial',
  source: { kind: 'folder', name: 'sit' }, project: { type: 'static', label: 'HTML statik', confidence: 0.8, htmlFiles: 2 },
  coverage: { filesSeen: 3, filesRead: 2, htmlFiles: 2, htmlRead: 2, truncated: false, skipped: { 'ignored-dir': { count: 1, meaning: 'dosje varësish', examples: ['node_modules'] } }, accounting: { equation: '3 = 2 + 1' } },
  checks: [{ id: 'html-seo', label: 'SEO në HTML', status: 'warning', observations: ['2 skedarë'] }, { id: 'visual-identity', label: 'Identiteti vizual', status: 'skipped', reason: 'Renderimi do të ekzekutonte kodin e projektit' }],
  findings: [{ code: 'BROKEN_LOCAL_LINK', category: 'links', severity: 'high', confidence: 0.9, message: 'Link i prishur', file: 'faqe/index.html', line: 12, evidence: 'href="x.html"', suggestion: 'Korrigjo' }, { code: 'MISSING_H1', category: 'seo', severity: 'medium', message: 'Pa H1', file: 'a.html', evidence: 'mungon <h1>', suggestion: 'Shto' }],
  notFromFiles: [{ check: 'Health Score', reason: 'kërkon URL' }], limitations: [],
  ...o,
});

const NO_FILES: Files = { shotExists: () => false, lhrExists: () => false };
let dir: string;
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-'));
  write('e.com-20260929-100000.json', urlReport());
  write('e.com-20260928-100000.json', urlReport({ reportSchemaVersion: '1', startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:01:00.000Z', status: 'partial', health: { score: null, status: 'PARTIAL' }, site: undefined, business: undefined, quality: undefined }));
  write('e.com-20260929-100000.lhr.json', { lighthouseVersion: '13.5.0' });
  write('source-folder-sit-20260929-090000.json', sourceReport());
  write('i-prishur.json', '{ jo json');
  write('config.json', { timeout: 1000 });
  fs.mkdirSync(path.join(dir, 'visual', 'e.com-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual', 'e.com-1', '1-home-desktop.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(path.dirname(dir), 'sekret-jashte.jpg'), 'x');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// ------------------------------------------------------------ leximi i raporteve

describe('Dashboard: leximi i raporteve nga output/', () => {
  it('liston raportet URL (edhe schema 1) dhe source; LHR s\'është raport; JSON i prishur/i huaj → "s\'u lexuan"', () => {
    const { reports, invalid } = listReports(dir);
    expect(reports.map((r) => [r.file, r.kind, r.status])).toEqual([
      ['e.com-20260929-100000.json', 'url', 'complete'],
      ['source-folder-sit-20260929-090000.json', 'folder', 'partial'],
      ['e.com-20260928-100000.json', 'url', 'partial'],
    ]);
    expect(invalid.map((i) => i.file).sort()).toEqual(['config.json', 'i-prishur.json']);
    expect(invalid.find((i) => i.file === 'config.json')!.reason).toMatch(/reportSchemaVersion/);
  });

  it('gjendja partial: raporti "complete" me crawl të pjesshëm mbetet complete, por mbulimi i sitit shënohet i pjesshëm', () => {
    const r = listReports(dir).reports.find((x) => x.file === 'e.com-20260929-100000.json')!;
    expect(r.status).toBe('complete');
    expect(r.health).toEqual({ score: 90, status: 'EXCELLENT' });
    expect(r.siteCoverage).toEqual({ checked: 4, discovered: 14, truncated: true });
    const html = urlReportView(r.file, readReport(dir, r.file).ok ? (readReport(dir, r.file) as { report: Obj }).report : {}, {}, NO_FILES);
    expect(html).toContain('Faqja hyrëse — Health Score');
    expect(html).toContain('Gjithë siti — mbulim i pjesshëm');
    expect(html).toMatch(/vetëm për faqet e kontrolluara/);
    // raporti schema 1: pa crawl, pa score → PARTIAL, pa seksion siti
    const old = (readReport(dir, 'e.com-20260928-100000.json') as { report: Obj }).report;
    expect(urlReportView('e.com-20260928-100000.json', old, {}, NO_FILES)).toContain("Ky raport (schema 1) s'ka crawl të sitit");
  });

  it('lista dallon auditin e përfunduar nga crawl-i i pjesshëm', () => {
    const out = listView(listReports(dir));
    expect(out).toContain('<th>Auditi</th>');
    expect(out).toContain('<th>Crawl-i (faqe të kontrolluara)</th>');
    expect(out).toMatch(/një audit i përfunduar mund të ketë <em>crawl të pjesshëm<\/em>/);
    // raporti i ri: audit i përfunduar + crawl i pjesshëm (4/14)
    expect(out).toMatch(/b-complete">i përfunduar<\/span><\/td>\n<td class="num">90[\s\S]*?4\/14 faqe <span class="badge b-partial">crawl i pjesshëm<\/span>/);
    // schema 1: audit i pjesshëm, pa crawl
    expect(out).toMatch(/b-partial">i pjesshëm<\/span>[\s\S]*?pa crawl \(vetëm faqja hyrëse\)/);
  });

  it('emrat dhe shtigjet: s\'lejohen "..", ndarës, LHR si raport, ose screenshot jashtë output/visual', () => {
    for (const bad of ['../package.json', '..\\x.json', 'a/b.json', 'x.lhr.json', '.hidden.json', 'x.txt', '']) expect(isReportName(bad)).toBe(false);
    expect(readReport(dir, '../package.json')).toMatchObject({ ok: false });
    expect(screenshotPath(dir, 'visual/e.com-1/1-home-desktop.jpg')).toBeTruthy();
    for (const bad of ['visual/../../sekret-jashte.jpg', 'visual/e.com-1/../../../sekret-jashte.jpg', '../sekret-jashte.jpg', 'visual/e.com-1/mungon.jpg', 'visual/e.com-1/x.svg']) expect(screenshotPath(dir, bad)).toBeUndefined();
  });

  it('auditi i skedarëve: path:line kur dihet, vetëm path kur jo; kontrollet e anashkaluara me arsye', () => {
    const html = sourceReportView('source-folder-sit-20260929-090000.json', sourceReport(), {});
    expect(html).toContain('faqe/index.html:12');
    expect(html).toMatch(/<span class="code">a\.html<\/span>/);
    expect(html).not.toContain('a.html:');
    expect(html).toMatch(/1 kontrolle u anashkaluan:<\/strong> <div>Identiteti vizual — Renderimi do të ekzekutonte kodin e projektit/);
    expect(html).toContain('pa Health Score, pa Lighthouse');
  });
});

// ------------------------------------------------------------ krahasimi

describe('Dashboard: krahasimi i dy raporteve', () => {
  const A = urlReport({ startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:00:00.000Z' });

  it('përmirësuar/përkeqësuar/brenda variacionit; issue të zgjidhura dhe të reja', () => {
    const B = urlReport({
      categories: { ...cats(67), security: 100 },
      issues: [issue('LCP_POOR', 'https://e.com/', { module: 'performance' })],
    });
    const c = compareReports('a.json', A, 'b.json', B);
    const row = (k: string) => c.scores.find((s) => s.key === k)!;
    expect(row('security')).toMatchObject({ a: 95, b: 100, delta: 5, verdict: 'improved' });
    expect(row('performance')).toMatchObject({ delta: -3, verdict: 'noise' });
    expect(c.resolved.map((i) => i.code)).toEqual(['MISSING_HSTS']);
    expect(c.added.map((i) => i.code)).toEqual(['LCP_POOR']);
    expect(c.persisted.map((i) => i.code)).toEqual(['MISSING_H1']);
  });

  it('një matje Lighthouse për raport: rritje/rënie > 5 → "e matur, kërkon konfirmim", jo "u përmirësua/përkeqësua"; edhe Health', () => {
    const up = compareReports('a.json', A, 'b.json', urlReport({ categories: cats(85), health: { score: 97, status: 'EXCELLENT', missingCategories: [] } }));
    const row = (k: string) => up.scores.find((s) => s.key === k)!;
    expect(row('performance')).toMatchObject({ delta: 15, verdict: 'measured-increase' });
    expect(row('health')).toMatchObject({ delta: 7, verdict: 'measured-increase' });
    expect(row('health').note).toMatch(/nga një ekzekutim i vetëm/);
    const view = compareView(up);
    expect(view).toContain('rritje e matur, kërkon konfirmim');
    expect(view).not.toMatch(/b-improved">u përmirësua<\/span><\/td><td class="note">një ekzekutim/);
    expect(compareView(compareReports('a.json', A, 'b.json', urlReport({ categories: cats(50) })))).toContain('rënie e matur, kërkon konfirmim');
    // kategoritë pa Lighthouse (security) mbeten "u përmirësua"
    expect(compareReports('a.json', A, 'b.json', urlReport({ categories: { ...cats(70), security: 100 } })).scores.find((s) => s.key === 'security')!.verdict).toBe('improved');
    // pragjet provizore dokumentohen në pamje
    expect(view).toContain('janë provizore, të pakalibruara');
  });

  it('gjetje Lighthouse që mungon te B → "nuk u rilevua në matjen e fundit, kërkon konfirmim", jo "u zgjidh"; gjetje jo-Lighthouse → e zgjidhur', () => {
    const withLh = urlReport({
      startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:00:00.000Z',
      issues: [issue('MISSING_HSTS', 'https://e.com/', { module: 'security' }), issue('LH_RENDER_BLOCKING', 'https://e.com/', { module: 'performance' }), issue('A11Y_COLOR_CONTRAST', 'https://e.com/', { module: 'accessibility' })],
    });
    const c = compareReports('a.json', withLh, 'b.json', urlReport({ issues: [] }));
    expect(c.resolved.map((i) => i.code)).toEqual(['MISSING_HSTS']);
    expect(c.notRedetected.map((i) => [i.code, i.reason])).toEqual([
      ['LH_RENDER_BLOCKING', 'nuk u rilevua në matjen e fundit të Lighthouse (një ekzekutim), kërkon konfirmim'],
      ['A11Y_COLOR_CONTRAST', 'nuk u rilevua në matjen e fundit të Lighthouse (një ekzekutim), kërkon konfirmim'],
    ]);
    const view = compareView(c);
    expect(view).toMatch(/Nuk u rilevua në matjen e fundit, kërkon konfirmim <span class="badge b-noise">2<\/span>/);
    expect(view).toMatch(/U zgjidhën \(në A, jo në B\) <span class="badge b-improved">1<\/span>/);
    // Lighthouse i pakrahasueshëm → mbetet "s'krahasohet", jo "nuk u rilevua"
    const other = compareReports('a.json', withLh, 'b.json', urlReport({ issues: [], lighthouse: { ...LH, version: '12.0.0' } }));
    expect(other.notRedetected).toEqual([]);
    expect(other.notComparable.map((i) => i.code)).toEqual(['LH_RENDER_BLOCKING', 'A11Y_COLOR_CONTRAST']);
  });

  it('ruleSetVersion ndryshon (ose mungon) → gjetjet që u zhdukën/u shfaqën "s\'krahasohen" me arsyen; ato që mbetën mbeten', () => {
    const B = urlReport({ ruleSetVersion: '2026.10-x', issues: [issue('LCP_POOR', 'https://e.com/', { module: 'performance' })] });
    const c = compareReports('a.json', A, 'b.json', B);
    expect(c.resolved).toEqual([]);
    expect(c.added).toEqual([]);
    expect(c.notComparable.map((i) => [i.code, i.reason])).toEqual([
      ['MISSING_HSTS', "rregullat e tool-it ndryshuan (2026.09-quality1 → 2026.10-x): s'mund të provohet që rregulli MISSING_HSTS është i njëjtë"],
      ['LCP_POOR', "rregullat e tool-it ndryshuan (2026.09-quality1 → 2026.10-x): s'mund të provohet që rregulli LCP_POOR është i njëjtë"],
    ]);
    expect(c.persisted.map((i) => i.code)).toEqual(['MISSING_H1']);
    expect(c.caveats.join(' ')).toMatch(/s'mund të provohet që rregulli është i njëjtë/);
    // pa ruleSetVersion në njërin raport: s'provohet → s'krahasohet
    const noRules = compareReports('a.json', { ...A, ruleSetVersion: undefined }, 'b.json', urlReport({ issues: [] }));
    expect(noRules.resolved).toEqual([]);
    expect(noRules.notComparable[0]!.reason).toMatch(/rregullat e tool-it ndryshuan \(\? → 2026\.09-quality1\)/);
    // me të njëjtat rregulla, e njëjta gjetje që zhduket quhet e zgjidhur
    expect(compareReports('a.json', A, 'b.json', urlReport({ issues: [] })).resolved.map((i) => i.code)).toEqual(['MISSING_HSTS']);
  });

  it('Lighthouse: përkeqësim i madh me konfigurim të njëjtë → "rënie e matur, kërkon konfirmim"; version/form factor tjetër → s\'krahasohet', () => {
    const worse = compareReports('a.json', A, 'b.json', urlReport({ categories: cats(55) }));
    expect(worse.scores.find((s) => s.key === 'performance')).toMatchObject({ verdict: 'measured-decrease' });
    expect(worse.scores.find((s) => s.key === 'performance')!.note).toMatch(/një ekzekutim Lighthouse për raport/);
    const other = compareReports('a.json', A, 'b.json', urlReport({ categories: cats(55), lighthouse: { ...LH, version: '12.0.0', formFactor: 'desktop' } }));
    expect(other.lighthouse).toMatchObject({ comparable: false });
    expect(other.lighthouse.differences).toEqual(['Versioni i Lighthouse: 13.5.0 → 12.0.0', 'Form factor: mobile → desktop']);
    for (const k of ['performance', 'accessibility', 'bestPractices', 'health']) expect(other.scores.find((s) => s.key === k)!.verdict).toBe('not-comparable');
    // kategoritë pa Lighthouse krahasohen gjithsesi
    expect(other.scores.find((s) => s.key === 'security')!.verdict).toBe('same');
  });

  it('mbulim i ndryshëm i crawl-it → kategoritë dhe gjetjet e sitit s\'krahasohen; seksion që mungon (schema 1) → s\'krahasohet', () => {
    const B = urlReport({ site: { status: 'partial', crawl: crawl(['https://e.com/', 'https://e.com/x/', 'https://e.com/y/', 'https://e.com/z/']), categories: { links: 80 }, categoryCoverage: {}, issues: [issue('MISSING_H1', 'https://e.com/x/', { module: 'onpage' })] } });
    const c = compareReports('a.json', A, 'b.json', B);
    expect(c.scores.find((s) => s.key === 'links')).toMatchObject({ a: 96, b: 80, verdict: 'not-comparable' });
    expect(c.notComparable.map((i) => [i.code, i.url, i.reason])).toEqual([
      ['MISSING_H1', 'https://e.com/a/', "faqja s'u kontrollua te B"],
      ['MISSING_H1', 'https://e.com/x/', "faqja s'u kontrollua te A"],
    ]);
    expect(c.resolved).toEqual([]);
    expect(c.caveats.join(' ')).toMatch(/1 faqe të përbashkëta \(14%\)/);

    const old = urlReport({ reportSchemaVersion: '1', site: undefined, quality: undefined });
    const q = compareReports('old.json', old, 'b.json', urlReport({ quality: { status: 'partial', issues: [issue('GENERIC_COPY', 'https://e.com/', { module: 'content-quality' })] } }));
    expect(q.notComparable.find((i) => i.code === 'GENERIC_COPY')!.reason).toBe('raporti A s\'ka seksionin "quality"');
    expect(q.scores.find((s) => s.key === 'links')!.note).toMatch(/s'ka crawl/);
  });

  it('modul i anashkaluar në njërin raport → gjetja s\'quhet e zgjidhur', () => {
    const B = urlReport({ issues: [], modules: [{ module: 'security', category: 'security', status: 'skipped' }] });
    const c = compareReports('a.json', A, 'b.json', B);
    expect(c.resolved).toEqual([]);
    expect(c.notComparable.find((i) => i.code === 'MISSING_HSTS')!.reason).toBe('moduli "security" u anashkalua te B');
  });

  it('site të ndryshme ose lloje të ndryshme → asgjë s\'krahasohet', () => {
    const c = compareReports('a.json', A, 'b.json', urlReport({ url: 'https://tjeter.com/' }));
    expect(c).toMatchObject({ sameTarget: false, scores: [], resolved: [] });
    expect(compareView(c)).toMatch(/objekte të ndryshme/);
    expect(compareReports('a.json', A, 's.json', sourceReport()).sameTarget).toBe(false);
  });
});

// ------------------------------------------------------------ përmbajtja e pabesuar

describe('Dashboard: përmbajtja e pabesuar s\'ekzekutohet', () => {
  const XSS = '<script>alert(1)</script>';
  const evil = urlReport({
    url: 'javascript:alert(document.cookie)',
    issues: [issue('X"><img src=x onerror=alert(1)>', 'javascript:alert(2)', {
      message: XSS, whyItMatters: '<iframe src="https://evil.example"></iframe>', fix: '<a href="javascript:alert(3)">kliko</a>',
      evidence: [{ type: 'dom', url: 'https://e.com/', detected: '<img src=x onerror=alert(4)>', raw: '<svg onload=alert(5)>' }, { type: 'screenshot', url: 'https://e.com/', detected: 'screenshot', raw: '../../sekret-jashte.jpg' }],
    })],
    quality: { status: 'partial', statuses: {}, visual: { captures: [{ url: 'https://e.com/', viewport: 'desktop', status: 'ok', screenshot: 'visual/"><script>alert(6)</script>.jpg' }] }, groups: [{ code: 'Q', summary: XSS, pages: ['https://e.com/'] }], issues: [issue('Q', 'https://e.com/', { message: XSS })] },
    limitations: [XSS],
  });

  it('asnjë <script>, handler, iframe apo link javascript: në HTML-në e dalë; teksti shfaqet i escape-uar', () => {
    const out = urlReportView('e.json', evil, {}, { shotExists: (rel) => rel.startsWith('visual/'), lhrExists: () => false });
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<(img|svg|iframe)[^>]*(onerror|onload|evil)/i);
    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).not.toMatch(/src="\/shot\/\.\./);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(4)&gt;');
    // URL-ja javascript: shfaqet si tekst, jo si link
    expect(out).toContain('<span class="plain">javascript:alert(document.cookie)</span>');
    // screenshot me emër të rrezikshëm: vetëm i koduar në URL, jo HTML
    expect(out).toContain('/shot/visual/%22%3E%3Cscript%3Ealert(6)%3C/script%3E.jpg');
    expect(out).not.toContain('"><script');
  });

  it('lista dhe krahasimi escape-ojnë emrat e objekteve', () => {
    const list = listView({ reports: [{ file: 'x.json', kind: 'url', target: XSS, siteKey: 'url:x', schema: '4', status: 'complete', issueCount: 0 }], invalid: [{ file: 'y.json', reason: XSS }] });
    expect(list).not.toMatch(/<script>alert/);
    expect(list.match(/&lt;script&gt;/g)).toHaveLength(2);
  });

  it('html``: vlerat escape-ohen; externalLink lejon vetëm http(s) pa kredenciale', () => {
    expect(escapeHtml(`<>&"'\``)).toBe('&lt;&gt;&amp;&quot;&#39;&#96;');
    expect(html`<p title="${'" onmouseover="x'}">${'<b>'}</p>`.value).toBe('<p title="&quot; onmouseover=&quot;x">&lt;b&gt;</p>');
    expect(externalLink('https://e.com/?a=<x>').value).toBe('<a class="ext" href="https://e.com/?a=&lt;x&gt;" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">https://e.com/?a=&lt;x&gt;</a>');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>', 'https://user:pass@e.com/', 'vbscript:x', '//e.com']) expect(externalLink(bad).value).toMatch(/^<span class="plain">/);
  });
});

// ------------------------------------------------------------ ndarja nga motori

describe('Dashboard: i ndarë nga motori i auditimit', () => {
  it('src/dashboard importon nga motori vetëm skemën, konfigurimin dhe kërkimin e shfletuesit/Git-it; motori s\'importon dashboard-in', () => {
    const src = path.resolve('src');
    const imports = (file: string) => [...fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const f of fs.readdirSync(path.join(src, 'dashboard'))) {
      for (const i of imports(path.join(src, 'dashboard', f)).filter((x) => x.startsWith('..'))) expect(['../core/schemas.js', '../core/config.js', '../core/browser.js', '../core/git.js'], f).toContain(i);
    }
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'dashboard' || e.name === 'app' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    for (const f of walk(src).filter((x) => x.endsWith('.ts'))) expect(imports(f).some((i) => i.includes('dashboard')), f).toBe(false);
  });
});

// ------------------------------------------------------------ serveri lokal

describe('Dashboard: serveri vetëm lokal dhe vetëm lexim', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    ({ server, url: base } = await startDashboard({ outputDir: dir, port: 0 }));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('dëgjon vetëm në 127.0.0.1; faqet kanë CSP pa skripte dhe nosniff', async () => {
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    const body = await res.text();
    expect(body).not.toMatch(/<script/i);
    expect(body).toContain('e.com');
  });

  it('Host i huaj (DNS rebinding) → 421; POST pa Origin/token → 403; PUT → 405', async () => {
    const http = await import('node:http');
    const port = new URL(base).port;
    const status = (method: string, host: string) => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
    expect(await status('GET', 'evil.example')).toBe(421);
    expect(await status('GET', `evil.example:${port}`)).toBe(421);
    expect(await status('POST', `127.0.0.1:${port}`)).toBe(403);
    expect(await status('PUT', `127.0.0.1:${port}`)).toBe(405);
    expect(await status('GET', `localhost:${port}`)).toBe(200);
  });

  it('screenshot brenda output/visual → image/jpeg; traversal/jashtë → 404; raport me ".." → 404', async () => {
    const ok = await fetch(`${base}shot/visual/e.com-1/1-home-desktop.jpg`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    for (const p of ['shot/visual/..%2F..%2Fsekret-jashte.jpg', 'shot/..%2Fsekret-jashte.jpg', 'report/..%2Fpackage.json', 'report/e.com-20260929-100000.lhr.json', 'lhr/..%2Fx.lhr.json']) {
      expect((await fetch(base + p)).status, p).toBe(404);
    }
  });

  it('LHR shkarkohet si attachment (s\'shfaqet si faqe); raporti hapet; krahasimi funksionon', async () => {
    const lhr = await fetch(`${base}lhr/e.com-20260929-100000.lhr.json`);
    expect(lhr.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(lhr.headers.get('content-type')).toMatch(/application\/json/);
    expect((await fetch(`${base}report/e.com-20260929-100000.json`)).status).toBe(200);
    const cmp = await (await fetch(`${base}compare?a=e.com-20260928-100000.json&b=e.com-20260929-100000.json`)).text();
    expect(cmp).toContain('Krahasimi: e.com');
    expect(cmp).toMatch(/s&#39;krahasohet/);
  });
});
