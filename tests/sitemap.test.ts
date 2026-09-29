import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AuditConfig } from '../src/core/config.js';
import { collectContext } from '../src/core/context.js';
import { runSitemap } from '../src/modules/site/sitemap.js';
import { isValidLastmod, parseSitemap } from '../src/parse/sitemap.js';
import { startFixtureSite, type FixtureOptions, type FixtureSite } from './fixture-site.js';

let site: FixtureSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

async function ctxFor(opts: FixtureOptions) {
  site = await startFixtureSite(opts);
  const config: AuditConfig = {
    ...DEFAULT_CONFIG, requestDelay: 10, allowedPrivateHosts: [site.host],
    lighthouse: { ...DEFAULT_CONFIG.lighthouse, enabled: false },
  };
  return collectContext(`${site.base}/`, config);
}

const codes = (r: ReturnType<typeof runSitemap>) => r.issues.map((i) => i.code).sort();

describe('parseSitemap', () => {
  it('lexon urlset me lastmod', () => {
    const p = parseSitemap('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc> https://e.com/a </loc><lastmod>2026-09-01</lastmod></url><url><loc>https://e.com/b</loc></url></urlset>');
    expect(p.kind).toBe('urlset');
    expect(p.entries).toEqual([
      { loc: 'https://e.com/a', lastmod: '2026-09-01', lastmodValid: true },
      { loc: 'https://e.com/b', lastmod: undefined, lastmodValid: undefined },
    ]);
  });

  it('lexon sitemapindex dhe elemente me prefix namespace-i', () => {
    const p = parseSitemap('<sm:sitemapindex xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:sitemap><sm:loc>https://e.com/s1.xml</sm:loc></sm:sitemap></sm:sitemapindex>');
    expect(p.kind).toBe('index');
    expect(p.entries[0]!.loc).toBe('https://e.com/s1.xml');
  });

  it('HTML ose rrënjë tjetër → invalid me arsye', () => {
    expect(parseSitemap('<html><body>404</body></html>', 'text/html').error).toMatch(/HTML në vend të XML/);
    expect(parseSitemap('<rss><channel/></rss>').error).toMatch(/"rss"/);
    expect(parseSitemap('').kind).toBe('invalid');
  });

  it('lastmod W3C', () => {
    for (const v of ['2026', '2026-09', '2026-09-01', '2026-09-01T10:00+02:00', '2026-09-01T10:00:00.5Z']) expect(isValidLastmod(v), v).toBe(true);
    for (const v of ['not-a-date', '01/09/2026', '2026-13-01', '2026-09-01 10:00']) expect(isValidLastmod(v), v).toBe(false);
  });
});

