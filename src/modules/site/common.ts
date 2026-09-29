import type { AuditContext } from '../../core/context.js';
import type { CrawledPage, CrawlResult } from '../../crawler/crawler.js';
import { SKIP_REASON_LABELS, type SkipReason } from '../../crawler/url-rules.js';
import type { Evidence, EvidenceType, IssueDraft } from '../../core/schemas.js';
import type { PageData } from '../../parse/page.js';

export type AnalyzedPage = CrawledPage & { page: PageData; finalUrl: string };

/** Arsyeja pse modulet e site-it s'kanë të dhëna (crawl skipped/dështoi), ose undefined. */
export function crawlUnavailable(ctx: AuditContext): string | undefined {
  if (ctx.crawl.status === 'ok') return undefined;
  return ctx.crawl.status === 'error' ? `Crawl-i dështoi: ${ctx.crawl.error}` : ctx.crawl.reason;
}

/** Faqet HTML 2xx të brendshme, të analizuara një herë secila. */
export function analyzedPages(crawl: CrawlResult): AnalyzedPage[] {
  return crawl.pages.filter((p): p is AnalyzedPage => !!p.page && !!p.finalUrl);
}

export function notCheckedSummary(crawl: CrawlResult): string {
  const parts = (Object.entries(crawl.notCheckedCounts) as [SkipReason, number][])
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${SKIP_REASON_LABELS[r]}`);
  return parts.length ? parts.join('; ') : 'asnjë';
}

export function crawlCoverage(crawl: CrawlResult, checked: number): { checked: number; discovered: number; truncated: boolean } {
  const notCheckedTotal = Object.values(crawl.notCheckedCounts).reduce((s, n) => s + (n ?? 0), 0);
  return { checked, discovered: crawl.pages.length + notCheckedTotal, truncated: crawl.truncated };
}

export interface Occurrence {
  url: string;
  templateKey?: string;
  detected: string;
  expected?: string;
  type?: EvidenceType;
}

type Base = Omit<IssueDraft, 'scope' | 'url' | 'evidence' | 'affectedPages' | 'message'>;

const MAX_EXAMPLES = 5;

function evidenceOf(occ: Occurrence[]): Evidence[] {
  const ev: Evidence[] = occ.slice(0, MAX_EXAMPLES).map((o) => ({ type: o.type ?? 'dom', url: o.url, detected: o.detected, expected: o.expected }));
  if (occ.length > MAX_EXAMPLES) {
    ev.push({ type: 'crawl', url: occ[MAX_EXAMPLES]!.url, detected: `… dhe ${occ.length - MAX_EXAMPLES} faqe të tjera (lista e plotë te affectedPages)` });
  }
  return ev;
}

/**
 * Bashkon të njëjtin problem nëpër faqe: çdo template me ≥ 2 faqe → një issue (scope "template");
 * faqet e mbetura → një issue i vetëm (scope "page") me të gjitha URL-të. Kështu problemet e
 * template-it s'përsëriten për çdo faqe.
 */
export function groupByTemplate(base: Base, message: (count: number, template: boolean) => string, occurrences: Occurrence[]): IssueDraft[] {
  if (occurrences.length === 0) return [];
  const byTemplate = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const k = o.templateKey ?? `page:${o.url}`;
    byTemplate.set(k, [...(byTemplate.get(k) ?? []), o]);
  }
  const drafts: IssueDraft[] = [];
  const singles: Occurrence[] = [];
  for (const [key, occ] of byTemplate) {
    if (occ.length >= 2 && !key.startsWith('page:')) {
      drafts.push({
        ...base,
        scope: 'template',
        url: occ[0]!.url,
        affectedPages: occ.map((o) => o.url),
        message: `${message(occ.length, true)} — i njëjti template (${key.replace(/^(body|dom):/, '').slice(0, 60)})`,
        evidence: evidenceOf(occ),
      });
    } else {
      singles.push(...occ);
    }
  }
  if (singles.length) {
    drafts.push({
      ...base,
      scope: 'page',
      url: singles[0]!.url,
      affectedPages: singles.map((o) => o.url),
      message: message(singles.length, false),
      evidence: evidenceOf(singles),
    });
  }
  return drafts;
}
