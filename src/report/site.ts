import type { AuditRun } from '../core/run.js';
import { SITE_CATEGORY_LABELS, type SiteCategoryKey } from '../core/schemas.js';
import { SKIP_REASON_LABELS, type SkipReason } from '../crawler/url-rules.js';

/** Sa URL "pa kontroll" listohen në raport (numrat e plotë janë te notCheckedCounts). */
const MAX_NOT_CHECKED_IN_REPORT = 200;

/**
 * Seksioni "site" i raportit (MVP-2): gjetjet nga crawl-i, të ndara nga faqja hyrëse.
 * S'ka Health Score të përbashkët — peshat e moduleve të site-it s'janë validuar ende.
 */
export function buildSiteSection(run: AuditRun) {
  const ctx = run.context;
  const siteResults = run.results.filter((r) => r.section === 'site');
  const categories = Object.fromEntries(
    (Object.keys(SITE_CATEGORY_LABELS) as SiteCategoryKey[]).map((k) => [k, siteResults.find((r) => r.category === k)?.score ?? null]),
  ) as Record<SiteCategoryKey, number | null>;

  const crawlProbe = ctx?.crawl;
  if (!crawlProbe || crawlProbe.status !== 'ok') {
    return {
      status: 'skipped' as const,
      reason: crawlProbe?.status === 'error' ? `Crawl-i dështoi: ${crawlProbe.error}` : crawlProbe?.status === 'skipped' ? crawlProbe.reason : 'Pa crawl',
      categories,
      issues: run.siteIssues,
    };
  }
  const crawl = crawlProbe.value;
  const sm = ctx.sitemaps.status === 'ok' ? ctx.sitemaps.value : undefined;
  const notCheckedTotal = Object.values(crawl.notCheckedCounts).reduce((s, n) => s + (n ?? 0), 0);
  const anyPartial = siteResults.some((r) => r.partial || r.status === 'skipped');

  return {
    status: crawl.truncated || anyPartial ? ('partial' as const) : ('completed' as const),
    crawl: {
      root: crawl.root,
      limits: crawl.limits,
      startedAt: crawl.startedAt,
      durationMs: crawl.durationMs,
      pagesRequested: crawl.pages.length,
      pagesAnalyzed: crawl.pages.filter((p) => p.page).length,
      urlsDiscovered: crawl.pages.length + notCheckedTotal,
      notCheckedTotal,
      notCheckedByReason: Object.fromEntries(
        (Object.entries(crawl.notCheckedCounts) as [SkipReason, number][]).map(([r, n]) => [r, { count: n, meaning: SKIP_REASON_LABELS[r] }]),
      ),
      notChecked: crawl.notChecked.slice(0, MAX_NOT_CHECKED_IN_REPORT),
      truncated: crawl.truncated,
      stopReason: crawl.stopReason,
      externalLinks: crawl.externalLinks,
      pages: crawl.pages.map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl,
        source: p.source,
        depth: p.depth,
        status: p.status,
        access: p.access,
        redirects: p.redirects.length,
        error: p.error,
        title: p.page?.titles[0],
        noindex: p.page?.noindex,
        wordCount: p.page?.wordCount,
        external: p.external,
        sameAs: p.sameAs,
      })),
    },
    sitemaps: sm
      ? { discoveredVia: sm.discoveredVia, files: sm.files, urlCount: sm.urls.length, truncated: sm.truncated, triedDefaults: sm.triedDefaults }
      : { status: ctx.sitemaps.status, reason: ctx.sitemaps.status === 'error' ? ctx.sitemaps.error : ctx.sitemaps.status === 'skipped' ? ctx.sitemaps.reason : undefined },
    categories,
    /**
     * Çfarë mbulon secili score: score-t e site-it vlejnë VETËM për faqet e kontrolluara.
     * P.sh. "duplicates: 100, partial, 25/82" s'do të thotë që gjithë siti s'ka dyfishime.
     */
    categoryCoverage: Object.fromEntries(
      siteResults.map((r) => [
        r.category,
        {
          partial: r.partial || crawl.truncated,
          checked: r.coverage.checked,
          discovered: r.coverage.discovered,
          excludedByRule: r.coverage.excludedByRule,
          scope: r.score === null ? 'pa score' : r.partial || crawl.truncated ? 'vetëm faqet e kontrolluara — jo rezultat për gjithë sitin' : 'faqet e kontrolluara (crawl i plotë brenda kufijve)',
        },
      ]),
    ),
    scopeNote: crawl.truncated
      ? `Crawl i pjesshëm: ${crawl.pages.length} nga ${crawl.pages.length + notCheckedTotal} URL të zbuluara u kontrolluan. Mungesa e gjetjeve (p.sh. linke të prishura, dyfishime) vlen vetëm për faqet e kontrolluara, jo për gjithë sitin.`
      : `Crawl i plotë brenda kufijve: u kontrolluan të gjitha ${crawl.pages.length} URL-të e lejuara të zbuluara (pa ato të ndaluara nga robots/rregullat).`,
    topImprovements: run.siteIssues.slice(0, 5).map((i) => ({
      code: i.code, severity: i.severity, scope: i.scope, affectedPages: i.affectedPages.length, priority: i.priority, message: i.message, fix: i.fix,
    })),
    issues: run.siteIssues,
  };
}
