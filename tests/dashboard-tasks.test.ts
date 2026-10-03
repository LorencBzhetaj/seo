import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlIssues } from '../src/dashboard/model.js';
import { startDashboard } from '../src/dashboard/server.js';
import type { Obj } from '../src/dashboard/store.js';
import { BASIS_LABELS, blockedResponse, buildTasks, coverageNote, coverageText, type Task } from '../src/dashboard/tasks.js';
import { tasksView, urlReportView } from '../src/dashboard/views.js';

// ------------------------------------------------------------ fixtures (në formën e raportit real të gjecaj.al, schema 4)

const S = 'https://e.com';
const META_PAGES = ['/gift-cards/', '/privacy/', '/terms/', '/cookies/', '/sq/politika/', '/sq/kushtet/', '/sq/cookies/'].map((p) => S + p);
const TPL_A = 'body:et-db et-tb-has-footer et-tb-has-header et-tb-has-template et_divi_builder page page-template-default';
const TPL_B = 'body:et-db et-tb-has-footer et-tb-has-header et-tb-has-template et_divi_builder product single-product';

const issue = (o: Obj): Obj => ({ scope: 'page', severity: 'low', impact: 'x', impactLevel: 'low', effort: 'low', module: 'onpage', confidence: 1, priority: 5, needsManualReview: false, whyItMatters: 'pse', fix: 'Rregulloje.', evidence: [], ...o });
const ev = (url: string, detected: string, expected?: string) => ({ type: 'dom', url, detected, ...(expected ? { expected } : {}) });

/** Gjetje e grupuar si te motori i vjetër: 5 shembuj + rreshti "… dhe N faqe të tjera", pa occurrences/templateKey. */
const oldTemplateMeta = issue({
  code: 'MISSING_META_DESCRIPTION', severity: 'medium', scope: 'template', url: META_PAGES[0], affectedPages: META_PAGES, priority: 33,
  message: '7 faqe pa meta description — i njëjti template (et-db et-tb-has-footer et-tb-has-header et-tb-has-template e)',
  evidence: [...META_PAGES.slice(0, 5).map((u) => ev(u, 'Nuk u gjet <meta name="description">')), { type: 'crawl', url: META_PAGES[5], detected: '… dhe 2 faqe të tjera (lista e plotë te affectedPages)' }],
});

