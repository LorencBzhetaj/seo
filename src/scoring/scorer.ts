import type { AuditResult, CategoryKey, HealthModifier, HealthResult, Issue } from '../core/schemas.js';
import { CATEGORY_LABELS } from '../core/schemas.js';

export const SCORING_VERSION = '1.0';
/** mvp3: shtohen conversion/privacy/detektimi (jashtë Health); formula e Health Score-it s'ndryshon (scoringVersion 1.0). */
export const RULESET_VERSION = '2026.09-mvp3';

/** Peshat e kategorive (heuristikë e versionuar; do të rishikohen pas validimit të MVP-1). */
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  availability: 0.15,
  seoTechnical: 0.2,
  security: 0.2,
  performance: 0.2,
  accessibility: 0.15,
  bestPractices: 0.1,
};

/** Pa këto, Health Score final nuk gjenerohet (status PARTIAL). */
export const KEY_CATEGORIES: CategoryKey[] = ['availability', 'seoTechnical', 'security', 'performance'];

export const CRITICAL_CAP = 50;
/** Vetëm critical me këtë confidence konsiderohen "të konfirmuar me prova" (§1). */
export const CONFIRMED_CONFIDENCE = 0.9;

export function categoryScores(results: AuditResult[]): Record<CategoryKey, number | null> {
  const out = Object.fromEntries(Object.keys(CATEGORY_WEIGHTS).map((k) => [k, null])) as Record<CategoryKey, number | null>;
  for (const r of results) {
    if (r.section !== 'homepage' || !(r.category in CATEGORY_WEIGHTS)) continue; // crawl-i (MVP-2) dhe biznesi (MVP-3) s'hyjnë në Health
    // Një modul për kategori në MVP-1; nëse do të ketë më shumë, mesatare e thjeshtë e atyre me score.
    const prev = out[r.category as CategoryKey];
    if (r.score === null) continue;
    out[r.category as CategoryKey] = prev === null ? r.score : Math.round((prev + r.score) / 2);
  }
  return out;
}

export function healthStatus(score: number): HealthResult['status'] {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'NEEDS_WORK';
  return 'POOR';
}

/**
 * Category Scores → Base Health (mesatare e peshuar) → Risk Modifiers (critical cap).
 * Mbulimi dhe kufizimet shfaqen veç, nuk zbriten fshehurazi nga pikët.
 */
export function computeHealth(results: AuditResult[], issues: Issue[]): HealthResult {
  const cats = categoryScores(results);
  const missing = (Object.keys(cats) as CategoryKey[]).filter((k) => cats[k] === null);
  const missingKey = missing.filter((k) => KEY_CATEGORIES.includes(k));
  const limitations: string[] = [];
  const reasonFor = (k: CategoryKey) => results.find((r) => r.category === k)?.reason ?? 'pa rezultat';

  const available = (Object.keys(cats) as CategoryKey[]).filter((k) => cats[k] !== null);
  const totalW = available.reduce((s, k) => s + CATEGORY_WEIGHTS[k], 0);
  const baseScore = totalW > 0 ? Math.round(available.reduce((s, k) => s + CATEGORY_WEIGHTS[k] * (cats[k] as number), 0) / totalW) : null;

  for (const k of missing) limitations.push(`${CATEGORY_LABELS[k]}: pa rezultat — ${reasonFor(k)}`);

  const modifiers: HealthModifier[] = [];
  let score: number | null = null;
  let status: HealthResult['status'] = 'PARTIAL';

  if (missingKey.length > 0 || baseScore === null) {
    limitations.unshift(
      `Health Score nuk u gjenerua: mungojnë kategori kyçe (${missingKey.map((k) => CATEGORY_LABELS[k]).join(', ') || 'të gjitha'}).`,
    );
  } else {
    score = baseScore;
    if (missing.length) limitations.push(`Health Score u llogarit pa: ${missing.map((k) => CATEGORY_LABELS[k]).join(', ')} (peshat u rinormalizuan).`);
    const confirmed = issues.filter((i) => i.severity === 'critical' && i.confidence >= CONFIRMED_CONFIDENCE);
    if (confirmed.length > 0 && score > CRITICAL_CAP) {
      modifiers.push({
        code: 'CRITICAL_ISSUE_CAP',
        reason: `${confirmed.length} issue critical të konfirmuar me prova (${[...new Set(confirmed.map((i) => i.code))].join(', ')}) → maksimumi ${CRITICAL_CAP}`,
        before: score,
        after: CRITICAL_CAP,
      });
      score = CRITICAL_CAP;
    }
    status = healthStatus(score);
  }

  const unconfirmed = issues.filter((i) => i.severity === 'critical' && i.confidence < CONFIRMED_CONFIDENCE);
  if (unconfirmed.length) {
    limitations.push(`${unconfirmed.length} issue critical pa konfirmim të plotë (confidence < ${CONFIRMED_CONFIDENCE}) — nuk aktivizojnë kufizimin e pikëve; verifikoji manualisht.`);
  }

  const coverage = results.filter((r) => r.section !== 'site').reduce(
    (acc, r) => ({ checked: acc.checked + r.coverage.checked, discovered: acc.discovered + r.coverage.discovered, truncated: acc.truncated || r.coverage.truncated }),
    { checked: 0, discovered: 0, truncated: false },
  );

  return {
    score,
    // Në PARTIAL nuk nxirret as base score, që të mos lexohet si rezultat final.
    baseScore: score === null ? null : baseScore,
    status,
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    coverage,
    missingCategories: missing,
    modifiers,
    limitations,
    needsManualReview: issues.filter((i) => i.needsManualReview).length,
  };
}
