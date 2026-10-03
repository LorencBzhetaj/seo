import { describe, expect, it } from 'vitest';
import { compareReports } from '../src/dashboard/compare.js';
import { compareSeries, seriesForCompare, seriesOf } from '../src/dashboard/lh-series.js';
import type { Obj } from '../src/dashboard/store.js';
import { compareView, urlReportView } from '../src/dashboard/views.js';
import { summarizeSeries, type LhRunRecord } from '../src/lighthouse/series.js';

/**
 * Faza 4, saktësimet para commit-it:
 * 1) intervalet që mbivendosen → "intervalet e vëzhguara mbivendosen — pa përfundim" (orientuese);
 * 2) seri me < 2 matje të vlefshme → "seri me prova të pamjaftueshme: 1/N", pa interval;
 * 3) Availability që ndryshon vetëm nga TTFB (1 matje) → "ndryshim i matur, kërkon konfirmim";
 *    ndryshimet e statusit HTTP/qasjes mbeten të qarta;
 * dhe rreshti i pikëve s'kundërshton panelin e serive.
 */

const CONFIG = { lighthouseVersion: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenWidth: 412, chromeMajor: '154', benchmarkIndex: 2000 };

function seriesJson(perfs: (number | null)[]): Obj {
  const runs: LhRunRecord[] = perfs.map((p, i) => (p === null
    ? { run: i + 1, status: 'failed', startedAt: '', durationMs: 1000, technicalRetries: [], error: { code: 'NO_FCP', message: 'Lighthouse runtimeError NO_FCP' } }
    : { run: i + 1, status: 'ok', startedAt: `2026-10-03T07:1${i}:00Z`, durationMs: 20000, technicalRetries: [], values: { performance: p, accessibility: 94, bestPractices: 100, lcpMs: 5000 }, config: CONFIG }));
  return summarizeSeries(perfs.length, runs, 60000) as unknown as Obj;
}

interface Opt {
  series?: Obj;
  perf?: number;
  availability?: number;
  ttfb?: number;
  httpStatus?: number;
  responseTime?: 'pass' | 'warning';
  access?: string;
  slow?: boolean;
}

/** Raport URL i plotë sa duhet për krahasimin (health, kategoritë, modulet, issue-t). */
function report(o: Opt = {}): Obj {
  const httpStatus = o.httpStatus ?? 200;
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', scoringVersion: '1.0', url: 'https://e.com/', finalUrl: 'https://e.com/', startedAt: '2026-10-03T07:20:41Z', completedAt: '2026-10-03T07:22:45Z', status: 'completed',
    access: { state: o.access ?? 'ok', httpStatus },
    lighthouse: { version: '13.5.0', formFactor: 'mobile', throttlingMethod: 'simulate', screenEmulation: { width: 412 }, hostUserAgent: 'Mozilla/5.0 Chrome/154.0.0.0', benchmarkIndex: 2000, failedAttempts: [], ...(o.series ? { series: o.series } : {}) },
    health: { score: 93, status: 'EXCELLENT', missingCategories: [] },
    categories: { availability: o.availability ?? 100, seoTechnical: 100, security: 95, performance: o.perf ?? 76, accessibility: 94, bestPractices: 100 },
    modules: [
      {
        module: 'availability', category: 'availability', score: o.availability ?? 100,
        checks: [
          { id: 'http-status', status: httpStatus === 200 ? 'pass' : 'fail', score: httpStatus === 200 ? 1 : 0 },
          { id: 'response-time', status: o.responseTime ?? 'pass', score: (o.responseTime ?? 'pass') === 'pass' ? 1 : 0.85 },
          { id: 'redirect-chain', status: 'pass', score: 1 },
        ],
        metrics: [{ id: 'http-status', value: httpStatus }, { id: 'ttfb', value: o.ttfb ?? 695 }],
      },
      { module: 'performance', category: 'performance', metrics: [{ id: 'lcp', value: 5000 }] },
    ],
    issues: o.slow ? [{ code: 'SLOW_SERVER_RESPONSE', module: 'availability', scope: 'site', url: 'https://e.com/', severity: 'low', message: `TTFB i faqes hyrëse ${o.ttfb} ms (matje e vetme lokale)`, evidence: [] }] : [],
  };
}

const row = (c: ReturnType<typeof compareReports>, key: string) => c.scores.find((r) => r.key === key)!;

