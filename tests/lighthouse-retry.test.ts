import { describe, expect, it } from 'vitest';
import { runModules, type AuditRun } from '../src/core/run.js';
import type { Probe } from '../src/core/context.js';
import { LighthouseRunError, runWithRetry, type LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { runPerformance } from '../src/modules/lighthouse-modules.js';
import { buildReport } from '../src/report/json.js';
import { renderTerminal } from '../src/report/terminal.js';
import { categoryScores, computeHealth } from '../src/scoring/scorer.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

const lhError = (code: string) => Object.assign(new Error(`Lighthouse runtimeError ${code}: Something went wrong with recording the trace over your page load. Please run Lighthouse again. (${code})`), { code });

function makeRun(lighthouse: Probe<LighthouseData>): AuditRun {
  const ctx = makeCtx({ lighthouse });
  const results = runModules(ctx);
  const issues = results.flatMap((r) => r.issues);
  return {
    id: 't', url: ctx.url, startedAt: '2026-09-29T01:00:00.000Z', completedAt: '2026-09-29T01:01:00.000Z', status: 'completed',
    config: ctx.config, context: ctx, results, issues, siteIssues: [], businessIssues: [], categories: categoryScores(results), health: computeHealth(results, issues),
    scoringVersion: '1.0', ruleSetVersion: 'test',
  };
}

describe('Lighthouse NO_NAVSTART: riprovim i dukshëm, jo i fshehur', () => {
  it('NO_NAVSTART → një riprovim; përpjekja e dështuar regjistrohet', async () => {
    let calls = 0;
    const r = await runWithRetry(async () => {
      if (++calls === 1) throw lhError('NO_NAVSTART');
      return 'lhr';
    });
    expect(calls).toBe(2);
    expect(r.value).toBe('lhr');
    expect(r.failedAttempts).toEqual([{ attempt: 1, code: 'NO_NAVSTART', message: expect.stringMatching(/^Lighthouse runtimeError NO_NAVSTART/) }]);
  });

  it('dy NO_NAVSTART radhazi → gabim me të dyja përpjekjet; s\'riprovon pa fund', async () => {
    let calls = 0;
    const err = await runWithRetry(async () => { calls++; throw lhError('NO_NAVSTART'); }).then(() => { throw new Error("pritej gabim"); }, (e: unknown) => e as LighthouseRunError);
    expect(calls).toBe(2);
    expect(err).toBeInstanceOf(LighthouseRunError);
    expect(err.code).toBe('NO_NAVSTART');
    expect(err.attempts).toHaveLength(2);
    expect(err.message).toMatch(/\(2 përpjekje, të gjitha dështuan: NO_NAVSTART, NO_NAVSTART\)$/);
  });

  it('gabimet e faqes (p.sh. ERRORED_DOCUMENT_REQUEST) s\'riprovohen', async () => {
    let calls = 0;
    await expect(runWithRetry(async () => { calls++; throw lhError('ERRORED_DOCUMENT_REQUEST'); })).rejects.toThrow(/ERRORED_DOCUMENT_REQUEST/);
    expect(calls).toBe(1);
  });

  it('dështim final: Health PARTIAL, JSON me code dhe terminal me paralajmërim të qartë', () => {
    const run = makeRun({ status: 'error', error: 'Lighthouse runtimeError NO_NAVSTART: Something went wrong (2 përpjekje, të gjitha dështuan: NO_NAVSTART, NO_NAVSTART)', code: 'NO_NAVSTART' });
    const report = buildReport(run);
    expect(report.health!.score).toBeNull();
    expect(report.lighthouse).toMatchObject({ status: 'error', code: 'NO_NAVSTART', reason: expect.stringMatching(/2 përpjekje/) });
    const out = renderTerminal(report);
    expect(out).toContain('⚠ LIGHTHOUSE DËSHTOI (NO_NAVSTART) — Performance, Accessibility, Best Practices pa rezultat');
    expect(out).toContain('Gabim i trace-it në Chrome (jo i faqes) — ekzekuto auditin sërish.');
  });

  it('sukses pas riprovimit: kufizim në modul, failedAttempts në JSON dhe rresht në terminal', () => {
    const lh = { ...lighthouseFixture(), failedAttempts: [{ attempt: 1, code: 'NO_NAVSTART', message: 'Lighthouse runtimeError NO_NAVSTART' }] };
    expect(runPerformance(makeCtx({ lighthouse: { status: 'ok', value: lh } })).limitations.join(' '))
      .toContain('Lighthouse: përpjekja 1 dështoi (NO_NAVSTART) — gabim i regjistrimit të trace-it në Chrome, jo i faqes; rezultati është nga përpjekja 2.');
    const report = buildReport(makeRun({ status: 'ok', value: lh }));
    expect((report.lighthouse as { failedAttempts: unknown[] }).failedAttempts).toHaveLength(1);
    expect(renderTerminal(report)).toContain('⚠ Lighthouse: përpjekja 1 dështoi (NO_NAVSTART); rezultati nga përpjekja 2');
  });
});
