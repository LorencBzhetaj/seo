import type { AuditContext } from '../src/core/context.js';
import type { CrawledPage, CrawlResult } from '../src/crawler/crawler.js';
import { parsePage } from '../src/parse/page.js';
import { makeCtx } from './helpers.js';

export interface FakePage {
  url: string;
  html?: string;
  status?: number;
  headers?: Record<string, string>;
  redirects?: CrawledPage['redirects'];
  finalUrl?: string;
  source?: CrawledPage['source'];
  bodyBytes?: number;
}

/** Tekst i gjatë, i ndryshëm për çdo seed (për testet e ngjashmërisë). */
export const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 1009}`).join(' ');

export const htmlPage = (o: { title?: string; desc?: string; main?: string; head?: string; bodyClass?: string; lang?: string; extra?: string }) =>
  `<!doctype html><html${o.lang === undefined ? ' lang="sq"' : o.lang ? ` lang="${o.lang}"` : ''}><head>${o.title !== undefined ? `<title>${o.title}</title>` : ''}` +
  `${o.desc ? `<meta name="description" content="${o.desc}">` : ''}${o.head ?? ''}</head>` +
  `<body class="${o.bodyClass ?? 'page-template-default page'}"><header><nav><a href="/">Kreu</a></nav></header>` +
  `<main>${o.main ?? '<h1>Titull</h1><p>tekst</p>'}</main>${o.extra ?? ''}<footer>Footer i përbashkët</footer></body></html>`;

/** Ndërton një AuditContext me crawl të rremë (pa rrjet) mbi faqet e dhëna. */
export function siteCtx(pages: FakePage[], over: Partial<CrawlResult> = {}): AuditContext {
  const crawled: CrawledPage[] = pages.map((p, i) => {
    const status = p.status ?? 200;
    const finalUrl = p.finalUrl ?? p.url;
    const ok = status >= 200 && status < 300;
    return {
      url: p.url,
      finalUrl,
      depth: i === 0 ? 0 : 1,
      source: p.source ?? (i === 0 ? 'homepage' : 'link'),
      status,
      redirects: p.redirects ?? [],
      headers: p.headers ?? { 'content-type': 'text/html', 'content-encoding': 'br' },
      bodyBytes: p.bodyBytes ?? (p.html?.length ?? 0),
      access: ok ? 'ok' : status === 403 ? 'blocked' : 'http-error',
      page: ok && p.html ? parsePage(p.html, finalUrl, p.headers?.['x-robots-tag']) : undefined,
    };
  });
  const crawl: CrawlResult = {
    root: pages[0]!.url,
    limits: { maxPages: 25, maxDepth: 3, concurrency: 2, requestDelayMs: 500, timeoutMs: 10000, maxDurationMs: 180000, respectRobots: true },
    startedAt: new Date().toISOString(),
    durationMs: 1,
    pages: crawled,
    edges: [],
    edgesTruncated: false,
    externalLinks: { count: 0, sample: [] },
    notChecked: [],
    notCheckedCounts: {},
    truncated: false,
    ...over,
  };
  return { ...makeCtx(), crawl: { status: 'ok', value: crawl } };
}
