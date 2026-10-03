import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AuditConfig } from '../src/core/config.js';
import { runModules, type AuditRun } from '../src/core/run.js';
import { compareSeries, seriesForCompare, seriesOf } from '../src/dashboard/lh-series.js';
import type { Obj } from '../src/dashboard/store.js';
import { compareView, urlReportView } from '../src/dashboard/views.js';
import { compareReports } from '../src/dashboard/compare.js';
import { LighthouseRunError, type LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { DEFAULT_LIGHTHOUSE_RUNS, MAX_LIGHTHOUSE_RUNS, median, pickRepresentative, runLighthouseSeries, stat, summarizeSeries, type LhRunRecord } from '../src/lighthouse/series.js';
import { MAX_LH_RUNS, parseUrlForm } from '../src/dashboard/forms.js';
import { runPerformance } from '../src/modules/lighthouse-modules.js';
import { buildReport, writeReport } from '../src/report/json.js';
import { categoryScores, computeHealth } from '../src/scoring/scorer.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

const cfg = (runs: number, saveLhr = false): AuditConfig => ({ ...DEFAULT_CONFIG, lighthouse: { ...DEFAULT_CONFIG.lighthouse, runs, saveLhr } });

/** Një matje e rreme: fixture-i real i shkurtuar me Performance/LCP të dhëna. */
function fakeRun(perf: number, lcp: number, extra: Partial<LighthouseData> = {}): LighthouseData {
  const lh = lighthouseFixture();
  return {
    ...lh,
    categories: { ...lh.categories, performance: { ...lh.categories.performance!, score: perf / 100 } },
    audits: { ...lh.audits, 'largest-contentful-paint': { ...lh.audits['largest-contentful-paint']!, numericValue: lcp } },
    rawLhr: { marker: `lhr-${perf}-${lcp}` },
    ...extra,
  };
}

/** runOnce që kthen/hedh sipas radhës. */
function scripted(steps: (LighthouseData | Error)[]) {
  let i = 0;
  const calls: number[] = [];
  const fn = async () => {
    const s = steps[Math.min(i, steps.length - 1)]!;
    calls.push(++i);
    if (s instanceof Error) throw s;
    return s;
  };
  return { fn, calls };
}

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

// ------------------------------------------------------------ statistika

describe('Seria: mediana, intervali dhe matja përfaqësuese', () => {
  it('mediana me numër tek dhe çift matjesh; null dhe vlerat jo-numerike s\'numërohen', () => {
    expect(median([63, 59, 63])).toBe(63);
    expect(median([60, 70])).toBe(65);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(stat([5, null, undefined, 1, Number.NaN, 3])).toEqual({ n: 3, median: 3, min: 1, max: 5 });
    expect(stat([])).toEqual({ n: 0, median: null, min: null, max: null });
  });

  it('matja përfaqësuese: Performance mediane; çift → më e ulëta e dy të mesit; barazim → më e hershmja', () => {
    const r = (run: number, perf: number | null, status: 'ok' | 'failed' = 'ok'): LhRunRecord => ({ run, status, startedAt: '', durationMs: 1, technicalRetries: [], ...(status === 'ok' ? { values: { performance: perf } } : {}) });
    expect(pickRepresentative([r(1, 63), r(2, 63), r(3, 59)])).toBe(1); // reale nga gjecaj.al
    expect(pickRepresentative([r(1, 80), r(2, 60), r(3, 70), r(4, 90)])).toBe(3); // 60,70,80,90 → 70
    expect(pickRepresentative([r(1, 50), r(2, 0, 'failed'), r(3, 40)])).toBe(3); // 40,50 → 40
    expect(pickRepresentative([r(1, 0, 'failed'), r(2, 0, 'failed')])).toBeNull();
  });
});

// ------------------------------------------------------------ runner-i

describe('Seria: parazgjedhja, kufijtë, dështimet', () => {
  it('parazgjedhja 1: një thirrje, pa seri (raporti si më parë); kufiri 5', async () => {
    expect(DEFAULT_LIGHTHOUSE_RUNS).toBe(1);
    expect(DEFAULT_CONFIG.lighthouse.runs).toBe(1);
    expect(MAX_LIGHTHOUSE_RUNS).toBe(5);
    expect(MAX_LH_RUNS).toBe(MAX_LIGHTHOUSE_RUNS); // dashboard-i s'e importon motorin: kufiri duhet të përputhet
    const one = scripted([fakeRun(70, 3000)]);
    const v = await runLighthouseSeries('https://e.com/', cfg(1), one.fn);
    expect(one.calls).toHaveLength(1);
    expect(v.series).toBeUndefined();
    // config.json me vlera jashtë kufijve: kufizohen
    const zero = scripted([fakeRun(70, 3000)]);
    await runLighthouseSeries('https://e.com/', cfg(0), zero.fn);
    expect(zero.calls).toHaveLength(1);
    const many = scripted([fakeRun(70, 3000)]);
    const m = await runLighthouseSeries('https://e.com/', cfg(9), many.fn);
    expect(many.calls).toHaveLength(5);
    expect(m.series!.planned).toBe(5);
  });

  it('çdo matje ruhet veç; të dhënat e kthyera janë ato të matjes përfaqësuese; progresi për secilën', async () => {
    const s = scripted([fakeRun(63, 4393), fakeRun(63, 4576), fakeRun(59, 5017)]);
    const steps: string[] = [];
    const v = await runLighthouseSeries('https://e.com/', cfg(3), s.fn, (m) => steps.push(m));
    expect(steps).toEqual(['Lighthouse (mobile): matja 1/3', 'Lighthouse (mobile): matja 2/3', 'Lighthouse (mobile): matja 3/3']);
    const ser = v.series!;
    expect(ser).toMatchObject({ planned: 3, valid: 3, failed: 0, representativeRun: 1, configConsistent: true });
    expect(ser.runs.map((r) => r.values?.lcpMs)).toEqual([4393, 4576, 5017]);
    expect(ser.stats.performance).toEqual({ n: 3, median: 63, min: 59, max: 63 });
    expect(ser.stats.lcpMs).toEqual({ n: 3, median: 4576, min: 4393, max: 5017 });
    // Health/issue-t lexojnë këto të dhëna: janë të matjes #1 (LCP 4393), jo mediana (4576)
    expect(v.audits['largest-contentful-paint']!.numericValue).toBe(4393);
    expect(ser.rule).toContain('matja përfaqësuese');
  });

  it('dështime të pjesshme: raportohen sa mbetën të vlefshme; riprovimi teknik NO_NAVSTART s\'është matje e re', async () => {
    const navRetry = { attempt: 1, code: 'NO_NAVSTART', message: 'trace' };
    const fail = new LighthouseRunError('Lighthouse runtimeError NO_FCP: faqja s\'vizatoi', 'NO_FCP', [{ attempt: 1, code: 'NO_FCP', message: 'x' }]);
    const failAfterRetry = new LighthouseRunError('NO_NAVSTART (2 përpjekje)', 'NO_NAVSTART', [navRetry, { attempt: 2, code: 'NO_NAVSTART', message: 'trace' }]);
    const s = scripted([fakeRun(60, 3000, { failedAttempts: [navRetry] }), fail, failAfterRetry, fakeRun(70, 2800)]);
    const v = await runLighthouseSeries('https://e.com/', cfg(4), s.fn);
    const ser = v.series!;
    expect(s.calls).toHaveLength(4); // dështimi s'ndalon serinë
    expect(ser).toMatchObject({ planned: 4, valid: 2, failed: 2 });
    expect(ser.runs.map((r) => r.status)).toEqual(['ok', 'failed', 'failed', 'ok']);
    expect(ser.runs[0]!.technicalRetries).toEqual([navRetry]); // brenda matjes #1
    expect(ser.runs[1]).toMatchObject({ error: { code: 'NO_FCP' }, technicalRetries: [] });
    expect(ser.runs[2]!.technicalRetries).toEqual([navRetry]); // përpjekja e fundit është vetë dështimi
    expect(ser.runs[1]!.values).toBeUndefined(); // asnjë vlerë e shpikur për matjet e dështuara
    expect(ser.stats.performance).toEqual({ n: 2, median: 65, min: 60, max: 70 });
    expect(ser.representativeRun).toBe(1); // 60,70 → më e ulëta e dy të mesit
  });

  it('asnjë matje e vlefshme → gabim me serinë, pa rezultat të shpikur', async () => {
    const fail = new LighthouseRunError('NO_FCP', 'NO_FCP', [{ attempt: 1, code: 'NO_FCP', message: 'x' }]);
    const s = scripted([fail]);
    const err = (await runLighthouseSeries('https://e.com/', cfg(3), s.fn).catch((e) => e)) as LighthouseRunError & { series: { valid: number; representativeRun: number | null; stats: { performance: { n: number; median: number | null } } } };
    expect(err).toBeInstanceOf(LighthouseRunError);
    expect(err.message).toContain('Asnjë nga 3 matjet');
    expect(err.series).toMatchObject({ valid: 0, representativeRun: null, stats: { performance: { n: 0, median: null } } });
  });

  it('konfigurim i ndryshëm brenda serisë shënohet (p.sh. Chrome tjetër)', () => {
    const run = (n: number, chrome: string): LhRunRecord => ({ run: n, status: 'ok', startedAt: '', durationMs: 1, technicalRetries: [], values: { performance: 50 }, config: { lighthouseVersion: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenWidth: 412, chromeMajor: chrome } });
    const s = summarizeSeries(2, [run(1, '154'), run(2, '155')], 10);
    expect(s.configConsistent).toBe(false);
    expect(s.configNotes[0]).toContain('Chrome: 154 → 155');
  });
});

// ------------------------------------------------------------ raporti, --save-lhr, etiketimi

function makeRun(lh: LighthouseData, series?: LighthouseData['series']): AuditRun {
  const ctx = makeCtx({ lighthouse: { status: 'ok', value: { ...lh, series } } });
  if (series) ctx.lighthouseSeries = series;
  const results = runModules(ctx);
  const issues = results.filter((r) => r.section === 'homepage').flatMap((r) => r.issues);
  return {
    id: 'test-run', url: ctx.url, startedAt: '2026-10-03T07:18:03.123Z', completedAt: '2026-10-03T07:20:40.000Z', status: 'completed',
    config: ctx.config, context: ctx, results, issues, siteIssues: [], businessIssues: [], qualityIssues: [], categories: categoryScores(results), health: computeHealth(results, issues),
    scoringVersion: '1.0', ruleSetVersion: 'test',
  };
}

async function seriesRun(perfs: [number, number][]) {
  const s = scripted(perfs.map(([p, l]) => fakeRun(p, l)));
  return runLighthouseSeries('https://e.com/', cfg(perfs.length, true), s.fn);
}

describe('Seria në raport: burimi i vlerave, --save-lhr, përputhshmëria', () => {
  it('Health/kategoritë vijnë nga matja përfaqësuese; issue-t e LCP etiketojnë burimin dhe intervalin veç', async () => {
    const v = await seriesRun([[40, 5200], [55, 4100], [48, 4700]]); // përfaqësuese: #3 (48)
    const run = makeRun(v, v.series);
    expect(run.categories.performance).toBe(48);
    const lcp = runPerformance(run.context!).issues.find((i) => i.code === 'LCP_POOR')!;
    expect(lcp.message).toBe('LCP 4.7s në mobile (lab, e simuluar)'); // vlera e matjes #3, jo mediana as min/max
    expect(lcp.evidence.at(-1)!.detected).toBe("Burimi i vlerës: matja përfaqësuese #3 nga 3 të planifikuara. Seria (informative, s'hyn në vlerë): mediana 4.7 s, min–max 4.1 s–5.2 s (3 matje të vlefshme)");
    const report = buildReport(run);
    expect((report.lighthouse as { series?: unknown }).series).toBeDefined();
    expect(report.limitations.join(' ')).toContain('matja përfaqësuese #3');
  });

  it('--save-lhr me seri: një LHR për çdo matje të vlefshme; lhrFile = përfaqësuesja; raporti i lidh', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'series-lhr-'));
    const v = await seriesRun([[60, 3000], [70, 2800], [65, 2900]]);
    const report = buildReport(makeRun(v, v.series));
    const { report: written, lhrPaths, lhrPath } = writeReport(report, dir, v.rawLhr, v.seriesLhrs);
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['example.com-20261003-071803.json', 'example.com-20261003-071803.run1.lhr.json', 'example.com-20261003-071803.run2.lhr.json', 'example.com-20261003-071803.run3.lhr.json']);
    expect(lhrPaths).toHaveLength(3);
    const lh = written.lighthouse as { lhrFile?: string; series: { representativeRun: number; runs: { run: number; lhrFile?: string }[] } };
    expect(lh.series.representativeRun).toBe(3);
    expect(lh.lhrFile).toBe('example.com-20261003-071803.run3.lhr.json');
    expect(path.basename(lhrPath!)).toBe(lh.lhrFile);
    expect(lh.series.runs.map((r) => r.lhrFile)).toEqual(['example.com-20261003-071803.run1.lhr.json', 'example.com-20261003-071803.run2.lhr.json', 'example.com-20261003-071803.run3.lhr.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'example.com-20261003-071803.run2.lhr.json'), 'utf8'))).toEqual({ marker: 'lhr-70-2800' });
    // raporti JSON s'përmban LHR-të e plota
    expect(fs.readFileSync(path.join(dir, files[0]!), 'utf8')).not.toContain('lhr-70-2800');
  });

  it('1 matje: raporti s\'ka seri dhe --save-lhr shkruan si më parë një .lhr.json', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'series-lhr1-'));
    const lh = fakeRun(70, 3000);
    const report = buildReport(makeRun(lh));
    expect((report.lighthouse as { series?: unknown }).series).toBeUndefined();
    writeReport(report, dir, lh.rawLhr, undefined);
    expect(fs.readdirSync(dir).sort()).toEqual(['example.com-20261003-071803.json', 'example.com-20261003-071803.lhr.json']);
  });
});

