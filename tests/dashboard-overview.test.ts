import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboard } from '../src/dashboard/server.js';
import { GscStore, type Protector } from '../src/dashboard/gsc-store.js';

const memory: Protector = { kind: 'memory', protect: (d) => d, unprotect: (d) => d };

const issue = (o: Record<string, unknown>) => ({ scope: 'page', module: 'onpage', fix: 'x', evidence: [], confidence: 1, needsManualReview: false, priority: 10, ...o });
const AGENTIC = {
  status: 'ok', experimental: true, lighthouseVersion: '13.5.0', title: 'Agentic Browsing', displayMode: 'fraction', passed: 2, passable: 3, notApplicable: 4, informativeNotPassed: 0, errors: 0,
  audits: [
    { id: 'agent-accessibility-tree', title: 'Accessibility tree is well-formed', group: 'agent-accessibility', weight: 1, scoreDisplayMode: 'binary', score: 0, result: 'fail', items: ['description: Buttons must have discernible text · node: button.x'], itemsTotal: 1 },
    { id: 'llms-txt', title: 'llms.txt follows recommendations', group: 'agent-discoverability', weight: 0, scoreDisplayMode: 'notApplicable', score: null, result: 'not-applicable', items: [], itemsTotal: 0 },
  ],
};
function report(over: Record<string, unknown> = {}) {
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', url: 'https://e.com/', finalUrl: 'https://e.com/', startedAt: '2026-10-03T07:18:03Z', completedAt: '2026-10-03T07:20:40Z', status: 'completed',
    health: { score: 91, status: 'EXCELLENT', missingCategories: [] }, categories: { availability: 100, seoTechnical: 100, security: 90, performance: 76, accessibility: 94, bestPractices: 100 },
    lighthouse: { version: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', fetchTime: '2026-10-03T07:19:00Z', failedAttempts: [], seoCategory: { title: 'Lighthouse SEO', score: 92, failedAudits: [] }, agenticBrowsing: AGENTIC },
    issues: [issue({ code: 'LCP_POOR', severity: 'high', module: 'performance', url: 'https://e.com/', affectedPages: ['https://e.com/'], message: 'LCP 5.0s' })],
    site: { status: 'completed', crawl: { pagesAnalyzed: 2, urlsDiscovered: 9, truncated: true, pages: [{ url: 'https://e.com/faq/', finalUrl: 'https://e.com/faq/' }] }, issues: [] },
    ...over,
  };
}

