import { describe, expect, it } from 'vitest';
import { runModules, MVP1_MODULES, type AuditModule } from '../src/core/run.js';
import { runAccessibility, runBestPractices, runPerformance, tableItems } from '../src/modules/lighthouse-modules.js';
import { computeHealth } from '../src/scoring/scorer.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

describe('Lighthouse → performance/accessibility/best-practices (LHR reale e shkurtuar, web.dev)', () => {
  const ctx = makeCtx({ lighthouse: { status: 'ok', value: lighthouseFixture() } });

  it('performance: score = kategoria e Lighthouse, metrikat lab dhe INP unavailable', () => {
    const r = runPerformance(ctx);
    expect(r.score).toBe(72);
    const metric = (id: string) => r.metrics.find((m) => m.id === id)!;
    expect(metric('lcp')).toMatchObject({ value: 3424, unit: 'ms', status: 'measured' });
    expect(metric('tbt').value).toBe(382);
    expect(metric('cls').value).toBe(0.001);
    // INP s'paraqitet pa të dhëna reale
    expect(metric('inp')).toMatchObject({ value: null, status: 'unavailable' });
    expect(metric('inp').reason).toMatch(/CrUX/);
    expect(r.limitations.join(' ')).toMatch(/INP: unavailable/);
  });

  it('LCP 3.4s (simuluar) → LCP_NEEDS_IMPROVEMENT; ndarja etiketohet si e vëzhguar (1487ms), jo si ndarje e 3424ms', () => {
    const r = runPerformance(ctx);
    const lcp = r.issues.find((i) => i.code === 'LCP_NEEDS_IMPROVEMENT')!;
    expect(lcp.severity).toBe('medium');
    expect(lcp.evidence[0]!.detected).toBe(
      'LCP=3424ms, e simuluar nga Lighthouse (Slow 4G, CPU 4x); LCP i vëzhguar në të njëjtin ngarkim pa throttling=1487ms',
    );
    expect(lcp.evidence[0]!.detected).not.toMatch(/Time to first byte/);
    expect(lcp.evidence.map((e) => e.detected).join(' | ')).toContain('div.devsite-landing-row-item-description-content');
    const bd = lcp.evidence.find((e) => e.detected.startsWith('Ndarja e LCP-së së VËZHGUAR'))!;
    expect(bd.detected).toContain('Time to first byte=935ms');
    expect(bd.detected).toContain('shuma=1487ms');
    expect(bd.detected).toContain('Nuk është ndarje e 3424ms të simuluar');
    expect(r.metrics.find((m) => m.id === 'lcp-observed')!.value).toBe(1487);
    expect(r.issues.some((i) => i.code === 'TBT_NEEDS_IMPROVEMENT')).toBe(true);
    expect(r.issues.some((i) => i.code.startsWith('CLS'))).toBe(false);
  });

  it('insights me kursim → issue me URL konkrete të burimeve', () => {
    const r = runPerformance(ctx);
    const rb = r.issues.find((i) => i.code === 'LH_RENDER_BLOCKING')!;
    expect(rb).toBeDefined();
    expect(rb.evidence.some((e) => e.detected.includes('fonts.googleapis.com'))).toBe(true);
    expect(rb.fix.length).toBeGreaterThan(20);
  });

  it('pa dyfishim: auditet që janë provë për LCP/CLS/TBT s\'dalin si issue të veçanta; asnjë provë bosh', () => {
    const r = runPerformance(ctx);
    const codes = r.issues.map((i) => i.code);
    for (const c of ['LH_LAYOUT_SHIFTS', 'LH_CLS_CULPRITS', 'LH_BOOTUP_TIME', 'LH_MAINTHREAD_WORK_BREAKDOWN', 'LH_LCP_BREAKDOWN']) {
      expect(codes).not.toContain(c);
    }
    expect(new Set(codes).size).toBe(codes.length);
    for (const i of r.issues) {
      expect(i.evidence[0]!.detected.startsWith('…'), i.code).toBe(false);
      for (const e of i.evidence) expect(e.detected, i.code).not.toMatch(/\n/);
    }
  });

  it('accessibility: auditet që dështuan → issue me snippet elementi', () => {
    const r = runAccessibility(ctx);
    expect(r.score).toBe(90);
    const contrast = r.issues.find((i) => i.code === 'A11Y_COLOR_CONTRAST')!;
    expect(contrast.severity).toBe('medium'); // pesha 7 te Lighthouse
    expect(contrast.evidence[0]!.detected).toMatch(/a\.button|<a /);
    expect(r.limitations.join(' ')).toMatch(/verifikim manual/);
    expect(r.coverage.checked).toBeGreaterThan(0);
  });

  it('best practices: score 100 dhe pa issue', () => {
    const r = runBestPractices(ctx);
    expect(r.score).toBe(100);
    expect(r.issues).toEqual([]);
  });

  it('tableItems hap edhe details të tipit list', () => {
    expect(tableItems(lighthouseFixture().audits['lcp-breakdown-insight']).length).toBeGreaterThan(1);
  });
});

describe('Lighthouse i padisponueshëm → skipped/partial, jo 0 ose 100', () => {
  it('Lighthouse dështoi: tre kategoritë null me arsyen e gabimit', () => {
    const ctx = makeCtx({ lighthouse: { status: 'error', error: 'Lighthouse runtimeError NO_FCP: page did not paint' } });
    for (const run of [runPerformance, runAccessibility, runBestPractices]) {
      const r = run(ctx);
      expect(r.score).toBeNull();
      expect(r.status).toBe('skipped');
      expect(r.reason).toContain('NO_FCP');
    }
    expect(runPerformance(ctx).metrics.find((m) => m.id === 'inp')!.status).toBe('unavailable');
  });

  it('auditi i plotë pa Lighthouse → Health PARTIAL, por modulet e tjera kanë rezultat', () => {
    const results = runModules(makeCtx());
    const health = computeHealth(results, results.flatMap((r) => r.issues));
    expect(health.status).toBe('PARTIAL');
    expect(health.score).toBeNull();
    expect(results.find((r) => r.module === 'seo-technical')!.score).toBe(100);
    expect(results.find((r) => r.module === 'performance')!.reason).toMatch(/çaktivizua/);
  });
});

describe('Runner', () => {
  it('gabimi i një moduli s\'fshin rezultatet e të tjerëve', () => {
    const boom: AuditModule = {
      name: 'boom',
      category: 'security',
      run: () => {
        throw new Error('parser crashed');
      },
    };
    const results = runModules(makeCtx(), [MVP1_MODULES[0]!, boom, MVP1_MODULES[1]!]);
    expect(results.map((r) => r.module)).toEqual(['availability', 'boom', 'seo-technical']);
    expect(results[1]).toMatchObject({ status: 'skipped', score: null });
    expect(results[1]!.reason).toContain('parser crashed');
    expect(results[0]!.score).toBe(100);
    expect(results[2]!.score).toBe(100);
  });
});