// ------------------------------------------------------------ dashboard

/** Raport minimal URL me seri ose pa (si raportet e vjetra). */
function report(o: { series?: Obj; perf?: number; lcp?: number; version?: string; chrome?: string; date?: string } = {}): Obj {
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', scoringVersion: '1.0', url: 'https://e.com/', finalUrl: 'https://e.com/', startedAt: o.date ?? '2026-10-03T07:18:03Z', completedAt: o.date ?? '2026-10-03T07:20:40Z', status: 'completed',
    lighthouse: { version: o.version ?? '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenEmulation: { width: 412 }, hostUserAgent: `Mozilla/5.0 Chrome/${o.chrome ?? '154'}.0.0.0`, benchmarkIndex: 830, failedAttempts: [], ...(o.series ? { series: o.series } : {}) },
    health: { score: 90, status: 'EXCELLENT', missingCategories: [] }, categories: { performance: o.perf ?? 63, accessibility: 94, bestPractices: 100 },
    modules: [{ module: 'performance', category: 'performance', metrics: [{ id: 'lcp', value: o.lcp ?? 4393 }, { id: 'cls', value: 0.014 }, { id: 'tbt', value: 751 }] }], issues: [],
  };
}

function seriesJson(perfs: number[], lcps: number[], extra: Obj = {}): Obj {
  const runs = perfs.map((p, i) => ({ run: i + 1, status: 'ok', startedAt: `2026-10-03T07:1${i}:00.000Z`, durationMs: 20000, values: { performance: p, lcpMs: lcps[i] }, technicalRetries: [], config: { benchmarkIndex: 830 } }));
  const s = summarizeSeries(perfs.length, runs.map((r) => ({ ...r, status: 'ok' as const, config: { lighthouseVersion: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenWidth: 412, chromeMajor: '154', benchmarkIndex: 830 } })), 60000);
  return { ...s, ...extra } as unknown as Obj;
}

