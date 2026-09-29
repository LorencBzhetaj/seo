import type { AuditConfig } from '../core/config.js';
import { FetchError, safeFetch, type FetchOptions } from '../net/safe-fetch.js';
import { parseSitemap, type SitemapEntry } from '../parse/sitemap.js';
import type { ParsedRobots } from '../parse/robots.js';
import { isInternal, normalizeUrl } from './url-rules.js';

export interface SitemapFile {
  url: string;
  source: 'robots' | 'default' | 'index';
  status?: number;
  kind: 'urlset' | 'index' | 'invalid' | 'unavailable';
  entryCount: number;
  error?: string;
}

export interface SitemapData {
  /** Si u gjet: nga robots.txt, nga vendndodhjet standarde, ose aspak. */
  discoveredVia: 'robots' | 'default' | 'none';
  files: SitemapFile[];
  urls: (SitemapEntry & { sitemap: string; key: string; internal: boolean })[];
  /** Kufiri i URL-ve ose i skedarëve u arrit. */
  truncated: boolean;
  /** Vendndodhjet standarde që u provuan kur robots.txt s'deklaronte sitemap. */
  triedDefaults: string[];
}

const DEFAULT_LOCATIONS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

/**
 * Lexon sitemap-et: ato të deklaruara në robots.txt, ose (vetëm kur s'ka) vendndodhjet standarde.
 * Index → sitemap-et fëmijë, me kufi skedarësh dhe URL-sh. Çdo kërkesë kalon nga safeFetch.
 */
export async function fetchSitemaps(root: URL, robots: ParsedRobots | undefined, config: AuditConfig, opts: FetchOptions): Promise<SitemapData> {
  const files: SitemapFile[] = [];
  const urls: SitemapData['urls'] = [];
  let truncated = false;
  const seenFiles = new Set<string>();
  const declared = (robots?.sitemaps ?? []).filter((s) => {
    try {
      return isInternal(new URL(s), root);
    } catch {
      return false;
    }
  });

  const load = async (url: string, source: SitemapFile['source']): Promise<SitemapFile> => {
    const file: SitemapFile = { url, source, kind: 'unavailable', entryCount: 0 };
    seenFiles.add(url);
    files.push(file);
    if (/\.gz($|\?)/i.test(url)) {
      file.error = 'Sitemap i kompresuar (.gz) s\'mbështetet ende';
      return file;
    }
    try {
      const res = await safeFetch(url, { ...opts, maxResponseBytes: Math.max(opts.maxResponseBytes, 10 * 1024 * 1024) });
      file.status = res.status;
      if (res.status < 200 || res.status >= 300) {
        file.error = `HTTP ${res.status}`;
        return file;
      }
      if (res.bodyTruncated) file.error = 'Sitemap më i madh se kufiri i madhësisë; u lexua pjesërisht';
      const parsed = parseSitemap(res.body, res.headers['content-type']);
      file.kind = parsed.kind;
      file.entryCount = parsed.entries.length;
      if (parsed.kind === 'invalid') {
        file.error = parsed.error;
        return file;
      }
      if (parsed.kind === 'urlset') {
        for (const e of parsed.entries) {
          if (urls.length >= config.crawl.maxSitemapUrls) {
            truncated = true;
            break;
          }
          let key = e.loc;
          let internal = false;
          try {
            const u = new URL(e.loc);
            key = normalizeUrl(u);
            internal = isInternal(u, root);
          } catch {
            /* loc i pavlefshëm: ruhet për raportim */
          }
          urls.push({ ...e, sitemap: url, key, internal });
        }
      } else {
        for (const e of parsed.entries) {
          if (seenFiles.has(e.loc)) continue;
          if (files.length >= config.crawl.maxSitemaps) {
            truncated = true;
            break;
          }
          let child: URL;
          try {
            child = new URL(e.loc);
          } catch {
            continue;
          }
          if (!isInternal(child, root)) continue;
          await load(child.href, 'index');
        }
      }
    } catch (err) {
      file.error = err instanceof FetchError ? `${err.code}: ${err.message}` : (err as Error).message;
    }
    return file;
  };

  if (declared.length) {
    for (const s of declared) {
      if (files.length >= config.crawl.maxSitemaps) {
        truncated = true;
        break;
      }
      await load(s, 'robots');
    }
    return { discoveredVia: 'robots', files, urls, truncated, triedDefaults: [] };
  }

  const tried: string[] = [];
  for (const path of DEFAULT_LOCATIONS) {
    const url = new URL(path, root).href;
    tried.push(url);
    const f = await load(url, 'default');
    if (f.kind === 'urlset' || f.kind === 'index') return { discoveredVia: 'default', files, urls, truncated, triedDefaults: tried };
  }
  // Asnjë vendndodhje standarde s'dha sitemap: skedarët e provuar s'raportohen si "sitemap i prishur".
  return { discoveredVia: 'none', files: [], urls: [], truncated: false, triedDefaults: tried };
}