describe('Dashboard: përmbledhja, navigimi dhe Lighthouse (Agentic Browsing)', () => {
  let server: http.Server;
  let base = '';
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-'));
  const gscDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-gsc-'));
  const get = async (p: string) => {
    const r = await fetch(base + p, { redirect: 'manual' });
    return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
  };

  beforeAll(async () => {
    fs.writeFileSync(path.join(out, 'e.com-20261003-071803.json'), JSON.stringify(report()));
    // raport i vjetër: pa seoCategory dhe pa agenticBrowsing
    const old = report({ startedAt: '2026-09-01T07:00:00Z', completedAt: '2026-09-01T07:02:00Z', lighthouse: { version: '12.8.0', formFactor: 'mobile', failedAttempts: [] } });
    fs.writeFileSync(path.join(out, 'e.com-20260901-070000.json'), JSON.stringify(old));
    // Lighthouse s'u ekzekutua: Agentic "skipped" me arsye
    fs.writeFileSync(path.join(out, 'f.com-20261002-070000.json'), JSON.stringify(report({ url: 'https://f.com/', finalUrl: 'https://f.com/', startedAt: '2026-10-02T07:00:00Z', lighthouse: { status: 'skipped', reason: 'Lighthouse u çaktivizua', agenticBrowsing: { status: 'skipped', experimental: true, reason: "Lighthouse s'dha rezultat: Lighthouse u çaktivizua" } } })));
    const store = new GscStore(path.join(gscDir, 'gsc'), memory);
    store.saveDataset({ version: 1, id: '0123456789abcdef', property: 'sc-domain:e.com', propertyType: 'domain', permissionLevel: 'siteOwner', startDate: '2026-09-23', endDate: '2026-09-29', latestFinalDate: '2026-09-29', fetchedAt: '2026-10-03T10:00:00Z', searchType: 'web', dataState: 'final', filters: [], totals: null, pages: [], pagesTruncated: false, queries: [], queriesTruncated: false, requests: 3 } as { id: string });
    const d = await startDashboard({ outputDir: out, port: 0, gsc: { store, fetch: async () => { throw new Error("s'duhet thirrur"); } } });
    server = d.server;
    base = d.url.replace(/\/$/, '');
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const d of [out, gscDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('përmbledhja: raporti i fundit i sitit, Health vetëm i faqes hyrëse, crawl i pjesshëm, GSC "pa të dhëna të kthyera" (jo 0)', async () => {
    const r = await get('/?site=url:e.com');
    expect(r.status).toBe(200);
    expect(r.body).toContain('aria-current="page">Përmbledhje');
    expect(r.body).toContain('<h2>Health Score</h2><span class="scope">Vetëm faqja hyrëse</span>');
    // sqarimet e gjata: të dukshme në desktop, te "Sqarim" (details) në ekran të ngushtë; fusha mbetet gjithmonë e dukshme
    expect(r.body).toContain('S&#39;është pikë e gjithë sitit');
    expect(r.body).toContain('<details class="kmore"><summary>Sqarim<span class="sr"> për Health Score</span></summary>');
    expect(r.body).toContain('<p class="d">2 nga 9 URL të zbuluara</p>');
    expect(r.body).toContain('<h2>Crawl i sitit</h2><span class="scope warn">I pjesshëm</span>');
    expect(r.body).toContain('2<small>/9 URL</small>');
    expect(r.body).toContain('Crawl i pjesshëm: 2 nga 9');
    expect(r.body).toContain('pa të dhëna të kthyera');
    expect(r.body).toContain('S&#39;është 0 klikime');
    // karta e klikimeve s'shfaq 0 kur API s'ktheu rresht
    expect(r.body).toContain('<h2>Klikime në Google</h2><span class="scope">GSC · <span class="pfull">2026-09-23 – 2026-09-29</span><span class="pshort">7 ditë</span></span></div><p class="v none">pa të dhëna të kthyera');
    expect(r.body).toContain('2026-09-23 – 2026-09-29');
    // pa atribute style (CSP style-src 'self') dhe pa grafikë/prirje të shpikura
    expect(r.body).not.toMatch(/\sstyle=/);
    expect(r.body).not.toMatch(/<svg|<canvas|prirje/i);
  });

  it('Lighthouse: "Lighthouse SEO" veç nga SEO teknik; Agentic Browsing si thyesë, eksperimentale, jashtë Health', async () => {
    const r = await get('/report/e.com-20261003-071803.json');
    expect(r.body).toContain('Lighthouse SEO');
    expect(r.body).toContain('92<small>/100</small>');
    expect(r.body).toContain('2/3 kontrolle të kaluara');
    expect(r.body).toContain('eksperimentale');
    expect(r.body).toContain("<strong>S'hyn në Health Score</strong>");
    expect(r.body).toContain('Buttons must have discernible text');
    // llms.txt N/A: s'shënohet si defekt
    expect(r.body).toMatch(/llms-txt<\/div><\/td><td class="note">agent-discoverability<\/td><td><span class="badge b-skipped">N\/A<\/span>/);
    // Health i raportit mbetet ai i ruajturi
    expect(r.body).toContain('91 <small>EXCELLENT</small>');
  });

  it('raport i vjetër pa këto fusha: "s\'u mat" / "s\'u ruajt", jo 0', async () => {
    const r = await get('/report/e.com-20260901-070000.json');
    expect(r.status).toBe(200);
    expect(r.body).toContain('s&#39;u mat');
    expect(r.body).toContain("s'u ruajt");
    expect(r.body).toContain('raport para Agentic Browsing');
  });

  it('Agentic Browsing "skipped" me arsyen kur Lighthouse s\'u ekzekutua', async () => {
    const r = await get('/report/f.com-20261002-070000.json');
    expect(r.body).toContain('skipped');
    expect(r.body).toContain('Lighthouse u çaktivizua');
  });

  it('navigimi: /reports lista, /tasks çon te detyrat e raportit të fundit, lidhje "Kalo te përmbajtja"', async () => {
    const l = await get('/reports');
    expect(l.body).toContain('aria-current="page">Raportet');
    expect(l.body).toContain('e.com-20260901-070000.json');
    const t = await get('/tasks?site=url:e.com');
    expect(t.status).toBe(303);
    expect(t.location).toBe('/report/e.com-20261003-071803.json/tasks');
    expect(l.body).toContain('href="#permbajtja"');
  });

  it('pa raporte: përmbledhja jep udhëzim për auditin e parë', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-empty-'));
    const d = await startDashboard({ outputDir: empty, port: 0, gsc: { store: new GscStore(path.join(empty, 'gsc'), memory) } });
    const body = await (await fetch(d.url)).text();
    await new Promise((r) => d.server.close(r));
    fs.rmSync(empty, { recursive: true, force: true });
    expect(body).toContain('Nis auditin e parë');
  });
});

describe('Dashboard: GSC me periudha të ruajtura, menuja mobile dhe kartat e tabelave', () => {
  it('konfigurimi është i mbyllur kur ka periudha; gjendja dhe fshirja (me konfirmim) janë të ndara', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-ui-'));
    const store = new GscStore(path.join(out, 'gsc'), memory);
    store.saveDataset({ version: 1, id: 'fedcba9876543210', property: 'sc-domain:e.com', propertyType: 'domain', permissionLevel: 'siteOwner', startDate: '2026-09-23', endDate: '2026-09-29', latestFinalDate: '2026-09-29', fetchedAt: '2026-10-03T10:00:00Z', searchType: 'web', dataState: 'final', filters: [], totals: { clicks: 15, impressions: 136, ctr: 0.11, position: 3 }, pages: [{ page: 'https://e.com/', clicks: 14, impressions: 136, ctr: 0.1, position: 3 }], pagesTruncated: false, queries: [{ page: 'https://e.com/', query: 'theth', clicks: 1, impressions: 8, ctr: 0.12, position: 4 }], queriesTruncated: false, requests: 3 } as { id: string });
    const d = await startDashboard({ outputDir: out, port: 0, gsc: { store } });
    const body = await (await fetch(`${d.url}gsc`)).text();
    const data = await (await fetch(`${d.url}gsc/data/fedcba9876543210`)).text();
    await new Promise((r) => d.server.close(r));
    fs.rmSync(out, { recursive: true, force: true });
    // gjendja para periudhave, periudhat para konfigurimit; konfigurimi i mbyllur
    expect(body.indexOf('id="gjendja"')).toBeLessThan(body.indexOf('id="periudhat"'));
    expect(body.indexOf('id="periudhat"')).toBeLessThan(body.indexOf('id="konfigurimi"'));
    expect(body).toMatch(/<details class="panel" id="konfigurimi" >/);
    expect(body).toContain('Konfiguro ose lidh llogarinë');
    // fshirjet: lidhje te konfirmimi (jo POST me një klik), me etiketa të qarta
    expect(body).toContain('href="/gsc/confirm?what=data">Fshi periudhat…</a>');
    expect(body).toContain('href="/gsc/confirm?what=all">Fshi gjithçka…</a>');
    expect(body).not.toMatch(/action="\/gsc\/delete-(data|all)"/);
    // dosja e testit s'është parazgjedhja: thuhet qartë
    expect(body).toContain('dosje e konfiguruar, jo parazgjedhja');
    // tabelat bëhen karta në mobile: çdo vlerë ka etiketë
    expect(data).toContain('<table class="keep cardify">');
    expect(data).toContain('data-label="Impressions">136</td>');
    expect(data).toContain('data-label="Poz. mes."');
    // menuja mobile: një <details> me faqen aktuale; navigimi i desktop-it mbetet
    // menuja në ekran të ngushtë: Popover API (pa JS; Escape dhe klikimi jashtë e mbyllin, ::backdrop e ndan nga përmbajtja)
    expect(body).toContain('<button type="button" class="mnav-btn" popovertarget="mnav" aria-controls="mnav"><span aria-hidden="true">☰</span> Menu<span class="cur"> · Search Console</span></button>');
    expect(body).toContain('<nav id="mnav" class="mnav" popover aria-label="Navigimi kryesor">');
    expect(body).toContain('<nav class="desk" aria-label="Navigimi kryesor">');
  });
});

describe('Përmbledhja: kërkimet si tabelë, detyrat me shënimet te detajet, treguesi "Vetëm lokal"', () => {
  let server: http.Server;
  let base = '';
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'overview2-'));
  const gscDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overview2-gsc-'));
  beforeAll(async () => {
    const rep = report();
    const contrast = issue({ code: 'A11Y_COLOR_CONTRAST', severity: 'medium', module: 'accessibility', url: 'https://e.com/', affectedPages: ['https://e.com/'], message: 'Background and foreground colors do not have a sufficient contrast ratio. (3 elemente)', evidence: [{ type: 'metric', url: 'https://e.com/', detected: '<div class="gj-tl__year"> src="/wp-content/uploads/tg-blocks/a.jpg"', expected: 'Strict-Transport-Security: max-age=31536000' }] });
    fs.writeFileSync(path.join(out, 'e.com-20261003-071803.json'), JSON.stringify({ ...rep, issues: [...rep.issues, contrast] }));
    const store = new GscStore(path.join(gscDir, 'gsc'), memory);
    const m =(clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
    store.saveDataset({
      version: 1, id: 'fedcba9876543210', property: 'sc-domain:e.com', propertyType: 'domain', permissionLevel: 'siteOwner', startDate: '2026-09-23', endDate: '2026-09-29', latestFinalDate: '2026-09-29', fetchedAt: '2026-10-03T10:00:00Z', searchType: 'web', dataState: 'final', filters: [],
      totals: m(15, 136, 3),
      pages: [{ page: 'https://e.com/', ...m(14, 136, 3) }],
      pagesTruncated: false,
      queries: [{ page: 'https://e.com/', query: 'villa e', ...m(3, 14, 3) }, { page: 'https://e.com/faq/', query: 'villa e', ...m(0, 2, 7) }, { page: 'https://e.com/', query: 'e restaurant', ...m(4, 12, 1) }],
      queriesTruncated: false, requests: 3,
    } as { id: string });
    const d = await startDashboard({ outputDir: out, port: 0, gsc: { store, fetch: async () => { throw new Error("s'duhet thirrur"); } } });
    server = d.server;
    base = d.url.replace(/\/$/, '');
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const d of [out, gscDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('tabelë kompakte e kërkimeve (shfaqje, klikime, pozicion), detyra me një fakt dhe shënimet në details', async () => {
    const body = await (await fetch(`${base}/`)).text();
    // kërkimet: tabelë, të bashkuara sipas tekstit (14+2 shfaqje), me pozicionin mesatar të peshuar
    expect(body).toContain('<table class="keep qtable"><thead><tr><th scope="col">Kërkimi</th><th scope="col" class="num">Shfaqje</th><th scope="col" class="num">Klikime</th>');
    expect(body).toMatch(/<tr class="few"><th scope="row">villa e<\/th><td class="num">16<\/td><td class="num">3<\/td><td class="num">3\.5<\/td><\/tr>/);
    expect(body).toContain('Të gjitha kanë nën 100 shfaqje: mostër e vogël.');
    expect(body).not.toContain('qcard');
    // GSC: totali i property-t, jo parashikim
    expect(body).toContain('136 shfaqje · CTR 11.0%');
    expect(body).toContain('jo parashikim');
    // detyrat: titulli si lidhje, një fakt; matja e vetme e Lighthouse vetëm te detajet
    expect(body).toMatch(/<ol class="focus"><li><div class="frow"><span class="badge sev-high">[^<]+<\/span><a class="t" href="\/report\/e\.com-20261003-071803\.json\/tasks#detyra-0">LCP 5\.0s<\/a><\/div>/);
    expect(body).toContain('<p class="fact">faqja hyrëse · 136 shfaqje në GSC</p>');
    const det = body.slice(body.indexOf('<details class="fdet">'));
    expect(det.indexOf('Matje e vetme Lighthouse')).toBeGreaterThan(0);
    expect(body.indexOf('Matje e vetme Lighthouse')).toBeGreaterThan(body.indexOf('<details class="fdet">'));
    // Lighthouse me etiketa shqip, emri origjinal në title
    expect(body).toContain('<abbr title="Lighthouse: Performance">Performanca</abbr>');
    expect(body).toContain('<abbr title="Lighthouse: Agentic Browsing">Shfletimi nga agjentë AI</abbr>');
    // sidebar: tregues i shkurtër, shpjegimi në details
    expect(body).toContain('<details class="local"><summary><span class="ldot" aria-hidden="true"></span>Vetëm lokal</summary><p>Raportet dhe të dhënat e Search Console ruhen në këtë pajisje.');
    expect(body).not.toMatch(/\sstyle=|gradient/);
  });

  it('kontrasti: titull shqip me numrin nga gjetja, origjinali te detajet; provat si blloqe të plota që s\'thyhen te "-"', async () => {
    const body = await (await fetch(`${base}/`)).text();
    expect(body).toMatch(/<span class="badge sev-medium">[^<]+<\/span><a class="t" href="[^"]+">Kontrast i pamjaftueshëm në 3 elemente<\/a>/);
    expect(body).toContain('<p class="orig">Titulli në Lighthouse: <span lang="en">Background and foreground colors do not have a sufficient contrast ratio.</span></p>');
    // kodi dhe rëndësia s'ndryshojnë: faqja e detyrave mban titullin origjinal
    const tasks = await (await fetch(`${base}/report/e.com-20261003-071803.json/tasks`)).text();
    expect(tasks).toContain('A11Y_COLOR_CONTRAST');
    expect(tasks).toContain('sufficient contrast ratio. (3 elemente)');
    // prova e plotë (pa shkurtim), çdo vlerë në span nowrap; teksti i kopjuar mbetet i njëjtë
    expect(body).toContain('<pre class="code-block" tabindex="0" aria-label="Prova"><code><span>&lt;div</span> <span>class=&quot;gj-tl__year&quot;&gt;</span> <span>src=&quot;/wp-content/uploads/tg-blocks/a.jpg&quot;</span></code></pre>');
    expect(body).toContain('<span>max-age=31536000</span>');
    expect(body).toContain('Provat e plota te detyra →');
  });
});
