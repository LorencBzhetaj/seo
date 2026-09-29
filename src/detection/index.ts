import type { AuditContext } from '../core/context.js';
import { parsePage } from '../parse/page.js';
import { detectPageType, type DetectionPage, type PageClassification, type PageTypeResult } from './page-type.js';
import { detectTechStack, type TechStackResult } from './tech-stack.js';

/** Detektimet ndër-modulare (§2 J): llogariten një herë nga AuditContext, pa kërkesa rrjeti. */
export interface DetectionData {
  pageType: PageTypeResult;
  pages: PageClassification[];
  techStack: TechStackResult;
  /** Sa faqe HTML u përdorën (faqja hyrëse + crawl-i). */
  pagesAnalyzed: number;
  /** Burimi: "homepage" kur crawl-i s'u krye (--no-crawl ose bllokim). */
  basis: 'homepage' | 'crawl';
}

/**
 * Faqet me HTML të analizueshëm: faqja hyrëse (nga crawl-i, ose e parsuar nga ctx.main kur s'ka crawl)
 * + faqet e crawl-it me 2xx, jo dublikata ridrejtimesh dhe jo jashtë sitit.
 */
export function businessPages(ctx: AuditContext): DetectionPage[] {
  const out: DetectionPage[] = [];
  const crawl = ctx.crawl.status === 'ok' ? ctx.crawl.value : undefined;
  const crawledHome = crawl?.pages.find((p) => p.source === 'homepage' && p.page);
  if (crawledHome?.page) out.push({ url: crawledHome.finalUrl ?? crawledHome.url, isHome: true, page: crawledHome.page });
  else if (ctx.main.status === 'ok' && ctx.access.state === 'ok') {
    out.push({ url: ctx.main.value.finalUrl, isHome: true, page: parsePage(ctx.main.value.body, ctx.main.value.finalUrl, ctx.main.value.headers['x-robots-tag']) });
  }
  for (const p of crawl?.pages ?? []) {
    if (p.source === 'homepage' || !p.page || p.access !== 'ok' || p.sameAs || p.external) continue;
    out.push({ url: p.finalUrl ?? p.url, isHome: false, page: p.page });
  }
  return out;
}

export function buildDetection(ctx: AuditContext): DetectionData | undefined {
  const pages = businessPages(ctx);
  const home = pages.find((p) => p.isHome);
  if (!home || ctx.main.status !== 'ok') return undefined;
  const techStack = detectTechStack({
    url: home.url,
    html: ctx.main.value.body,
    headers: ctx.main.value.headers,
    generators: pages.flatMap((p) => p.page.business.generators),
  });
  const crawl = ctx.crawl.status === 'ok' ? ctx.crawl.value : undefined;
  const { site, pages: classified } = detectPageType({ pages, tech: techStack, discoveredUrls: crawl?.notChecked.map((n) => n.url) ?? [] });
  return { pageType: site, pages: classified, techStack, pagesAnalyzed: pages.length, basis: crawl ? 'crawl' : 'homepage' };
}

const cache = new WeakMap<AuditContext, DetectionData | null>();

/** Detektimi i ruajtur në ctx (vendoset nga executeAudit), ose i llogaritur një herë për këtë kontekst. */
export function detectionFor(ctx: AuditContext): DetectionData | undefined {
  if (ctx.detection) return ctx.detection;
  if (!cache.has(ctx)) cache.set(ctx, buildDetection(ctx) ?? null);
  return cache.get(ctx) ?? undefined;
}
