import { describe, expect, it } from 'vitest';
import type { AuditResult, CategoryKey, Issue, IssueDraft } from '../src/core/schemas.js';
import { computePriority, finalizeIssue, sortIssues } from '../src/intelligence/priority.js';
import { ModuleBuilder } from '../src/modules/helpers.js';
import { computeHealth, CRITICAL_CAP } from '../src/scoring/scorer.js';

function draft(over: Partial<IssueDraft> = {}): IssueDraft {
  return {
    code: 'X', scope: 'page', url: 'https://e.com/', severity: 'medium', impact: 'test', impactLevel: 'medium', effort: 'low',
    message: 'm', whyItMatters: 'w', fix: 'fix this properly', evidence: [{ type: 'dom', url: 'https://e.com/', detected: 'd' }],
    ...over,
  };
}

function moduleResult(category: CategoryKey, score: number | null, issues: Issue[] = [], reason?: string): AuditResult {
  return {
    module: category, category, score, status: score === null ? 'skipped' : 'pass', partial: false, reason,
    coverage: { checked: score === null ? 0 : 5, discovered: 5, truncated: false }, checks: [], issues, metrics: [], limitations: [],
  };
}

/** Një modul për kategori; kategoritë e papërmendura marrin 90. */
const allCategories = (over: Partial<Record<CategoryKey, number | null>> = {}) =>
  (['availability', 'seoTechnical', 'security', 'performance', 'accessibility', 'bestPractices'] as CategoryKey[]).map((k) =>
    moduleResult(k, k in over ? over[k]! : 90, [], k in over && over[k] === null ? `${k} dështoi` : undefined),
  );

describe('Category score (ModuleBuilder)', () => {
  it('llogarit mesataren e peshuar vetëm nga kontrollet e kryera', () => {
    const m = new ModuleBuilder('t', 'security');
    m.check('a', 'A', 3); // pass → 1
    m.check('b', 'B', 1, [draft({ severity: 'high' })]); // 0.3
    m.skip('c', 'C', 4, 'TLS s\'u lexua'); // jashtë pikëzimit
    m.info('d', 'D', ['vetëm info']); // jashtë pikëzimit
    m.notApplicable('e', 'E', 'http');
    const r = m.build();
    expect(r.score).toBe(Math.round(((3 * 1 + 1 * 0.3) / 4) * 100)); // 83, jo i ulur nga skipped
    expect(r.partial).toBe(true);
    expect(r.coverage).toEqual({ checked: 2, discovered: 3, truncated: false });
    expect(r.limitations[0]).toContain('c (TLS s\'u lexua)');
  });

  it('kur të gjitha kontrollet janë skipped: score null (jo 0, jo 100) me arsye', () => {
    const m = new ModuleBuilder('t', 'seoTechnical');
    m.skip('a', 'A', 2, 'HTML mungon');
    m.skip('b', 'B', 2, 'HTML mungon');
    const r = m.build();
    expect(r.score).toBeNull();
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('HTML mungon');
  });

  it('vetëm info/not_applicable → not_applicable, score null', () => {
    const m = new ModuleBuilder('t', 'seoTechnical');
    m.info('a', 'A', ['x']);
    expect(m.build()).toMatchObject({ score: null, status: 'not_applicable' });
  });

  it('severity → score i kontrollit: critical 0, high .3, medium .6, low .85', () => {
    const scores = (['critical', 'high', 'medium', 'low'] as const).map((s) => {
      const m = new ModuleBuilder('t', 'security');
      return m.check('a', 'A', 1, [draft({ severity: s })]).score;
    });
    expect(scores).toEqual([0, 0.3, 0.6, 0.85]);
  });
});

