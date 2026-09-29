import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { runModules, type AuditRun } from '../src/core/run.js';
import { categoryScores, computeHealth } from '../src/scoring/scorer.js';
import { buildReport, lhrFileName, writeReport } from '../src/report/json.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'lhr-only-marker-7f3a';
let dir = '';

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRun(rawLhr?: unknown): AuditRun {
  const ctx = makeCtx({ lighthouse: { status: 'ok', value: { ...lighthouseFixture(), rawLhr } } });
  const results = runModules(ctx);
  const issues = results.flatMap((r) => r.issues);
  return {
    id: 'test-run', url: ctx.url, startedAt: '2026-09-28T18:07:45.123Z', completedAt: '2026-09-28T18:08:10.000Z', status: 'completed',
    config: ctx.config, context: ctx, results, issues, siteIssues: [], categories: categoryScores(results), health: computeHealth(results, issues),
    scoringVersion: '1.0', ruleSetVersion: 'test',
  };
}

describe('--save-lhr', () => {
  it('është joaktiv si parazgjedhje', () => {
    expect(DEFAULT_CONFIG.lighthouse.saveLhr).toBe(false);
  });

  it('ruan LHR-në pranë raportit me të njëjtin emër bazë dhe raporti e emërton', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-lhr-'));
    const raw = { lighthouseVersion: '13.5.0', configSettings: { throttlingMethod: 'simulate' }, marker: MARKER };
    const report = buildReport(makeRun(raw));
    const { reportPath, lhrPath, report: written } = writeReport(report, dir, raw);

    expect(path.basename(reportPath)).toBe('example.com-20260928-180745.json');
    expect(path.basename(lhrPath!)).toBe('example.com-20260928-180745.lhr.json');
    expect(lhrFileName(report)).toBe('example.com-20260928-180745.lhr.json');
    expect(JSON.parse(fs.readFileSync(lhrPath!, 'utf8'))).toEqual(raw);

    const saved = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(saved.lighthouse.lhrFile).toBe('example.com-20260928-180745.lhr.json');
    expect(written.lighthouse.lhrFile).toBe(saved.lighthouse.lhrFile);
    // LHR-ja e plotë s'futet brenda raportit JSON
    expect(fs.readFileSync(reportPath, 'utf8')).not.toContain(MARKER);
  });

  it('pa --save-lhr: asnjë skedar LHR dhe asnjë lhrFile në raport', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-lhr-'));
    const { reportPath, lhrPath } = writeReport(buildReport(makeRun()), dir);
    expect(lhrPath).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([path.basename(reportPath)]);
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf8')).lighthouse).not.toHaveProperty('lhrFile');
  });

  it.runIf(fs.existsSync(path.join(ROOT, '.git')))('skedarët .lhr.json te output/ janë jashtë Git', () => {
    // git check-ignore del me kod 0 kur rruga injorohet; përndryshe execFileSync hedh gabim.
    const out = execFileSync('git', ['check-ignore', '-v', 'output/example.com-20260928-180745.lhr.json'], { cwd: ROOT }).toString();
    expect(out).toMatch(/\.gitignore:\d+:output\//);
  });
});
