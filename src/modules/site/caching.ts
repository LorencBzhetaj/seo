import type { AuditContext } from '../../core/context.js';
import type { AuditResult } from '../../core/schemas.js';
import { ModuleBuilder } from '../helpers.js';
import { crawlCoverage, crawlUnavailable, groupByTemplate } from './common.js';

/** Nën këtë madhësi compression-i s'sjell dobi (≈ një paketë TCP). */
const MIN_COMPRESSIBLE_BYTES = 1400;

function topValues(values: string[], n = 3): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, c]) => `${c}× ${v}`).join(', ');
}

/**
 * Compression dhe header-at e caching-ut për dokumentet HTML të crawl-it.
 * Politika e cache-it për HTML varet nga siti (dinamik/statik), ndaj raportohet vetëm si informacion;
 * issue jepet vetëm për HTML të pakompresuar, që është i matshëm.
 */
export function runCaching(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('caching', 'caching');
  const unavailable = crawlUnavailable(ctx);
  if (unavailable || ctx.crawl.status !== 'ok') {
    m.skip('html-compression', 'Compression i HTML', 2, unavailable ?? 'Pa crawl');
    return m.build({ score: null, reason: unavailable });
  }
  const crawl = ctx.crawl.value;
  const docs = crawl.pages.filter((p) => p.page && p.access === 'ok' && !p.sameAs);
  const compressible = docs.filter((p) => (p.bodyBytes ?? 0) >= MIN_COMPRESSIBLE_BYTES);
  if (compressible.length === 0) {
    m.notApplicable('html-compression', 'Compression i HTML', `Asnjë dokument HTML ≥ ${MIN_COMPRESSIBLE_BYTES} bytes`);
    return m.build({ score: null, reason: 'S\'ka dokumente HTML mjaft të mëdha për compression' });
  }

  const uncompressed = compressible.filter((p) => !p.headers['content-encoding'] || p.headers['content-encoding'] === 'identity');
  const allPages = uncompressed.length === compressible.length;
  const drafts = groupByTemplate(
    { code: 'HTML_NOT_COMPRESSED', severity: 'medium', impact: 'Performance (transferim)', impactLevel: 'medium', effort: 'low', confidence: 0.9,
      whyItMatters: 'HTML i pakompresuar transferon disa herë më shumë bytes; ngadalëson ngarkimin sidomos në mobile.',
      fix: 'Aktivizo gzip ose brotli për text/html në server/CDN (u dërgua "Accept-Encoding: gzip, deflate, br").' },
    (n) => `${n} dokumente HTML shërbehen pa compression`,
    uncompressed.map((p) => ({
      url: p.finalUrl ?? p.url,
      // Kur mungon kudo, është konfigurim serveri, jo template: një issue i vetëm për gjithë sitin.
      templateKey: allPages ? 'server' : p.page?.templateKey,
      type: 'http' as const,
      detected: `Content-Encoding mungon; ${Math.round((p.bodyBytes ?? 0) / 1024)} KB HTML`, expected: 'Content-Encoding: br ose gzip',
    })),
  ).map((d) => (allPages ? { ...d, scope: 'site' as const, message: `Të gjitha ${uncompressed.length} dokumentet HTML të kontrolluara shërbehen pa compression (konfigurim serveri)` } : d));

  const encodings = compressible.map((p) => p.headers['content-encoding'] ?? 'asnjë');
  const cacheControl = docs.map((p) => p.headers['cache-control'] ?? 'mungon');
  const cdn = docs.map((p) => p.headers['cf-cache-status'] ?? p.headers['x-cache']).filter((v): v is string => !!v);
  const validators = docs.filter((p) => p.headers.etag || p.headers['last-modified']).length;
  m.check('html-compression', 'Compression i HTML', 2, drafts, [`Content-Encoding: ${topValues(encodings)}`]);
  m.info('html-cache-headers', 'Header-at e cache-it për HTML', [
    `Cache-Control: ${topValues(cacheControl)}`,
    cdn.length ? `CDN cache: ${topValues(cdn)}` : 'Pa header statusi cache-i nga CDN',
    `ETag/Last-Modified: ${validators}/${docs.length} faqe`,
    'Politika e cache-it për HTML varet nga përmbajtja (dinamike/statike); s\'vlerësohet si problem pa kontekst.',
  ]);
  m.limitations.push('Caching: vetëm dokumentet HTML; burimet statike (imazhe/CSS/JS) i mbulon Lighthouse vetëm për faqen hyrëse.');
  return m.build({ coverage: crawlCoverage(crawl, compressible.length) });
}