describe('Availability: TTFB i një matjeje kundrejt ndryshimeve reale', () => {
  it('100 → 98 vetëm nga TTFB 695 → 966 ms (pragu 800): "rënie e matur, kërkon konfirmim" me arsyen; gjetja SLOW_SERVER_RESPONSE s\'quhet e re pa kusht', () => {
    const a = report({ ttfb: 695 });
    const b = report({ ttfb: 966, availability: 98, responseTime: 'warning', slow: true });
    const c = compareReports('a.json', a, 'b.json', b);
    expect(row(c, 'availability')).toMatchObject({ a: 100, b: 98, verdict: 'measured-decrease' });
    expect(row(c, 'availability').note).toContain('TTFB 695 ms → 966 ms');
    expect(row(c, 'availability').note).toContain('statusi HTTP 200 në të dy');
    const slow = c.added.find((i) => i.code === 'SLOW_SERVER_RESPONSE')!;
    expect(slow.reason).toContain('matje e vetme kohore (TTFB)');
    // anasjelltas: TTFB s'del më te B → s'quhet "u zgjidh"
    const back = compareReports('b.json', b, 'a.json', a);
    expect(back.resolved.map((i) => i.code)).not.toContain('SLOW_SERVER_RESPONSE');
    expect(back.notRedetected.map((i) => i.code)).toContain('SLOW_SERVER_RESPONSE');
    expect(row(back, 'availability').verdict).toBe('measured-increase');
    const html = compareView(c);
    expect(html).toContain('rënie e matur, kërkon konfirmim');
    // te "Të reja", arsyeja shfaqet në kolonën "Kujdes"
    expect(html).toContain('<th>Kujdes</th>');
    expect(html).toContain('matje e vetme kohore (TTFB): mund të jetë luhatje, kërkon konfirmim');
    expect(html).not.toMatch(/Availability<\/td>[^]*?u përkeqësua/);
  });

  it('statusi HTTP ndryshon (200 → 503) ose qasja (ok → blocked) → mbetet "u përkeqësua", me shkakun të qartë', () => {
    const c = compareReports('a.json', report(), 'b.json', report({ httpStatus: 503, availability: 33 }));
    expect(row(c, 'availability')).toMatchObject({ verdict: 'worsened' });
    expect(row(c, 'availability').note).toContain('statusi HTTP 200 → 503');
    const blocked = compareReports('a.json', report(), 'b.json', report({ httpStatus: 403, availability: 33, access: 'blocked' }));
    expect(row(blocked, 'availability').verdict).toBe('worsened');
    expect(row(blocked, 'availability').note).toContain('qasja ok → blocked');
    // TTFB dhe statusi ndryshojnë bashkë → ndryshim real, jo vetëm luhatje
    const both = compareReports('a.json', report(), 'b.json', report({ httpStatus: 503, availability: 30, ttfb: 1500, responseTime: 'warning' }));
    expect(row(both, 'availability').verdict).toBe('worsened');
  });
});

describe('Rreshti i pikëve dhe paneli i serive s\'kundërshtohen', () => {
  it('Performance 70 → 76 (> ±5) me intervale që mbivendosen → "pa përfundim" në të dyja vendet', () => {
    const a = report({ perf: 70, series: seriesJson([70, 74, 66]) });
    const b = report({ perf: 76, series: seriesJson([76, 72, 78]) });
    const c = compareReports('a.json', a, 'b.json', b);
    expect(row(c, 'performance')).toMatchObject({ delta: 6, verdict: 'inconclusive' });
    const s = compareSeries(seriesForCompare(a)!, seriesForCompare(b)!);
    expect(s.rows.find((r) => r.key === 'performance')!.verdict).toBe('overlap');
    const html = compareView(c, undefined, s);
    expect(html).toContain('intervalet e serive mbivendosen — pa përfundim');
    expect(html).toContain('intervalet e vëzhguara mbivendosen — pa përfundim');
    expect(html).not.toContain('rritje e matur, kërkon konfirmim</span></td><td class="note">intervalet e vëzhguara');
  });

  it('intervale që s\'mbivendosen → "rritje e matur, kërkon konfirmim" në rresht dhe "jashtë intervaleve" në panel; kurrë "u përmirësua"', () => {
    const a = report({ perf: 63, series: seriesJson([63, 63, 59]) });
    const b = report({ perf: 76, series: seriesJson([76, 78, 75]) });
    const c = compareReports('a.json', a, 'b.json', b);
    expect(row(c, 'performance').verdict).toBe('measured-increase');
    expect(row(c, 'performance').note).toContain("intervalet e serive s'mbivendosen");
    expect(compareSeries(seriesForCompare(a)!, seriesForCompare(b)!).rows.find((r) => r.key === 'performance')!.verdict).toBe('outside');
    for (const r of c.scores.filter((x) => ['performance', 'accessibility', 'bestPractices'].includes(x.key))) expect(['improved', 'worsened']).not.toContain(r.verdict);
  });
});

describe('Seri me prova të pamjaftueshme (1/N)', () => {
  it('raporti: rezultati ruhet, por shfaqet dukshëm "seri me prova të pamjaftueshme: 1/3 matje të vlefshme"', () => {
    const r = report({ perf: 70, series: seriesJson([null, 70, null]) });
    const s = seriesOf(r)!;
    expect(s).toMatchObject({ insufficient: true, valid: 1, planned: 3, representativeRun: 2 });
    const html = urlReportView('e.com-20261003-072041.json', r, {}, { shotExists: () => false, lhrExists: () => false });
    expect(html).toContain('seri me prova të pamjaftueshme: 1/3 matje të vlefshme');
    expect(html).toContain('<strong>70</strong>'); // mediana = vlera e vetme, e ruajtur
    // 3 nga 3 të vlefshme → pa paralajmërim
    expect(seriesOf(report({ series: seriesJson([70, 72, 71]) }))!.insufficient).toBe(false);
  });

  it('krahasimi: s\'trajtohet si interval — rreshtat "1 matje", Performance me logjikën e matjes së vetme, paralajmërim në panel dhe në kujdeset', () => {
    const a = report({ perf: 70, series: seriesJson([null, 70, null, null, null]) });
    const b = report({ perf: 78, series: seriesJson([78, 76, 79]) });
    const s = compareSeries(seriesForCompare(a)!, seriesForCompare(b)!);
    expect(s.rows.find((r) => r.key === 'performance')!.verdict).toBe('single');
    const c = compareReports('a.json', a, 'b.json', b);
    expect(c.caveats.join(' ')).toContain('Seri me prova të pamjaftueshme: A 1/5 matje të vlefshme');
    expect(row(c, 'performance').verdict).toBe('measured-increase'); // si një matje e vetme, jo "pa përfundim" nga intervale
    expect(row(c, 'performance').note).toContain('një ekzekutim Lighthouse për raport');
    const html = compareView(c, undefined, s);
    expect(html).toContain('A: seri me prova të pamjaftueshme: 1/5 matje të vlefshme');
    expect(html).not.toContain('intervalet e vëzhguara mbivendosen');
  });
});
