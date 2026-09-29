import type { AuditConfig } from '../core/config.js';
import { classifyAccess, isHtml, isSuccess, type AccessState } from '../core/access.js';
import { FetchError, safeFetch, type FetchOptions, type FetchResult, type RedirectHop } from '../net/safe-fetch.js';
import { assertUrlAllowed } from '../net/url-guard.js';
import { parsePage, type PageData } from '../parse/page.js';
import { isAllowed, type ParsedRobots } from '../parse/robots.js';
import { isInternal, normalizeUrl, unsafeOrExcluded, type SkipReason } from './url-rules.js';

/** Header-at që ruhen për çdo faqe (pa cookies/autorizim). */
const KEPT_HEADERS = [
  'content-type', 'content-encoding', 'content-language', 'cache-control', 'expires', 'etag', 'last-modified',
  'vary', 'age', 'cf-cache-status', 'x-cache', 'x-robots-tag', 'server',
];
/** Pas kaq përgjigjesh 401/403/429 radhazi, crawl-i ndalet (bllokim ose rate limit). */
const MAX_CONSECUTIVE_BLOCKS = 3;
const MAX_EDGES = 5000;
const MAX_NOT_CHECKED_LISTED = 500;

export interface CrawledPage {
  /** URL i kërkuar (i normalizuar). */
  url: string;
  finalUrl?: string;
  depth: number;
  source: 'homepage' | 'link' | 'sitemap';
  status?: number;
  redirects: RedirectHop[];
  headers: Record<string, string>;
  bodyBytes?: number;
  ttfbMs?: number;
  access: AccessState;
  error?: { code: string; message: string };
  /** Ridrejtoi jashtë sitit: s'analizohet. */
  external?: boolean;
  /** Ridrejtimi s'u ndoq: drejt host-i tjetër, robots.txt, URL e pasigurt ose skedar. */
  redirectNotFollowed?: { location: string; reason: string };
  /** Ridrejtoi te një faqe që është analizuar tashmë (çelësi i saj). */
  sameAs?: string;
  page?: PageData;
}

export interface LinkEdge {
  from: string;
  to: string;
  text: string;
}

export interface NotChecked {
  url: string;
  reason: SkipReason;
  from?: string;
}

export interface CrawlResult {
  root: string;
  limits: {
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    requestDelayMs: number;
    timeoutMs: number;
    maxDurationMs: number;
    respectRobots: boolean;
  };
  startedAt: string;
  durationMs: number;
  pages: CrawledPage[];
  edges: LinkEdge[];
  edgesTruncated: boolean;
  externalLinks: { count: number; sample: string[] };
  /** URL të brendshme të zbuluara që s'u vizituan, me arsye (lista e kufizuar; numrat e plotë te notCheckedCounts). */
  notChecked: NotChecked[];
  notCheckedCounts: Partial<Record<SkipReason, number>>;
  /** true kur mbetën URL pa kontroll për shkak të kufijve (faqe/kohë/ndalim). */
  truncated: boolean;
  stopReason?: string;
}

export interface CrawlOptions {
  /** Përgjigjja e faqes hyrëse nga MVP-1 (s'rikërkohet). */
  root: FetchResult;
  robots?: ParsedRobots;
  config: AuditConfig;
  fetchOptions: FetchOptions;
  /** URL nga sitemap-i: kontrollohen me buxhetin që mbetet pas linkeve. */
  sitemapUrls?: string[];
  onProgress?: (msg: string) => void;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function keptHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(KEPT_HEADERS.filter((k) => h[k] !== undefined).map((k) => [k, h[k]!]));
}

