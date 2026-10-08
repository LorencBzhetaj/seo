import { describe, expect, it } from 'vitest';
import { detailRows, summarizeAgentic, summarizeLhSeo } from '../src/lighthouse/agentic.js';
import { runModules } from '../src/core/run.js';
import { computeHealth } from '../src/scoring/scorer.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

/** Kategoria siç e kthen Lighthouse 13.5.0 (default-config.js: auditRefs, grupet, categoryScoreDisplayMode "fraction"). */
function withAgentic(lh: LighthouseData, over: Record<string, Record<string, unknown>> = {}): LighthouseData {
  const audits: Record<string, Record<string, unknown>> = {
    'agent-accessibility-tree': {
      id: 'agent-accessibility-tree', title: 'Accessibility tree is not well-formed for agents', score: 0, scoreDisplayMode: 'binary',
      details: { type: 'list', items: [{ type: 'list-section', title: 'Failed', value: { type: 'table', headings: [], items: [{ description: 'Buttons must have discernible text', node: { type: 'node', snippet: '<button class="x">', selector: 'button.x' } }] } }] },
    },
    'webmcp-form-coverage': { id: 'webmcp-form-coverage', title: 'WebMCP form coverage', score: 1, scoreDisplayMode: 'informative' },
    'webmcp-registered-tools': { id: 'webmcp-registered-tools', title: 'WebMCP registered tools', score: null, scoreDisplayMode: 'notApplicable' },
    'webmcp-schema-validity': { id: 'webmcp-schema-validity', title: 'WebMCP schemas are valid', score: 1, scoreDisplayMode: 'binary' },
    'llms-txt': { id: 'llms-txt', title: 'llms.txt', score: null, scoreDisplayMode: 'notApplicable' },
    'ard-schema': { id: 'ard-schema', title: 'Agent resource discovery', score: null, scoreDisplayMode: 'notApplicable' },
    ...over,
  };
  return {
    ...lh,
    categories: {
      ...lh.categories,
      'agentic-browsing': {
        id: 'agentic-browsing', title: 'Agentic Browsing', score: 0.67, categoryScoreDisplayMode: 'fraction',
        auditRefs: [
          { id: 'agent-accessibility-tree', weight: 1, group: 'agent-accessibility' },
          { id: 'webmcp-form-coverage', weight: 1, group: 'webmcp' },
          { id: 'webmcp-registered-tools', weight: 1, group: 'webmcp' },
          { id: 'webmcp-schema-validity', weight: 1, group: 'webmcp' },
          { id: 'cumulative-layout-shift', weight: 1 },
          { id: 'llms-txt', weight: 1, group: 'agent-discoverability' },
          { id: 'ard-schema', weight: 1, group: 'agent-discoverability' },
        ],
      },
    },
    audits: { ...lh.audits, ...(audits as unknown as LighthouseData['audits']) },
  };
}

