import { isSiteCategory } from '../core/schemas.js';
import type { AuditResult, CategoryKey, SiteCategoryKey, CheckResult, Issue, IssueDraft, Metric, Severity } from '../core/schemas.js';
import { finalizeIssue } from '../intelligence/priority.js';

/** Sa "vlen" një kontroll sipas issue-s më të rëndë (0..1). Heuristikë e versionuar me ruleSetVersion. */
export const SEVERITY_CHECK_SCORE: Record<Severity, number> = { critical: 0, high: 0.3, medium: 0.6, low: 0.85 };

export function worstSeverity(issues: Pick<Issue, 'severity'>[]): Severity | null {
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  for (const s of order) if (issues.some((i) => i.severity === s)) return s;
  return null;
}

export class ModuleBuilder {
  readonly checks: CheckResult[] = [];
  readonly metrics: Metric[] = [];
  readonly limitations: string[] = [];

  constructor(readonly module: string, readonly category: CategoryKey | SiteCategoryKey) {}

  /** Kontroll i kryer: pass nëse s'ka issue, përndryshe warning/fail sipas rëndësisë. */
  check(id: string, label: string, weight: number, drafts: IssueDraft[] = [], observations?: string[]): CheckResult {
    const issues = drafts.map((d) => finalizeIssue(d, this.module));
    const worst = worstSeverity(issues);
    const c: CheckResult = {
      id,
      label,
      status: worst === null ? 'pass' : worst === 'critical' || worst === 'high' ? 'fail' : 'warning',
      weight,
      score: worst === null ? 1 : SEVERITY_CHECK_SCORE[worst],
      observations,
      issues,
    };
    this.checks.push(c);
    return c;
  }

  /** Kontroll që s'mund të kryhej: s'merr 0 as 100, del nga pikëzimi me arsye. */
  skip(id: string, label: string, weight: number, reason: string): CheckResult {
    const c: CheckResult = { id, label, status: 'skipped', weight, score: null, reason, issues: [] };
    this.checks.push(c);
    return c;
  }

  notApplicable(id: string, label: string, reason: string): CheckResult {
    const c: CheckResult = { id, label, status: 'not_applicable', weight: 0, score: null, reason, issues: [] };
    this.checks.push(c);
    return c;
  }

  /** Vetëm informacion (p.sh. canonical mungon pa prova konflikti): pa pikë, pa issue. */
  info(id: string, label: string, observations: string[], drafts: IssueDraft[] = []): CheckResult {
    const c: CheckResult = {
      id,
      label,
      status: 'info',
      weight: 0,
      score: null,
      observations,
      issues: drafts.map((d) => finalizeIssue(d, this.module)),
    };
    this.checks.push(c);
    return c;
  }

  metric(m: Metric): void {
    this.metrics.push(m);
  }

  /**
   * `score` (edhe null) mbishkruan pikëzimin nga checks; `coverage` me `truncated: true`
   * e shënon modulin partial (p.sh. crawl-i s'arriti të gjitha URL-të).
   */
  build(scoreOverride?: { score?: number | null; reason?: string; coverage?: AuditResult['coverage'] }): AuditResult {
    const scored = this.checks.filter((c) => c.score !== null && c.weight > 0);
    const skipped = this.checks.filter((c) => c.status === 'skipped');
    const applicable = this.checks.filter((c) => c.status !== 'not_applicable' && c.status !== 'info');
    const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
    let score =
      totalWeight > 0 ? Math.round((scored.reduce((s, c) => s + c.weight * (c.score as number), 0) / totalWeight) * 100) : null;
    let reason: string | undefined;
    if (scoreOverride && 'score' in scoreOverride) score = scoreOverride.score ?? null;
    if (scoreOverride?.reason) reason = scoreOverride.reason;

    let status: AuditResult['status'];
    if (score === null) {
      const allNa = this.checks.length > 0 && this.checks.every((c) => c.status === 'not_applicable' || c.status === 'info');
      status = allNa ? 'not_applicable' : 'skipped';
      reason ??= skipped.length ? uniq(skipped.map((c) => c.reason ?? '')).join('; ') : 'Asnjë kontroll i vlefshëm';
    } else {
      status = score >= 90 ? 'pass' : score >= 50 ? 'warning' : 'fail';
    }

    const truncated = scoreOverride?.coverage?.truncated ?? false;
    const partial = score !== null && (skipped.length > 0 || truncated);
    const limitations = [...this.limitations];
    if (partial && skipped.length > 0) {
      limitations.push(`${this.module}: ${skipped.length} kontroll(e) skipped — ${skipped.map((c) => `${c.id} (${c.reason})`).join('; ')}`);
    }

    return {
      module: this.module,
      category: this.category,
      section: isSiteCategory(this.category) ? 'site' : 'homepage',
      score,
      status,
      partial,
      reason,
      coverage: scoreOverride?.coverage ?? { checked: applicable.length - skipped.length, discovered: applicable.length, truncated: false },
      checks: this.checks,
      issues: this.checks.flatMap((c) => c.issues),
      metrics: this.metrics,
      limitations,
    };
  }
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Rezultat për modul që dështoi krejtësisht (p.sh. exception): nuk fshin modulet e tjera. */
export function failedModule(module: string, category: CategoryKey | SiteCategoryKey, reason: string): AuditResult {
  return {
    module,
    category,
    section: isSiteCategory(category) ? 'site' : 'homepage',
    score: null,
    status: 'skipped',
    partial: false,
    reason,
    coverage: { checked: 0, discovered: 0, truncated: false },
    checks: [],
    issues: [],
    metrics: [],
    limitations: [`${module}: skipped — ${reason}`],
  };
}