describe('Sitemap Health mbi site lokal', () => {
  it('krahason sitemap-in me crawl-in: 404, ridrejtim, lastmod i pavlefshëm, faqe që mungojnë', async () => {
    const ctx = await ctxFor({});
    const r = runSitemap(ctx);
    expect(codes(r)).toEqual(['PAGES_MISSING_FROM_SITEMAP', 'SITEMAP_INVALID_LASTMOD', 'SITEMAP_URL_ERROR', 'SITEMAP_URL_REDIRECTS']);
    const err = r.issues.find((i) => i.code === 'SITEMAP_URL_ERROR')!;
    expect(err.affectedPages).toEqual([`${site!.base}/gone-from-sitemap`]);
    expect(err.evidence[0]!.detected).toMatch(/^HTTP 404 \(sitemap: .*sitemap\.xml\)$/);
    expect(r.issues.find((i) => i.code === 'SITEMAP_URL_REDIRECTS')!.evidence[0]!.detected).toMatch(/301 → .*\/about/);
    expect(r.issues.find((i) => i.code === 'PAGES_MISSING_FROM_SITEMAP')!.affectedPages).toContain(`${site!.base}/contact`);
    // Crawl-i s'ishte i plotë (thellësia 4 mbeti jashtë): /orphan s'shpallet "orphan", vetëm vërejtje
    expect(codes(r)).not.toContain('SITEMAP_URLS_WITHOUT_INTERNAL_LINKS');
    expect(r.checks.find((c) => c.id === 'sitemap-coverage')!.observations![0]).toMatch(/s'mund të quhen "orphan"/);
    expect(r.metrics.find((x) => x.id === 'lastmod-coverage')!.value).toBe(60);
    expect(r.score).not.toBeNull();
  });

  it('crawl i plotë brenda kufijve: URL e sitemap-it pa link → "orphan" me confidence të ulët; Disallow → kontradiktë', async () => {
    // /level* të ndaluara → s'ka "max-depth"; /about e ndaluar por në sitemap → kontradiktë
    const ctx = await ctxFor({ robotsTxt: 'User-agent: *\nDisallow: /private/\nDisallow: /level\nDisallow: /about\nSitemap: __BASE__/sitemap.xml\n' });
    const r = runSitemap(ctx);
    expect(ctx.crawl.status).toBe('ok');
    const blocked = r.issues.find((i) => i.code === 'SITEMAP_URL_BLOCKED_BY_ROBOTS');
    expect(blocked?.affectedPages.some((u) => u.endsWith('/about'))).toBe(true);
    const orphan = r.issues.find((i) => i.code === 'SITEMAP_URLS_WITHOUT_INTERNAL_LINKS')!;
    expect(orphan.affectedPages.some((u) => u.endsWith('/orphan'))).toBe(true);
    expect(orphan.needsManualReview).toBe(true);
  });

  it('pa sitemap: s\'është problem dhe s\'jep score (jo 100)', async () => {
    const ctx = await ctxFor({ sitemap: 'none', robotsTxt: 'User-agent: *\nDisallow: /private/\n' });
    const r = runSitemap(ctx);
    expect(r.score).toBeNull();
    expect(r.issues).toEqual([]);
    expect(r.checks[0]!.observations![0]).toMatch(/Nuk u gjet sitemap/);
  });

  it('sitemap i deklaruar që kthen HTML → SITEMAP_INVALID', async () => {
    const ctx = await ctxFor({ sitemap: 'html' });
    const r = runSitemap(ctx);
    const i = r.issues.find((x) => x.code === 'SITEMAP_INVALID')!;
    expect(i.evidence[0]!.detected).toMatch(/HTML në vend të XML/);
  });
});

describe('Sitemap: URL të pakontrolluara me arsyen e saktë', () => {
  it('cart/checkout nga sitemap-i: përjashtim me rregull (jo partial); kufiri i faqeve: partial', async () => {
    const { siteCtx, htmlPage } = await import('./site-helpers.js');
    const B = 'https://e.com';
    const entry = (loc: string) => ({ loc, sitemap: `${B}/page-sitemap.xml`, key: loc, internal: true });
    const make = (notChecked: { url: string; reason: 'unsafe' | 'max-pages' }[]) => {
      const ctx = siteCtx([{ url: `${B}/`, html: htmlPage({ title: 'Kreu' }) }, { url: `${B}/a/`, html: htmlPage({ title: 'A' }) }], {
        notChecked, notCheckedCounts: Object.fromEntries(notChecked.map((n) => [n.reason, notChecked.filter((x) => x.reason === n.reason).length])),
        truncated: notChecked.some((n) => n.reason === 'max-pages'),
      });
      const urls = [`${B}/`, `${B}/a/`, ...notChecked.map((n) => n.url)].map(entry);
      return { ...ctx, sitemaps: { status: 'ok' as const, value: { discoveredVia: 'robots' as const, files: [], urls, truncated: false, triedDefaults: [] } } };
    };
    const rule = runSitemap(make([{ url: `${B}/cart/`, reason: 'unsafe' }, { url: `${B}/checkout/`, reason: 'unsafe' }]));
    expect(rule.partial).toBe(false);
    expect(rule.coverage).toEqual({ checked: 2, discovered: 4, excludedByRule: 2, truncated: false });
    expect(rule.limitations.join(' ')).toContain(`Sitemap: 2 nga 4 URL s'u vizituan me qëllim — 2 URL që mund të ndryshojë gjendje (login/logout/cart/checkout/veprim): ${B}/cart/, ${B}/checkout/.`);
    expect(rule.limitations.join(' ')).not.toMatch(/kufij/);

    const limit = runSitemap(make([{ url: `${B}/b/`, reason: 'max-pages' }]));
    expect(limit.partial).toBe(true);
    expect(limit.limitations.join(' ')).toContain(`1 nga 3 URL s'u kontrolluan nga kufijtë e crawl-it — 1 kufiri i faqeve (maxPages): ${B}/b/`);
  });
});