export async function crawlSite(o: CrawlOptions): Promise<CrawlResult> {
  const started = Date.now();
  const { config } = o;
  const limits = {
    maxPages: config.crawl.maxPages,
    maxDepth: config.crawl.maxDepth,
    concurrency: config.crawl.concurrency,
    requestDelayMs: o.fetchOptions.throttle?.delayMs ?? config.requestDelay,
    timeoutMs: config.timeout,
    maxDurationMs: config.crawl.maxDurationMs,
    respectRobots: config.respectRobots,
  };
  const rootUrl = new URL(o.root.finalUrl);
  const pages: CrawledPage[] = [];
  const edges: LinkEdge[] = [];
  let edgesTruncated = false;
  const seen = new Set<string>();
  /** Çelësat e faqeve të analizuara (URL përfundimtare), për të mos analizuar dy herë. */
  const parsed = new Set<string>();
  const notChecked = new Map<string, NotChecked>();
  const notCheckedCounts: Partial<Record<SkipReason, number>> = {};
  const external = new Set<string>();
  let fetched = 0;
  let consecutiveBlocks = 0;
  let stopReason: string | undefined;

  const skip = (url: string, reason: SkipReason, from?: string) => {
    if (notChecked.has(url)) return;
    notCheckedCounts[reason] = (notCheckedCounts[reason] ?? 0) + 1;
    notChecked.set(url, { url, reason, from });
  };

  /** Vendos nëse një link i brendshëm duhet vizituar; kthen çelësin nëse po. */
  const admit = (raw: string, from: string | undefined): string | null => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    const key = normalizeUrl(u);
    if (seen.has(key) || notChecked.has(key)) return null;
    if (!isInternal(u, rootUrl)) {
      external.add(key);
      return null;
    }
    try {
      assertUrlAllowed(u, config.allowedPrivateHosts);
    } catch {
      skip(key, 'blocked-url', from);
      return null;
    }
    const unsafe = unsafeOrExcluded(u, config.crawl.excludePatterns);
    if (unsafe) {
      skip(key, unsafe, from);
      return null;
    }
    if (config.respectRobots && o.robots && !isAllowed(o.robots, config.userAgent, u.pathname + u.search).allowed) {
      skip(key, 'robots', from);
      return null;
    }
    seen.add(key);
    return key;
  };

  const recordLinks = (page: CrawledPage, depth: number, next: { url: string; from: string }[] | null) => {
    for (const link of page.page?.links ?? []) {
      const from = page.finalUrl ?? page.url;
      let to: string;
      try {
        to = normalizeUrl(link.url);
      } catch {
        continue;
      }
      if (isInternal(new URL(to), rootUrl)) {
        if (edges.length < MAX_EDGES) edges.push({ from, to, text: link.text });
        else edgesTruncated = true;
      }
      // Faqet nga sitemap-i: linket ruhen si provë (edges), por s'ndiqen.
      if (!next) continue;
      const key = admit(link.url, from);
      if (!key) continue;
      if (depth < limits.maxDepth) next.push({ url: key, from });
      else skip(key, 'max-depth', from);
    }
  };

  const analyze = (res: FetchResult, page: CrawledPage) => {
    const finalKey = normalizeUrl(res.finalUrl);
    const finalUrl = new URL(res.finalUrl);
    if (!isInternal(finalUrl, rootUrl)) {
      page.external = true;
      return;
    }
    seen.add(finalKey);
    if (parsed.has(finalKey)) {
      page.sameAs = finalKey;
      return;
    }
    if (isSuccess(res.status) && isHtml(res)) {
      parsed.add(finalKey);
      page.page = parsePage(res.body, res.finalUrl, res.headers['x-robots-tag']);
    }
  };

  // Faqja hyrëse (thellësia 0), nga përgjigjja ekzistuese.
  const home: CrawledPage = {
    url: normalizeUrl(o.root.requestedUrl),
    finalUrl: o.root.finalUrl,
    depth: 0,
    source: 'homepage',
    status: o.root.status,
    redirects: o.root.redirects,
    headers: keptHeaders(o.root.headers),
    bodyBytes: o.root.bodyBytes,
    ttfbMs: o.root.ttfbMs,
    access: classifyAccess({ status: 'ok', value: o.root }).state,
  };
  seen.add(home.url);
  analyze(o.root, home);
  pages.push(home);
  fetched = 1;

  /** Ridrejtimet ndiqen vetëm brenda sitit dhe vetëm drejt URL-ve që do të vizitoheshin edhe me link. */
  const redirectPolicy = (next: URL): string | null => {
    if (!isInternal(next, rootUrl)) return 'external';
    const unsafe = unsafeOrExcluded(next, config.crawl.excludePatterns);
    if (unsafe) return unsafe;
    if (config.respectRobots && o.robots && !isAllowed(o.robots, config.userAgent, next.pathname + next.search).allowed) return 'robots';
    return null;
  };

  const fetchPage = async (url: string, depth: number, source: CrawledPage['source']): Promise<CrawledPage | null> => {
    if (stopReason) {
      skip(url, 'crawl-stopped');
      return null;
    }
    if (Date.now() - started > limits.maxDurationMs) {
      skip(url, 'time-budget');
      return null;
    }
    if (fetched >= limits.maxPages) {
      skip(url, 'max-pages');
      return null;
    }
    fetched++; // rezervim sinkron: me concurrency > 1 buxheti s'kalohet
    o.onProgress?.(`${fetched}/${limits.maxPages} ${url}`);
    const page: CrawledPage = { url, depth, source, redirects: [], headers: {}, access: 'unreachable' };
    try {
      const res = await safeFetch(url, { ...o.fetchOptions, redirectPolicy });
      Object.assign(page, {
        finalUrl: res.finalUrl,
        status: res.status,
        redirects: res.redirects,
        headers: keptHeaders(res.headers),
        bodyBytes: res.bodyBytes,
        ttfbMs: res.ttfbMs,
        access: classifyAccess({ status: 'ok', value: res }).state,
      });
      if (res.redirectNotFollowed) {
        // P.sh. /old → /logout ose → host tjetër: s'ndiqet dhe s'është "link i prishur".
        page.redirectNotFollowed = res.redirectNotFollowed;
        page.access = 'ok';
        page.external = res.redirectNotFollowed.reason === 'external';
        consecutiveBlocks = 0;
      } else if (page.access === 'blocked') {
        consecutiveBlocks++;
        if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
          stopReason = `U ndal pas ${MAX_CONSECUTIVE_BLOCKS} përgjigjesh 401/403/429 radhazi (bllokim ose rate limit për këtë klient)`;
        }
      } else {
        consecutiveBlocks = 0;
        analyze(res, page);
      }
    } catch (err) {
      const e = err instanceof FetchError ? err : undefined;
      page.error = { code: e?.code ?? 'NETWORK', message: (err as Error).message };
      page.redirects = e?.redirects ?? [];
    }
    pages.push(page);
    return page;
  };

  // BFS sipas nivelit: faqet më afër faqes hyrëse kontrollohen të parat.
  let frontier: { url: string; from: string }[] = [];
  recordLinks(home, 0, frontier);
  for (let depth = 1; depth <= limits.maxDepth && frontier.length > 0; depth++) {
    const next: { url: string; from: string }[] = [];
    await pool(frontier, limits.concurrency, async (item) => {
      const page = await fetchPage(item.url, depth, 'link');
      if (page) recordLinks(page, depth, next);
    });
    frontier = next;
  }

  // URL nga sitemap-i që s'u gjetën me linke: vetëm me buxhetin që mbetet.
  const sitemapQueue = (o.sitemapUrls ?? []).map((u) => admit(u, undefined)).filter((k): k is string => !!k);
  await pool(sitemapQueue, limits.concurrency, async (url) => {
    const page = await fetchPage(url, -1, 'sitemap');
    if (page) recordLinks(page, limits.maxDepth, null);
  });

  const listed = [...notChecked.values()];
  return {
    root: o.root.finalUrl,
    limits,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    pages,
    edges,
    edgesTruncated,
    externalLinks: { count: external.size, sample: [...external].slice(0, 20) },
    notChecked: listed.slice(0, MAX_NOT_CHECKED_LISTED),
    notCheckedCounts,
    truncated: (['max-pages', 'time-budget', 'crawl-stopped'] as SkipReason[]).some((r) => (notCheckedCounts[r] ?? 0) > 0),
    stopReason,
  };
}