function report(o: Obj = {}): Obj {
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', url: `${S}/`, finalUrl: `${S}/`, startedAt: '2026-10-01T12:44:16.950Z', completedAt: '2026-10-01T12:46:46.010Z', status: 'completed',
    health: { score: 77, status: 'GOOD', missingCategories: [] }, categories: {}, modules: [], topImprovements: [],
    issues: [
      issue({ code: 'LCP_POOR', severity: 'high', module: 'performance', url: `${S}/`, message: 'LCP 5.1s në mobile (lab, e simuluar)' }),
      issue({ code: 'MISSING_HSTS', severity: 'medium', scope: 'site', module: 'security', url: `${S}/`, message: 'Mungon Strict-Transport-Security' }),
    ],
    site: {
      status: 'completed',
      crawl: { pagesAnalyzed: 78, urlsDiscovered: 92, truncated: false, notCheckedByReason: { resource: { count: 5 } }, pages: [...META_PAGES, `${S}/faq/`, `${S}/sq/faq/`, `${S}/journal/`, `${S}/product/a/`, `${S}/product/b/`, `${S}/shop/`, `${S}/x/`].map((url) => ({ url, finalUrl: url })) },
      issues: [
        // 7 faqe, i njëjti template, provë për secilën (motori i ri)
        issue({
          code: 'MISSING_META_DESCRIPTION', severity: 'medium', scope: 'template', url: META_PAGES[0], affectedPages: [...META_PAGES, META_PAGES[0]], priority: 33, templateKey: TPL_A,
          message: '7 faqe pa meta description — i njëjti template (et-db et-tb-has-footer et-tb-has-header et-tb-has-template e)',
          evidence: META_PAGES.slice(0, 5).map((u) => ev(u, 'Nuk u gjet <meta name="description">')),
          occurrences: META_PAGES.map((u) => ({ url: u, detected: 'Nuk u gjet <meta name="description">' })),
        }),
        // i njëjti kod, faqe pa template të përbashkët
        issue({ code: 'MISSING_META_DESCRIPTION', severity: 'medium', url: `${S}/shop/`, affectedPages: [`${S}/shop/`, `${S}/x/`], message: '2 faqe pa meta description', evidence: [ev(`${S}/shop/`, 'Nuk u gjet <meta name="description">'), ev(`${S}/x/`, 'Nuk u gjet <meta name="description">')] }),
        // HEADING_LEVEL_SKIP në dy template të ndryshme, me të njëjtën provë në njërën faqe
        issue({ code: 'HEADING_LEVEL_SKIP', scope: 'template', confidence: 0.7, url: `${S}/journal/`, affectedPages: [`${S}/journal/`, `${S}/faq/`], templateKey: TPL_A, message: '2 faqe me kërcim në nivelet e titujve — i njëjti template (et-db …)', evidence: [ev(`${S}/journal/`, 'H1 → H3 ("Food")', 'H1 → H2'), ev(`${S}/faq/`, 'H2 → H4 ("Explore")', 'H2 → H3')] }),
        issue({ code: 'HEADING_LEVEL_SKIP', scope: 'template', confidence: 0.7, url: `${S}/product/a/`, affectedPages: [`${S}/product/a/`, `${S}/product/b/`], templateKey: TPL_B, message: '2 faqe me kërcim në nivelet e titujve — i njëjti template (et-db …)', evidence: [ev(`${S}/product/a/`, 'H2 → H4 ("Explore")', 'H2 → H3'), ev(`${S}/product/b/`, 'H2 → H4 ("Explore")', 'H2 → H3')] }),
        // dy FAQ me titull të njëjtë (dhe description të njëjtë)
        issue({ code: 'DUPLICATE_TITLES', severity: 'medium', module: 'duplicates', url: `${S}/faq/`, affectedPages: [`${S}/faq/`, `${S}/sq/faq/`], message: '2 faqe kanë të njëjtin titull: "FAQ | E"', evidence: [ev(`${S}/faq/`, 'titull: "FAQ | E"'), ev(`${S}/sq/faq/`, 'titull: "FAQ | E"')] }),
        issue({ code: 'DUPLICATE_META_DESCRIPTIONS', module: 'duplicates', url: `${S}/faq/`, affectedPages: [`${S}/sq/faq/`, `${S}/faq/`], message: '2 faqe kanë të njëjtin meta description', evidence: [] }),
        // URL jashtë faqeve të kontrolluara (sitemap)
        issue({ code: 'SITEMAP_URLS_WITHOUT_INTERNAL_LINKS', scope: 'site', module: 'sitemap', needsManualReview: true, confidence: 0.6, url: `${S}/fshehur/`, affectedPages: [`${S}/fshehur/`, `${S}/x/`], message: '2 URL nga sitemap-i pa linke', evidence: [] }),
      ],
    },
    business: { status: 'completed', issues: [issue({ code: 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL', severity: 'medium', scope: 'site', module: 'privacy', needsManualReview: true, confidence: 0.6, url: `${S}/`, message: 'Kërkesë te Google Analytics gjatë ngarkimit — kërkon verifikim manual' })] },
    quality: {
      status: 'info', statuses: {}, groups: [],
      issues: [
        ...[`${S}/`, `${S}/journal/`].map((u) => issue({ code: 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', module: 'content-quality', confidence: 0.6, needsManualReview: true, url: u, message: '3 linke me emrin e aksesueshëm "Read more →"', evidence: [ev(u, 'emri i aksesueshëm: "Read more →" (burimi: teksti i dukshëm) · konteksti pranë: "A", "B"')] })),
        issue({ code: 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', module: 'content-quality', confidence: 0.6, needsManualReview: true, url: `${S}/rooms/`, message: '3 linke me emrin e aksesueshëm "Details"', evidence: [ev(`${S}/rooms/`, 'emri i aksesueshëm: "Details" (burimi: teksti i dukshëm)')] }),
      ],
    },
    ...o,
  };
}

const tasksOf = (r: Obj) => buildTasks(r, urlIssues(r));
const find = (ts: Task[], code: string, pred: (t: Task) => boolean = () => true) => ts.filter((t) => t.code === code && pred(t));

// ------------------------------------------------------------ grupimi

describe('Detyrat: bashkimi vetëm me provë për të njëjtin shkak', () => {
  it('MISSING_META_DESCRIPTION: 7 faqe nga i njëjti template → një detyrë me 7 URL unike dhe provë për secilën', () => {
    const { tasks, coverage } = tasksOf(report());
    const [t] = find(tasks, 'MISSING_META_DESCRIPTION', (x) => x.basis === 'template');
    expect(t!.pages).toEqual(META_PAGES); // URL e përsëritur numërohet një herë
    expect(t!.evidence.every((e) => e.items.length === 1)).toBe(true);
    expect(t!.templateKeyStored).toBe(true);
    // Titulli i kuptueshëm; emri teknik vetëm te detajet
    expect(t!.problem).toBe('7 faqe pa meta description, me strukturë të ngjashme faqeje');
    expect(t!.templateLabel).toBe(TPL_A.slice('body:'.length));
    // klasat e njëjta të body-t s'provojnë një rregullim të vetëm: faqet kontrollohen veçmas
    expect(t!.action).toContain('Kontrollo faqet veçmas');
    expect(t!.action).toContain('plugin SEO');
    expect(t!.action).not.toContain('komponent i përbashkët');
    expect(BASIS_LABELS[t!.basis]).toBe('strukturë e ngjashme — verifiko komponentin');
    expect(coverageText(t!, coverage)).toBe('7 faqe të prekura mes 78 faqeve të kontrolluara');
  });

  it('raport i vjetër: 5 prova + rreshti "… dhe 2 faqe të tjera" → 2 faqe pa provë individuale, rreshti s\'numërohet si provë', () => {
    const r = report();
    obj(r.site).issues = [oldTemplateMeta];
    const [t] = find(tasksOf(r).tasks, 'MISSING_META_DESCRIPTION');
    expect(t!.pages).toHaveLength(7);
    expect(t!.evidence.filter((e) => e.items.length)).toHaveLength(5);
    expect(t!.evidence.find((e) => e.url === META_PAGES[5])!.items).toEqual([]);
    expect(t!.templateKeyStored).toBe(false);
    expect(t!.templateLabel).toBe('et-db et-tb-has-footer et-tb-has-header et-tb-has-template e');
    expect(t!.why).toContain("s'ruan çelësin e plotë");
  });

  it('i njëjti kod, template ose shkak tjetër → s\'bashkohen; lidhja shfaqet si "mund të jenë të lidhura"', () => {
    const { tasks } = tasksOf(report());
    const meta = find(tasks, 'MISSING_META_DESCRIPTION');
    expect(meta.map((t) => t.basis).sort()).toEqual(['separate-pages', 'template']);
    const sep = meta.find((t) => t.basis === 'separate-pages')!;
    expect(sep.action).toContain("s'ndajnë template");
    expect(sep.related[0]!.why).toContain("s'u bashkuan");

    const heading = find(tasks, 'HEADING_LEVEL_SKIP');
    expect(heading).toHaveLength(2);
    expect(heading.every((t) => t.basis === 'template' && t.pages.length === 2)).toBe(true);
    const product = heading.find((t) => t.pages.includes(`${S}/product/a/`))!;
    expect(product.related[0]!.why).toContain('H2 → H4 ("Explore")');
    expect(product.related[0]!.why).toContain('mund të jenë të lidhura');
    // të gjitha faqet me provë për të njëjtin element → rregullim i përbashkët i mundshëm, me verifikim
    expect(product.action).toContain('Të 2 faqet kanë provë për të njëjtin element ("Explore")');
    expect(product.confidence).toEqual({ min: 0.7, max: 0.7 });
    // brenda të njëjtit template, elemente të ndryshme në prova → shënim kujdesi; i njëjti element → pa shënim
    const journal = heading.find((t) => t.pages.includes(`${S}/journal/`))!;
    expect(journal.cautions.join(' ')).toContain('"Food" (1 faqe), "Explore" (1 faqe)');
    expect(product.cautions.join(' ')).not.toContain('elemente të ndryshme');
  });

  it('dy FAQ me titull të njëjtë → një detyrë me të dy URL-të, pa e quajtur defekt template-i', () => {
    const { tasks } = tasksOf(report());
    const [t] = find(tasks, 'DUPLICATE_TITLES');
    expect(t!.basis).toBe('linked-pages');
    expect(t!.pages).toEqual([`${S}/faq/`, `${S}/sq/faq/`]);
    expect(t!.why).toContain("S'ka provë që shkaku është template-i");
    expect(t!.related.map((x) => x.why).join(' ')).toContain('DUPLICATE_META_DESCRIPTIONS');
  });

  it('LINK_NAME_AMBIGUOUS: i njëjti emër → "mund të jenë të lidhura", shqyrtim komponenti; emër tjetër mbetet veç; pa etiketa AI/WCAG', () => {
    const { tasks } = tasksOf(report());
    const links = find(tasks, 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT');
    const grouped = links.find((t) => t.basis === 'possibly-related')!;
    expect(grouped.pages).toEqual([`${S}/`, `${S}/journal/`]);
    expect(grouped.findings).toHaveLength(2);
    expect(grouped.needsManualReview).toBe(true);
    expect(grouped.action).toContain('Shqyrto komponentin e kartave');
    expect(grouped.cautions.join(' ')).toContain("s'është shkelje e konfirmuar e WCAG");
    expect(links.find((t) => t.pages.includes(`${S}/rooms/`))!.basis).toBe('single-page');
    const text = JSON.stringify(tasks);
    expect(text).not.toMatch(/AI slop|krijuar nga AI/i);
  });

  it('zonat: faqja hyrëse, siti, biznes, cilësi; renditja: rëndësia → e konfirmuar → faqet', () => {
    const { tasks } = tasksOf(report());
    expect(tasks[0]!.code).toBe('LCP_POOR');
    expect(tasks[0]!.cautions[0]).toContain('Matje e vetme Lighthouse');
    expect(find(tasks, 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL')[0]!.area).toBe('business');
    expect(find(tasks, 'MISSING_HSTS')[0]!.basis).toBe('site-wide');
    const medium = tasks.filter((t) => t.severity === 'medium');
    const firstManual = medium.findIndex((t) => t.needsManualReview);
    expect(medium.slice(firstManual).every((t) => t.needsManualReview)).toBe(true);
    expect(medium.slice(0, firstManual).map((t) => t.pages.length)).toEqual([...medium.slice(0, firstManual).map((t) => t.pages.length)].sort((a, b) => b - a));
    expect(tasks[0]!.rankWhy).toContain('rëndësia high');
  });
});

// ------------------------------------------------------------ mbulimi

describe("Regresion: klasa të njëjta të body-t s'provojnë një komponent", () => {
  const tpl = (pages: [string, string][], o: Obj = {}) => issue({
    code: 'HEADING_LEVEL_SKIP', scope: 'template', confidence: 0.7, url: pages[0]![0], affectedPages: pages.map(([u]) => u), templateKey: TPL_A,
    message: `${pages.length} faqe me kërcim në nivelet e titujve — i njëjti template (et-db …)`,
    occurrences: pages.map(([u, el]) => ({ url: u, detected: `H2 → H4 ("${el}")`, expected: 'H2 → H3' })), evidence: [], ...o,
  });
  const only = (i: Obj) => tasksOf(report({ issues: [], site: { status: 'completed', crawl: obj(report().site).crawl, issues: [i] }, business: undefined, quality: undefined })).tasks[0]!;

  it('elemente të ndryshme (Explore, Food, From Shkodër, Choose the gift) → "kontrollo faqet veçmas", pa rregullim të përbashkët', () => {
    const t = only(tpl([[`${S}/journal/heritage/`, 'Explore'], [`${S}/journal/`, 'Food'], [`${S}/contact/`, 'From Shkodër'], [`${S}/gift-cards/`, 'Choose the gift'], [`${S}/journal/food/`, 'Explore']]));
    expect(t.basis).toBe('template');
    expect(t.pages).toHaveLength(5);
    expect(t.evidence.every((e) => e.items.length === 1)).toBe(true); // provat individuale mbeten
    expect(t.action).toContain('Kontrollo faqet veçmas');
    expect(t.action).toContain('Elementi "Explore" përsëritet në 2 faqe');
    expect(t.action).not.toContain('Gjeje komponentin');
    expect(t.cautions.join(' ')).toContain('"Explore" (2 faqe), "Food" (1 faqe), "From Shkodër" (1 faqe), "Choose the gift" (1 faqe)');
  });

  it("i njëjti element, por provë vetëm për disa faqe (raport i vjetër) → s'mjafton për rregullim të përbashkët", () => {
    const pages = Array.from({ length: 7 }, (_, n) => `${S}/p${n}/`);
    const t = only(tpl(pages.map((u) => [u, 'Explore']), { occurrences: undefined, templateKey: undefined, evidence: pages.slice(0, 5).map((u) => ev(u, 'H2 → H4 ("Explore")', 'H2 → H3')) }));
    expect(t.evidence.filter((e) => e.items.length)).toHaveLength(5);
    expect(t.action).toContain('Kontrollo faqet veçmas');
    expect(t.action).toContain('provë individuale vetëm për 5 nga 7 faqe');
  });

  it('i njëjti element me provë për çdo faqe → rregullim i përbashkët i mundshëm, i shënuar për verifikim', () => {
    const t = only(tpl([[`${S}/product/a/`, 'Explore'], [`${S}/product/b/`, 'Explore'], [`${S}/product/c/`, 'Explore']]));
    expect(t.action).toContain('Të 3 faqet kanë provë për të njëjtin element ("Explore")');
    expect(t.action).toContain('verifiko disa nga faqet');
  });

  it("prova pa element konkret (mungesë) → asnjë rregullim i përbashkët; atributet HTML s'merren si element", () => {
    const t = only(issue({ code: 'IMAGES_MISSING_ALT', scope: 'template', url: META_PAGES[0], affectedPages: META_PAGES.slice(0, 3), templateKey: TPL_A, message: '3 faqe me imazhe pa alt — i njëjti template (x)', occurrences: META_PAGES.slice(0, 3).map((u) => ({ url: u, detected: '<img src="/a.jpg"> pa alt' })) }));
    expect(t.action).toContain('Kontrollo faqet veçmas');
    expect(t.action).toContain('Kjo është përmbajtje e secilës faqe.');
    expect(t.action).not.toContain('plugin SEO');
  });
});

describe('Regresion: raport historik me HTTP 403 në faqen hyrëse', () => {
  /** Si raporti real gjecaj.al-20260928-172726.json (schema 1, pa fushën access). */
  const blocked403 = (o: Obj = {}): Obj => ({
    reportSchemaVersion: '1', url: `${S}/`, finalUrl: `${S}/`, completedAt: '2026-09-28T17:27:26Z', status: 'partial',
    health: { score: null, status: 'PARTIAL' },
    modules: [{ module: 'availability', metrics: [{ id: 'http-status', value: 403 }] }],
    limitations: ['Performance: Lighthouse runtimeError ERRORED_DOCUMENT_REQUEST … (Status code: 403)'],
    issues: [
      issue({ code: 'HOMEPAGE_HTTP_ERROR', severity: 'critical', scope: 'site', module: 'availability', url: `${S}/`, message: 'Faqja hyrëse kthen HTTP 403', evidence: [ev(`${S}/`, 'HTTP 403 Forbidden', 'HTTP 200')] }),
      ...['MISSING_HSTS', 'MISSING_FRAME_PROTECTION', 'MISSING_X_CONTENT_TYPE_OPTIONS', 'MISSING_CSP'].map((code) => issue({ code, scope: 'site', module: 'security', url: `${S}/`, message: `${code} mungon`, evidence: [ev(`${S}/`, 'Header mungon në përgjigjen e faqes hyrëse')] })),
    ],
    ...o,
  });

  it("403 e matur → header-at s'janë detyra; gjetja e qasjes mbetet diagnozë me udhëzim për audit të ri", () => {
    const r = blocked403();
    const list = tasksOf(r);
    expect(list.blocked).toEqual({ status: 403, source: 'gjetja HOMEPAGE_HTTP_ERROR (provë: HTTP 403) dhe metrika http-status e availability' });
    expect(list.tasks.map((t) => t.code)).toEqual(['HOMEPAGE_HTTP_ERROR']);
    expect(list.tasks[0]!.problem).toBe('Auditi u bllokua: faqja hyrëse ktheu HTTP 403 për tool-in');
    expect(list.tasks[0]!.action).toContain('nis një audit të ri');
    expect(list.tasks[0]!.action).toContain('Mos i çaktivizo mbrojtjet');
    expect(list.measuredOnBlock.map((i) => i.code)).toEqual(['MISSING_HSTS', 'MISSING_FRAME_PROTECTION', 'MISSING_X_CONTENT_TYPE_OPTIONS', 'MISSING_CSP']);
    const view = tasksView('e.com-20260928-172726.json', r);
    expect(view).toContain('Faqja hyrëse ktheu HTTP 403 për tool-in: auditi s');
    expect(view).toContain('Matur te përgjigjja e bllokimit');
    // Health Score s'ndryshon: raporti mbetet PARTIAL pa pikë
    const rep = urlReportView('e.com-20260928-172726.json', r, {}, { shotExists: () => false, lhrExists: () => false });
    expect(rep).toContain('id="bllokim"');
    expect(rep).toContain('U mat te përgjigjja e bllokimit (HTTP 403)');
    expect(rep).toContain('PARTIAL');
  });

  it('detyra "Auditi u bllokua" te raporti historik: "Kritike" me shënimin e rëndësisë historike; raporti i ri pa shënim', () => {
    const r = blocked403();
    const [t] = tasksOf(r).tasks;
    expect(t!.severity).toBe('critical');
    expect(t!.historicalSeverity).toBe(true);
    const view = tasksView('e.com-20260928-172726.json', r);
    expect(view).toMatch(/<span class="badge sev-critical">Kritike<\/span> <span class="badge b-warning">rëndësi historike e raportit; kërkon verifikim<\/span> <strong>Auditi u bllokua/);
    expect(view).toContain('jo vlerësimi aktual i mjetit');
    // paneli te raporti tregon të njëjtin shënim; gjetja origjinale mbetet "Kritike" pa ndryshim
    const rep = urlReportView('e.com-20260928-172726.json', r, {}, { shotExists: () => false, lhrExists: () => false });
    expect(rep).toContain('rëndësi historike e raportit; kërkon verifikim');
    expect(obj((r.issues as Obj[])[0]).severity).toBe('critical');

    // raport i ri me access "blocked": e njëjta detyrë, pa shënimin historik
    const fresh = { ...blocked403(), reportSchemaVersion: '4', access: { state: 'blocked', httpStatus: 403 } };
    const [n] = tasksOf(fresh).tasks;
    expect(n!.problem).toBe('Auditi u bllokua: faqja hyrëse ktheu HTTP 403 për tool-in');
    expect(n!.historicalSeverity).toBe(false);
    expect(tasksView('e.com-20261003-100000.json', fresh)).not.toContain('rëndësi historike');
    // raportet e reja normale s'e kanë kurrë
    expect(tasksOf(report()).tasks.some((x) => x.historicalSeverity)).toBe(false);
    expect(tasksView('e.com-20261001-124416.json', report())).not.toContain('rëndësi historike');
  });

  it('vetëm metrika http-status 403 (pa gjetjen) → bllokim; access.state "blocked" (raport i ri) → bllokim', () => {
    expect(blockedResponse(blocked403({ issues: [] }), [])).toEqual({ status: 403, source: 'metrika http-status e modulit availability' });
    const r = { reportSchemaVersion: '4', url: `${S}/`, access: { state: 'blocked', httpStatus: 429 }, issues: [] };
    expect(blockedResponse(r, [])).toMatchObject({ status: 429 });
  });

  it("pa prova të mjaftueshme → s'supozohet bllokim", () => {
    // vetëm gabimi i Lighthouse me "Status code: 403"
    const lhOnly = blocked403({ modules: [], issues: [issue({ code: 'MISSING_CSP', module: 'security', url: `${S}/`, message: 'CSP mungon' })] });
    expect(tasksOf(lhOnly).blocked).toBeNull();
    expect(tasksOf(lhOnly).tasks.map((t) => t.code)).toEqual(['MISSING_CSP']);
    // HTTP 500 s'është bllokim i klientit
    const e500 = blocked403({ modules: [{ module: 'availability', metrics: [{ id: 'http-status', value: 500 }] }], issues: [issue({ code: 'HOMEPAGE_HTTP_ERROR', module: 'availability', url: `${S}/`, message: 'HTTP 500', evidence: [ev(`${S}/`, 'HTTP 500 Internal Server Error')] })] });
    expect(tasksOf(e500).blocked).toBeNull();
    // raport i ri me access "ok": fusha access vendos, edhe nëse një tekst përmend 403
    const ok = { ...blocked403(), access: { state: 'ok', httpStatus: 200 } };
    expect(tasksOf(ok).blocked).toBeNull();
    // raporti normal i fixture-it
    expect(tasksOf(report()).blocked).toBeNull();
  });
});

describe('Detyrat: mbulimi i crawl-it dhe URL-të unike', () => {
  it('crawl i plotë brenda kufijve: skedarët e anashkaluar s\'e bëjnë "të pjesshëm"; URL jashtë faqeve të kontrolluara thuhet veç', () => {
    const { tasks, coverage } = tasksOf(report());
    expect(coverage).toMatchObject({ hasCrawl: true, checked: 78, partial: false });
    expect(coverageNote(coverage)).toContain('jo për gjithë sitin');
    const [sm] = find(tasks, 'SITEMAP_URLS_WITHOUT_INTERNAL_LINKS');
    expect(coverageText(sm!, coverage)).toBe('2 URL të prekura (1 prej tyre mes 78 faqeve të kontrolluara)');
  });

  it('crawl i pjesshëm (u ndal nga kufiri) → shënohet; numrat mbeten "N faqe të prekura mes M faqeve të kontrolluara"', () => {
    const r = report();
    obj(obj(r.site).crawl).notCheckedByReason = { 'max-pages': { count: 40 } };
    const { tasks, coverage } = tasksOf(r);
    expect(coverage.partial).toBe(true);
    expect(coverageNote(coverage)).toContain('i pjesshëm');
    expect(coverageText(find(tasks, 'DUPLICATE_TITLES')[0]!, coverage)).toBe('2 faqe të prekura mes 78 faqeve të kontrolluara');
  });

  it('raport i vjetër (schema 1, pa crawl, pa scope/affectedPages) → detyra të kujdesshme, pa template të shpikur', () => {
    const r = { reportSchemaVersion: '1', url: `${S}/`, completedAt: '2026-09-20T10:00:00Z', status: 'completed', health: { score: 70 }, issues: [issue({ code: 'MISSING_CSP', scope: undefined, url: `${S}/`, message: 'Mungon CSP', affectedPages: undefined }), issue({ code: 'TITLE_LENGTH', scope: undefined, url: undefined, message: 'Titull i gjatë' })] };
    const { tasks, coverage } = tasksOf(r);
    expect(coverage.hasCrawl).toBe(false);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.basis === 'single-page' && t.templateLabel === '')).toBe(true);
    expect(coverageNote(coverage)).toContain("s'ka crawl");
    expect(tasksView('e.com-20260920-100000.json', r)).toContain('Detyrat e rekomanduara');
    // raport pa asnjë gjetje
    expect(tasksView('e.com-20260920-100000.json', { reportSchemaVersion: '1', url: `${S}/` })).toContain("Ky raport s'ka gjetje");
  });
});

// ------------------------------------------------------------ pamja dhe serveri

describe('Detyrat në dashboard', () => {
  let out: string;
  let server: http.Server;
  let base = '';
  const F = 'e.com-20261001-124416.json';
  const get = async (p: string) => {
    const res = await fetch(base + p);
    return { status: res.status, csp: res.headers.get('content-security-policy') ?? '', body: await res.text() };
  };
  beforeAll(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tasks-'));
    const r = report();
    // përmbajtje e pabesuar në gjetje
    obj(r.site).issues = [...(obj(r.site).issues as Obj[]), issue({ code: 'MISSING_H1', url: 'javascript:alert(1)', affectedPages: ['javascript:alert(1)', `${S}/<b>x</b>`], message: '<script>alert(1)</script> pa H1', fix: '<img src=x onerror=alert(1)>', evidence: [ev('javascript:alert(1)', '<iframe src="https://keq.example">')] })];
    fs.writeFileSync(path.join(out, F), JSON.stringify(r));
    fs.writeFileSync(path.join(out, 'source-folder-x-20261001-100000.json'), JSON.stringify({ reportSchemaVersion: 'source-1', reportType: 'source-audit', source: { kind: 'folder', name: 'x' }, status: 'completed', findings: [], checks: [] }));
    const d = await startDashboard({ outputDir: out, port: 0 });
    server = d.server;
    base = d.url.replace(/\/$/, '');
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('faqja e detyrave: CSP, zonat, mbulimi, renditja e shpjeguar, provat për faqe, lidhjet te gjetjet', async () => {
    const r = await get(`/report/${F}/tasks`);
    expect(r.status).toBe(200);
    expect(r.csp).toContain("script-src 'none'");
    for (const s of ['Faqja hyrëse', 'Shumë faqe të sitit', 'Biznes &amp; privatësi', 'Sinjale cilësie']) expect(r.body).toContain(s);
    expect(r.body).toContain('7 faqe të prekura mes 78 faqeve të kontrolluara');
    expect(r.body).toContain('Search Console');
    expect(r.body).toContain('mund të jenë të lidhura — verifiko');
    expect(r.body).toMatch(new RegExp(`href="/report/${F.replace(/\./g, '\\.')}#gjetja-\\d+"`));
    expect(r.body).not.toMatch(/AI slop|krijuar nga AI/i);
  });

  it('raporti: paneli i detyrave, ankorat #gjetja-N dhe lidhja anasjelltas "Pjesë e detyrës"', async () => {
    const r = await get(`/report/${F}`);
    expect(r.body).toContain('Detyrat e rekomanduara');
    expect(r.body).toMatch(/id="gjetja-\d+"/);
    expect(r.body).toContain('Pjesë e detyrës');
    expect(r.body).toMatch(/\/tasks#detyra-[\d-]+/);
  });

  it('teksti dhe URL-të e pabesuara: escape, pa link javascript:', async () => {
    const r = await get(`/report/${F}/tasks`);
    expect(r.body).not.toContain('<script>alert(1)</script>');
    expect(r.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.body).not.toContain('<img src=x');
    expect(r.body).not.toContain('<iframe');
    expect(r.body).not.toContain('href="javascript:');
    expect(r.body).not.toContain('<b>x</b>');
  });

  it('emra të pasigurt, raport që mungon dhe raport skedarësh → 404', async () => {
    expect((await get('/report/..%2F..%2Fsekret.json/tasks')).status).toBe(404);
    expect((await get('/report/mungon-20261001-100000.json/tasks')).status).toBe(404);
    expect((await get('/report/source-folder-x-20261001-100000.json/tasks')).status).toBe(404);
  });
});

function obj(x: unknown): Obj {
  return x as Obj;
}
