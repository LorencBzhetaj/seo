import type { Effort, ImpactLevel, Issue, IssueDraft, Scope, Severity } from '../core/schemas.js';

// Heuristika të dokumentuara (§4), jo matje e provuar e ndikimit biznesor.
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export const IMPACT_WEIGHT: Record<ImpactLevel, number> = { high: 1.3, medium: 1.0, low: 0.8 };
export const EFFORT_WEIGHT: Record<Effort, number> = { low: 1, medium: 1.5, high: 2 };
/** Pragu nën të cilin një issue shënohet "për verifikim manual" (§5). */
export const MANUAL_REVIEW_THRESHOLD = 0.7;

export function scopeWeight(scope: Scope, affectedPages: number): number {
  if (scope === 'site') return 1.5;
  if (scope === 'template') return 1.3;
  // Diminishing returns: >10 faqe → 1.2, jo shumëzues linear
  return affectedPages > 10 ? 1.2 : 1.0;
}

const MAX_RAW = SEVERITY_WEIGHT.critical * IMPACT_WEIGHT.high * 1.5 * 1 / EFFORT_WEIGHT.low;

/** priority = severity × impact × scope × confidence ÷ effort, normalizuar 0–100. */
export function computePriority(i: Pick<Issue, 'severity' | 'impactLevel' | 'scope' | 'confidence' | 'effort' | 'affectedPages'>): number {
  const raw =
    (SEVERITY_WEIGHT[i.severity] * IMPACT_WEIGHT[i.impactLevel] * scopeWeight(i.scope, i.affectedPages.length) * i.confidence) /
    EFFORT_WEIGHT[i.effort];
  return Math.round((raw / MAX_RAW) * 100);
}

export function finalizeIssue(draft: IssueDraft, module: string): Issue {
  const confidence = draft.confidence ?? 1;
  const affectedPages = draft.affectedPages ?? (draft.url ? [draft.url] : []);
  const base = { ...draft, module, confidence, affectedPages };
  return {
    ...base,
    priority: computePriority(base),
    needsManualReview: confidence < MANUAL_REVIEW_THRESHOLD,
  };
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => b.priority - a.priority || SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || a.code.localeCompare(b.code),
  );
}