describe('Seria në dashboard', () => {
  const files = { shotExists: () => false, lhrExists: (n: string) => n.endsWith('.run1.lhr.json') };

  it('raporti me seri: paneli me çdo matje, medianën, min–max, përfaqësuesen dhe rregullin', () => {
    const s = seriesJson([63, 63, 59], [4393, 4576, 5017]);
    (s.runs as Obj[])[0]!.lhrFile = 'example.com-20261003-071803.run1.lhr.json';
    (s.runs as Obj[])[1]!.lhrFile = 'example.com-20261003-071803.run2.lhr.json';
    const html = urlReportView('example.com-20261003-071803.json', report({ series: s }), {}, files);
    expect(html).toContain('Lighthouse: seri matjesh');
    expect(html).toContain('3 të vlefshme nga 3 të planifikuara');
    expect(html).toMatch(/1 <span class="badge b-complete">përfaqësuese<\/span>/);
    expect(html).toContain('<strong>4.58 s</strong>'); // mediana e LCP
    expect(html).toContain('4.39 s–5.02 s');
    expect(html).toContain('href="/lhr/example.com-20261003-071803.run1.lhr.json"');
    expect(html).toContain('mungon lokalisht'); // run2.lhr.json s'ekziston
    expect(html).toContain('Burimi i vlerave:');
  });

  it('raport i vjetër (pa seri): s\'ka panel serie dhe hapet si më parë', () => {
    const r = report();
    expect(seriesOf(r)).toBeNull();
    const html = urlReportView('e.com-20261001-124416.json', r, {}, files);
    expect(html).not.toContain('Lighthouse: seri matjesh');
    expect(html).toContain('Health Score');
    // për krahasim trajtohet si 1 matje, pa interval
    expect(seriesForCompare(r)).toMatchObject({ real: false, valid: 1, stats: { performance: { n: 1, median: 63, min: 63, max: 63 } } });
  });

  it('krahasimi i dy serive: intervalet që mbivendosen → brenda variacionit; që s\'mbivendosen → kërkon konfirmim; kurrë "përmirësim i konfirmuar"', () => {
    const a = seriesForCompare(report({ series: seriesJson([60, 63, 59], [4400, 4600, 5000]) }))!;
    const b = seriesForCompare(report({ series: seriesJson([62, 64, 61], [3000, 3100, 3200]) }))!;
    const c = compareSeries(a, b);
    expect(c.comparable).toBe(true);
    expect(c.rows.find((r) => r.key === 'performance')).toMatchObject({ verdict: 'overlap', direction: 'up' });
    expect(c.rows.find((r) => r.key === 'lcpMs')).toMatchObject({ verdict: 'outside', direction: 'down' });
    const html = compareView(compareReports('a.json', report({ series: seriesJson([60, 63, 59], [4400, 4600, 5000]) }), 'b.json', report({ series: seriesJson([62, 64, 61], [3000, 3100, 3200]) })), undefined, c);
    expect(html).toContain('Lighthouse: krahasimi i serive');
    expect(html).toContain('ndryshim jashtë intervaleve — kërkon konfirmim');
    expect(html).toContain('intervalet e vëzhguara mbivendosen — pa përfundim');
    expect(html).toContain('Intervalet min–max janë orientuese');
    expect(html).not.toContain('brenda variacionit të serive');
    expect(html).not.toMatch(/përmirësim i konfirmuar<\/span>|>u përmirësua</);
  });

  it('konfigurime të ndryshme → s\'krahasohen; seri kundrejt raportit me 1 matje → pa interval', () => {
    const a = seriesForCompare(report({ series: seriesJson([60, 63, 59], [4400, 4600, 5000]) }))!;
    const other = seriesForCompare(report({ version: '12.8.0', chrome: '150' }))!;
    const c = compareSeries(a, other);
    expect(c.comparable).toBe(false);
    expect(c.differences.join(' ')).toContain('Versioni i Lighthouse: 13.5.0 → 12.8.0');
    const html = compareView(compareReports('a.json', report({ series: seriesJson([60, 63, 59], [4400, 4600, 5000]) }), 'b.json', report({ version: '12.8.0', chrome: '150' })), undefined, c);
    expect(html).toContain("S'krahasohen:");
    expect(html).not.toContain('intervalet e vëzhguara mbivendosen');
    const single = compareSeries(a, seriesForCompare(report())!);
    expect(single.rows.find((r) => r.key === 'performance')!.verdict).toBe('single');
    expect(single.notes.join(' ')).toContain('Me 1 matje s\'ka interval');
  });

  it('fuqi shumë e ndryshme e makinës (benchmarkIndex) → paralajmërim i dukshëm; rreshtat "jashtë intervaleve" e përmendin ngarkesën', () => {
    const busy = seriesJson([63, 63, 59], [4393, 4576, 5017]);
    for (const r of busy.runs as Obj[]) (r.config as Obj).benchmarkIndex = 864;
    const idle = seriesJson([76, 78, 75], [5050, 4990, 5080]);
    for (const r of idle.runs as Obj[]) (r.config as Obj).benchmarkIndex = 2074;
    const c = compareSeries(seriesForCompare(report({ series: busy }))!, seriesForCompare(report({ series: idle }))!);
    expect(c.machineWarning).toContain('864 → 2074');
    expect(c.rows.find((r) => r.key === 'performance')).toMatchObject({ verdict: 'outside' });
    expect(c.rows.find((r) => r.key === 'performance')!.note).toContain('ngarkesa e kompjuterit');
    const html = compareView(compareReports('a.json', report({ series: busy }), 'b.json', report({ series: idle })), undefined, c);
    expect(html).toContain('<strong>Kujdes:</strong> Fuqia e makinës');
    // pa ndryshim të madh të makinës: pa paralajmërim
    expect(compareSeries(seriesForCompare(report({ series: seriesJson([60, 61], [4000, 4100]) }))!, seriesForCompare(report({ series: seriesJson([62, 63], [3900, 4000]) }))!).machineWarning).toBeUndefined();
  });

  it('dy raporte të vjetra pa seri: krahasimi mbetet si më parë, pa panel serie', () => {
    const html = compareView(compareReports('a.json', report({ date: '2026-10-01T12:44:16Z' }), 'b.json', report({ perf: 70 })), undefined, compareSeries(seriesForCompare(report())!, seriesForCompare(report({ perf: 70 }))!));
    expect(html).not.toContain('Lighthouse: krahasimi i serive');
  });

  it('formulari: parazgjedhja 1 s\'shton argument; 2–5 → --lighthouse-runs; jashtë kufirit → gabim', () => {
    const args = (lighthouseRuns?: string) => parseUrlForm({ url: 'https://e.com', lighthouse: 'on', crawl: 'on', ...(lighthouseRuns ? { lighthouseRuns } : {}) });
    const def = args();
    expect(def.ok && def.value.args).not.toContain('--lighthouse-runs');
    const three = args('3');
    expect(three.ok && three.value.args.join(' ')).toContain('--lighthouse-runs 3');
    expect(three.ok && three.value.options).toContain('Lighthouse mobile: 3 matje');
    for (const bad of ['0', '6', '2.5', 'x']) expect(args(bad).ok, bad).toBe(false);
    const off = parseUrlForm({ url: 'https://e.com', lighthouseRuns: '3' });
    expect(off.ok && off.value.args).toContain('--no-lighthouse');
    expect(off.ok && off.value.args).not.toContain('--lighthouse-runs');
  });
});
