import type { AuditRun } from '../core/run.js';
import { BUSINESS_CATEGORY_LABELS, type BusinessCategoryKey } from '../core/schemas.js';
import { businessPages, detectionFor } from '../detection/index.js';
import { CONVERSION_NOT_TESTED, CONVERSION_SCORE_SCOPE, formInventory } from '../modules/business/common.js';

/**
 * Seksioni "business" (MVP-3): detektimi (lloji i sitit/faqeve, CMS), conversion dhe privacy.
 * Jashtë Health Score-it; privacy s'ka score me qëllim (sinjale, jo verdikt ligjor).
 */
export function buildBusinessSection(run: AuditRun) {
  const results = run.results.filter((r) => r.section === 'business');
  const categories = Object.fromEntries(
    (Object.keys(BUSINESS_CATEGORY_LABELS) as BusinessCategoryKey[]).map((k) => [k, results.find((r) => r.category === k)?.score ?? null]),
  ) as Record<BusinessCategoryKey, number | null>;
  if (!run.config.business.enabled) {
    return { status: 'skipped' as const, reason: 'Modulet e biznesit u çaktivizuan (--no-business)', categories, issues: [] };
  }
  const d = run.context ? detectionFor(run.context) : undefined;
  const typeCounts: Record<string, number> = {};
  for (const p of d?.pages ?? []) typeCounts[p.type] = (typeCounts[p.type] ?? 0) + 1;
  const anyPartial = results.some((r) => r.partial || r.status === 'skipped');
  const first = results[0];

  return {
    status: !d ? ('skipped' as const) : anyPartial ? ('partial' as const) : ('completed' as const),
    detection: d
      ? {
          basis: d.basis,
          pagesAnalyzed: d.pagesAnalyzed,
          site: d.pageType,
          techStack: d.techStack,
          pageTypeCounts: typeCounts,
          pages: d.pages,
          note: 'confidence = kombinim heuristik sinjalesh (1 − Π(1 − w)), jo probabilitet i kalibruar; nën 0.5 → "unknown".',
        }
      : { status: 'skipped', reason: first?.reason ?? 'Pa HTML të analizueshëm' },
    categories,
    categoryCoverage: Object.fromEntries(
      results.map((r) => [
        r.category,
        { ...r.coverage, partial: r.partial, status: r.status, scope: r.category === 'conversion' ? CONVERSION_SCORE_SCOPE : 'Sinjale, pa score — jo verdikt ligjor' },
      ]),
    ),
    /** Çfarë do të thotë score-i: pranë rezultatit, që Conversion 100 të mos lexohet si "rrjedha funksionon". */
    scoreScope: {
      conversion: { scope: CONVERSION_SCORE_SCOPE, notTested: CONVERSION_NOT_TESTED },
      privacy: { scope: 'Pa score me qëllim: sinjale të vëzhgueshme për shqyrtim manual, jo verdikt ligjor.' },
    },
    /** Çdo komponent formulari një herë, me numrin e faqeve ku shfaqet. */
    forms: run.context && d ? formInventory(businessPages(run.context)) : [],
    scopeNote:
      run.context?.crawl.status === 'ok'
        ? `Sinjalet vijnë nga ${d?.pagesAnalyzed ?? 0} faqe HTML të analizuara (HTML statik); log-u i rrjetit vetëm nga Lighthouse në faqen hyrëse.`
        : 'Vetëm faqja hyrëse (pa crawl): gjetjet s\'vlejnë për gjithë sitin.',
    privacyDisclaimer: 'Privacy: sinjale të vëzhgueshme për shqyrtim manual — nuk është vlerësim ligjor i pajtueshmërisë me GDPR/ePrivacy.',
    topImprovements: run.businessIssues.slice(0, 5).map((i) => ({
      code: i.code, severity: i.severity, confidence: i.confidence, needsManualReview: i.needsManualReview, priority: i.priority, message: i.message, fix: i.fix,
    })),
    issues: run.businessIssues,
  };
}