describe('Health Score', () => {
  it('mesatare e peshuar e kategorive, status sipas pragjeve', () => {
    const h = computeHealth(allCategories({ availability: 100, seoTechnical: 80, security: 60, performance: 90, accessibility: 100, bestPractices: 100 }), []);
    // .15*100 + .2*80 + .2*60 + .2*90 + .15*100 + .1*100 = 86
    expect(h.score).toBe(86);
    expect(h.status).toBe('GOOD');
    expect(h.modifiers).toEqual([]);
  });

  it('Security e ulët s\'fshihet pas SEO të lartë: ndikon me peshën e vet', () => {
    const h = computeHealth(allCategories({ security: 40, seoTechnical: 95 }), []);
    expect(h.score).toBeLessThan(90);
  });

  it('kategori kyçe mungon (Lighthouse skipped) → PARTIAL, score dhe baseScore null, arsyeja në limitations', () => {
    const results = allCategories({ performance: null, accessibility: null, bestPractices: null });
    const h = computeHealth(results, []);
    expect(h.score).toBeNull();
    expect(h.baseScore).toBeNull();
    expect(h.status).toBe('PARTIAL');
    expect(h.missingCategories).toEqual(['performance', 'accessibility', 'bestPractices']);
    expect(h.limitations[0]).toMatch(/Health Score nuk u gjenerua/);
    expect(h.limitations.join('\n')).toContain('performance dështoi');
  });

  it('kategori jo-kyçe mungon → score me peshat e rinormalizuara + kufizim i shënuar', () => {
    const h = computeHealth(allCategories({ accessibility: null }), []);
    expect(h.score).toBe(90);
    expect(h.limitations.join(' ')).toMatch(/rinormalizuan/);
  });

  it('critical i konfirmuar (confidence ≥ 0.9) kufizon score-in në 50 dhe e shpjegon', () => {
    const critical = finalizeIssue(draft({ code: 'HOMEPAGE_NOINDEX', severity: 'critical' }), 'seo');
    const h = computeHealth(allCategories(), [critical]);
    expect(h.score).toBe(CRITICAL_CAP);
    expect(h.modifiers[0]).toMatchObject({ code: 'CRITICAL_ISSUE_CAP', before: 90, after: 50 });
    expect(h.modifiers[0]!.reason).toContain('HOMEPAGE_NOINDEX');
    expect(h.critical).toBe(1);
  });

  it('critical i pasigurt (confidence < 0.9) NUK aktivizon kufizimin', () => {
    const unsure = finalizeIssue(draft({ code: 'SITE_UNREACHABLE', severity: 'critical', confidence: 0.8 }), 'availability');
    const h = computeHealth(allCategories(), [unsure]);
    expect(h.score).toBe(90);
    expect(h.modifiers).toEqual([]);
    expect(h.limitations.join(' ')).toMatch(/pa konfirmim/);
  });

  it('numëron needsManualReview dhe mbulimin', () => {
    const i = finalizeIssue(draft({ confidence: 0.5 }), 'x');
    const h = computeHealth(allCategories(), [i]);
    expect(h.needsManualReview).toBe(1);
    expect(h.coverage).toEqual({ checked: 30, discovered: 30, truncated: false });
  });
});

describe('Priority', () => {
  it('formula severity × impact × scope × confidence ÷ effort, normalizuar 0–100', () => {
    const max = computePriority({ severity: 'critical', impactLevel: 'high', scope: 'site', confidence: 1, effort: 'low', affectedPages: [] });
    expect(max).toBe(100);
    const low = computePriority({ severity: 'low', impactLevel: 'low', scope: 'page', confidence: 1, effort: 'high', affectedPages: ['/'] });
    expect(low).toBe(Math.round(((1 * 0.8 * 1 * 1) / 2 / 7.8) * 100));
  });

  it('confidence e ulët ul prioritetin; >10 faqe s\'shumëzon linearisht', () => {
    const base = { severity: 'high' as const, impactLevel: 'medium' as const, scope: 'page' as const, effort: 'low' as const };
    expect(computePriority({ ...base, confidence: 0.5, affectedPages: ['/'] })).toBeLessThan(computePriority({ ...base, confidence: 1, affectedPages: ['/'] }));
    const many = computePriority({ ...base, confidence: 1, affectedPages: Array.from({ length: 100 }, (_, i) => `/${i}`) });
    const one = computePriority({ ...base, confidence: 1, affectedPages: ['/'] });
    expect(many / one).toBeCloseTo(1.2, 1);
  });

  it('sortIssues rendit sipas priority, pastaj severity', () => {
    const a = finalizeIssue(draft({ code: 'A', severity: 'low' }), 'x');
    const b = finalizeIssue(draft({ code: 'B', severity: 'critical', scope: 'site' }), 'x');
    expect(sortIssues([a, b]).map((i) => i.code)).toEqual(['B', 'A']);
  });
});
