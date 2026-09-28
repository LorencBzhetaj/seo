import { describe, expect, it } from 'vitest';
import { lcpEvidence, runPerformance } from '../src/modules/lighthouse-modules.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { fixture, makeCtx } from './helpers.js';

// LHR reale e gjecaj.al (2026-09-28 18:04 UTC), e shkurtuar te auditet e LCP.
// LCP e simuluar 4750ms; fazat 4882+78+159+213 = 5332ms = observedLargestContentfulPaint.
const gjecaj = (): LighthouseData => JSON.parse(fixture('lighthouse-gjecaj-lcp.json')) as LighthouseData;

function withMetrics(lh: LighthouseData, observed: number | undefined): LighthouseData {
  const items = observed === undefined ? [{}] : [{ largestContentfulPaint: 4750, observedLargestContentfulPaint: observed }];
  lh.audits.metrics = { ...lh.audits.metrics!, details: { type: 'debugdata', items } };
  return lh;
}

/** Rasti i raportit 17:56: LCP e simuluar 4759ms, fazat 1003+74+130+247 = 1454ms. */
function report1756(observed: number | undefined): LighthouseData {
  const lh = withMetrics(gjecaj(), observed);
  lh.audits['largest-contentful-paint']!.numericValue = 4759;
  const table = (lh.audits['lcp-breakdown-insight']!.details!.items as { type: string; items?: { duration: number }[] }[]).find((i) => i.type === 'table')!;
  [1003, 74, 130, 247].forEach((d, i) => (table.items![i]!.duration = d));
  return lh;
}

describe('LCP evidence: simuluar vs vëzhguar', () => {
  it('gjecaj.al: LCP e simuluar ≠ shuma e fazave; fazat raportohen vetëm si ndarje e LCP-së së vëzhguar', () => {
    const { evidence, breakdownMatches, simulated } = lcpEvidence(gjecaj(), 'https://gjecaj.al/');
    expect(simulated).toBe(true);
    expect(breakdownMatches).toBe(true);
    expect(evidence[0]!.detected).toBe(
      'LCP=4750ms, e simuluar nga Lighthouse (Slow 4G, CPU 4x); LCP i vëzhguar në të njëjtin ngarkim pa throttling=5332ms',
    );
    expect(evidence[1]!.detected).toMatch(/^Elementi LCP në trace: .*img\.gj-hero__bg/);
    expect(evidence[1]!.detected).toContain('(i njëjtë te lcp-breakdown dhe lcp-discovery)');
    expect(evidence[2]!.detected).toBe(
      'Ndarja e LCP-së së VËZHGUAR (5332ms, pa throttling): Time to first byte=4882ms, Resource load delay=78ms, Resource load duration=159ms, Element render delay=213ms; shuma=5332ms. Nuk është ndarje e 4750ms të simuluar.',
    );
  });

  it('raporti 17:56 (4759ms vs 1454ms): pa observedLCP, ndarja s\'paraqitet si shkak', () => {
    const { evidence, breakdownMatches } = lcpEvidence(report1756(undefined), 'https://gjecaj.al/');
    expect(breakdownMatches).toBe(false);
    const all = evidence.map((e) => e.detected).join(' | ');
    expect(all).not.toMatch(/Time to first byte=1003ms/);
    expect(all).toContain("Ndarja nga Lighthouse (shuma=1454ms) s'u përdor");
    expect(all).toContain('mungon në LHR');
  });

  it('raporti 17:56: kur observedLCP=1454ms, ndarja i përket asaj matjeje dhe etiketohet si e tillë', () => {
    const { evidence, breakdownMatches } = lcpEvidence(report1756(1454), 'https://gjecaj.al/');
    expect(breakdownMatches).toBe(true);
    expect(evidence[0]!.detected).toContain('LCP=4759ms, e simuluar');
    expect(evidence[2]!.detected).toContain('Ndarja e LCP-së së VËZHGUAR (1454ms');
    expect(evidence[2]!.detected).toContain('Nuk është ndarje e 4759ms të simuluar');
  });

  it('observedLCP që s\'përputhet me fazat → ndarja s\'përdoret', () => {
    const { breakdownMatches, evidence } = lcpEvidence(withMetrics(gjecaj(), 3000), 'https://gjecaj.al/');
    expect(breakdownMatches).toBe(false);
    expect(evidence.map((e) => e.detected).join(' ')).toContain("s'përputhet me LCP-në e vëzhguar (3000ms)");
  });

  it('throttling devtools (LCP e matur): ndarja që mblidhet në LCP paraqitet si ndarje e LCP-së', () => {
    const lh = gjecaj();
    lh.throttlingMethod = 'devtools';
    lh.audits['largest-contentful-paint']!.numericValue = 5332;
    const { evidence, breakdownMatches, simulated } = lcpEvidence(lh, 'https://gjecaj.al/');
    expect(simulated).toBe(false);
    expect(breakdownMatches).toBe(true);
    expect(evidence[2]!.detected).toMatch(/^Ndarja e LCP: .*shuma=5332ms = LCP$/);
  });

  it('elementi s\'konfirmohet kur lcp-discovery tregon nyje tjetër', () => {
    const lh = gjecaj();
    const disc = lh.audits['lcp-discovery-insight']!.details!.items as { type: string; lhId?: string }[];
    disc.filter((i) => i.type === 'node').forEach((n) => (n.lhId = 'page-9-DIV'));
    expect(lcpEvidence(lh, 'https://gjecaj.al/').evidence[1]!.detected).toContain("(s'u konfirmua nga një burim i dytë)");
  });

  it('issue LCP_POOR: fix-i s\'udhëzon te ndarja si shkak i 4.8s', () => {
    const r = runPerformance(makeCtx({ url: 'https://gjecaj.al/', lighthouse: { status: 'ok', value: gjecaj() } }));
    const i = r.issues.find((x) => x.code === 'LCP_POOR')!;
    expect(i.message).toBe('LCP 4.8s në mobile (lab, e simuluar)');
    expect(i.fix).not.toMatch(/Shiko ndarjen e LCP/);
    expect(i.fix).toContain('jo shkakun e vlerës së simuluar');
    expect(i.fix).toContain('DevTools → Performance');
  });
});