describe('Lighthouse Agentic Browsing (eksperimentale)', () => {
  it('rezultati si thyesë "kaluar/të vlerësueshme", me rregullin e Lighthouse (N/A, informative jashtë)', () => {
    const lh = withAgentic(lighthouseFixture());
    const cls = lh.audits['cumulative-layout-shift']!;
    const a = summarizeAgentic(lh);
    expect(a.status).toBe('ok');
    if (a.status !== 'ok') return;
    expect(a.experimental).toBe(true);
    expect(a.displayMode).toBe('fraction');
    // kalojnë: webmcp-schema-validity (+ CLS nëse score ≥ 0.9); dështon: agent-accessibility-tree
    const clsPass = Number(cls.score) >= 0.9 ? 1 : 0;
    expect(a.passed).toBe(1 + clsPass);
    expect(a.passable).toBe(3);
    expect(a.notApplicable).toBe(3);
    expect(a.informativeNotPassed).toBe(1);
    // asnjë pikë 0–100 e shpikur
    expect(JSON.stringify(a)).not.toMatch(/"score100"|"percent"/);
    const tree = a.audits.find((x) => x.id === 'agent-accessibility-tree')!;
    expect(tree).toMatchObject({ result: 'fail', group: 'agent-accessibility', itemsTotal: 1 });
    expect(tree.items[0]).toContain('Buttons must have discernible text');
    expect(tree.items[0]).toContain('button.x');
  });

  it('llms.txt që mungon (Lighthouse: N/A) s\'shënohet si defekt', () => {
    const a = summarizeAgentic(withAgentic(lighthouseFixture()));
    if (a.status !== 'ok') throw new Error('pritej ok');
    expect(a.audits.find((x) => x.id === 'llms-txt')).toMatchObject({ result: 'not-applicable', scoreDisplayMode: 'notApplicable' });
  });

  it('kategoria e pambështetur / mungon në LHR → skipped me arsye', () => {
    const a = summarizeAgentic(lighthouseFixture());
    expect(a).toMatchObject({ status: 'skipped', experimental: true });
    if (a.status === 'skipped') expect(a.reason).toContain('agentic-browsing');
  });

  it('auditi që mungon ose ka gabim → "error", s\'numërohet si i kaluar', () => {
    const lh = withAgentic(lighthouseFixture(), { 'webmcp-schema-validity': { id: 'webmcp-schema-validity', title: 'x', score: null, scoreDisplayMode: 'error', errorMessage: 'WebMCP s\'mbështetet' } });
    const a = summarizeAgentic(lh);
    if (a.status !== 'ok') throw new Error('pritej ok');
    expect(a.errors).toBe(1);
    expect(a.audits.find((x) => x.id === 'webmcp-schema-validity')).toMatchObject({ result: 'error', errorMessage: "WebMCP s'mbështetet" });
    expect(a.passable).toBe(3);
  });

  it('Lighthouse SEO ruhet veç, si pika e Lighthouse 0–100', () => {
    const lh = lighthouseFixture();
    const s = summarizeLhSeo(lh)!;
    expect(s.title).toBe('Lighthouse SEO');
    expect(s.score).toBe(Math.round(lh.categories.seo!.score! * 100));
  });

  it('Health Score, kategoritë dhe gjetjet s\'ndryshojnë kur shtohet Agentic Browsing', () => {
    const base = lighthouseFixture();
    const before = runModules(makeCtx({ lighthouse: { status: 'ok', value: base } }));
    const after = runModules(makeCtx({ lighthouse: { status: 'ok', value: withAgentic(base) } }));
    const strip = (rs: typeof before) => rs.map((r) => ({ category: r.category, score: r.score, issues: r.issues.map((i) => i.code).sort() }));
    expect(strip(after)).toEqual(strip(before));
    expect(computeHealth(after, after.flatMap((r) => r.issues)).score).toBe(computeHealth(before, before.flatMap((r) => r.issues)).score);
    expect(after.flatMap((r) => r.issues).some((i) => /agent|llms|webmcp|ard/i.test(i.code))).toBe(false);
  });

  it('detajet: tabela brenda listës; rreshtat pa tekst injorohen', () => {
    expect(detailRows({ type: 'table', items: [{ a: 'x', b: 2 }, {}] })).toEqual(['a: x · b: 2']);
    expect(detailRows(undefined)).toEqual([]);
  });
});

describe('Agentic Browsing mbi fushat reale të Lighthouse 13.5.0', () => {
  it('LHR reale (pjesa agentic): 3/3 të kaluara, 4 N/A; debugdata s\'del si provë', async () => {
    const { fixture } = await import('./helpers.js');
    const real = JSON.parse(fixture('lighthouse-agentic-13.5.json')) as { lighthouseVersion: string; categories: LighthouseData['categories']; audits: LighthouseData['audits'] };
    expect(real.categories['agentic-browsing']).toMatchObject({ categoryScoreDisplayMode: 'fraction' });
    const a = summarizeAgentic(real);
    if (a.status !== 'ok') throw new Error('pritej ok');
    expect(a).toMatchObject({ lighthouseVersion: '13.5.0', displayMode: 'fraction', passed: 3, passable: 3, notApplicable: 4, errors: 0 });
    expect(a.audits.find((x) => x.id === 'cumulative-layout-shift')!.items).toEqual([]);
  });
});
