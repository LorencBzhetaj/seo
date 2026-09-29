import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AuditConfig } from '../src/core/config.js';
import { collectContext, type AuditContext } from '../src/core/context.js';
import type { CrawlResult } from '../src/crawler/crawler.js';
import { isInternal, isUrlVariant, normalizeUrl, unsafeOrExcluded } from '../src/crawler/url-rules.js';
import { runLinks } from '../src/modules/site/links.js';
import { HostThrottle } from '../src/net/safe-fetch.js';
import { startFixtureSite, type FixtureOptions, type FixtureSite } from './fixture-site.js';

let site: FixtureSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

function config(host: string, over: Partial<AuditConfig['crawl']> = {}, top: Partial<AuditConfig> = {}): AuditConfig {
  return {
    ...DEFAULT_CONFIG,
    requestDelay: 20,
    allowedPrivateHosts: [host],
    lighthouse: { ...DEFAULT_CONFIG.lighthouse, enabled: false },
    ...top,
    crawl: { ...DEFAULT_CONFIG.crawl, ...over },
  };
}

async function crawlFixture(opts: FixtureOptions = {}, over: Partial<AuditConfig['crawl']> = {}, top: Partial<AuditConfig> = {}) {
  site = await startFixtureSite(opts);
  const ctx = await collectContext(`${site.base}/`, config(site.host, over, top));
  if (ctx.crawl.status !== 'ok') throw new Error(`crawl: ${JSON.stringify(ctx.crawl)}`);
  return { ctx, crawl: ctx.crawl.value, site };
}

const paths = (s: FixtureSite) => s.requests.map((r) => new URL(r.path, 'http://x').pathname);
const pageByPath = (crawl: CrawlResult, p: string) => crawl.pages.find((x) => new URL(x.url).pathname === p);
const skipOf = (crawl: CrawlResult, p: string) => crawl.notChecked.find((x) => new URL(x.url).pathname + new URL(x.url).search === p)?.reason;

describe('url-rules', () => {
  it('normalizon: pa fragment, pa parametra gjurmimi, host i vogël, pa portë parazgjedhje', () => {
    expect(normalizeUrl('https://Example.com:443/a?utm_source=x&id=2#top')).toBe('https://example.com/a?id=2');
  });

  it('www dhe pa-www janë i njëjti sit; subdomain tjetër jo', () => {
    const root = new URL('https://gjecaj.al/');
    expect(isInternal(new URL('https://www.gjecaj.al/x'), root)).toBe(true);
    expect(isInternal(new URL('https://shop.gjecaj.al/x'), root)).toBe(false);
  });

  it('s\'viziton login/logout/cart/checkout, veprime në query dhe skedarë', () => {
    const r = (u: string) => unsafeOrExcluded(new URL(u), DEFAULT_CONFIG.crawl.excludePatterns);
    for (const u of ['https://e.com/wp-login.php', 'https://e.com/en/logout/', 'https://e.com/cart/', 'https://e.com/checkout/order', 'https://e.com/my-account/', 'https://e.com/shop?add-to-cart=5', 'https://e.com/?action=delete', 'https://e.com/?s=kerkim', 'https://e.com/sign-in']) {
      expect(r(u), u).toBe('unsafe');
    }
    expect(r('https://e.com/wp-admin/options.php')).toBe('unsafe');
    expect(r('https://e.com/menu.pdf')).toBe('resource');
    // Segment i plotë: "login-tips" s'është login
    expect(r('https://e.com/blog/login-tips')).toBeNull();
    expect(r('https://e.com/rreth-nesh/')).toBeNull();
  });

  it('isUrlVariant: trailing slash / query e njëjta faqe; path tjetër jo', () => {
    expect(isUrlVariant('https://e.com/a/', 'https://e.com/a')).toBe(true);
    expect(isUrlVariant('https://e.com/a?x=1', 'https://e.com/a')).toBe(true);
    expect(isUrlVariant('https://e.com/a', 'https://e.com/b')).toBe(false);
  });
});

describe('HostThrottle', () => {
  it('me thirrje paralele, kërkesat drejt të njëjtit host nisin të paktën `delay` ms larg', async () => {
    const t = new HostThrottle(60);
    const starts: number[] = [];
    await Promise.all([1, 2, 3, 4].map(async () => {
      await t.wait('h');
      starts.push(Date.now());
    }));
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(55);
  });
});

describe('Crawler mbi site lokal', () => {
  it('zbulon faqet dhe s\'viziton robots/unsafe/skedarë/jashtë/përtej thellësisë', async () => {
    const { crawl, site: s } = await crawlFixture();
    const visited = paths(s);
    for (const p of ['/about', '/contact', '/privacy', '/blog', '/blog/post-1', '/products', '/missing', '/level1', '/level2', '/level3']) {
      expect(visited, p).toContain(p);
    }
    // Asnjëherë: robots, login, cart, add-to-cart, PDF, thellësia 4
    for (const p of ['/private/secret', '/wp-login.php', '/cart/', '/shop', '/files/menu.pdf', '/level4']) {
      expect(visited, p).not.toContain(p);
    }
    expect(skipOf(crawl, '/private/secret')).toBe('robots');
    expect(skipOf(crawl, '/wp-login.php')).toBe('unsafe');
    expect(skipOf(crawl, '/cart/')).toBe('unsafe');
    expect(skipOf(crawl, '/shop?add-to-cart=12')).toBe('unsafe');
    expect(skipOf(crawl, '/files/menu.pdf')).toBe('resource');
    expect(skipOf(crawl, '/level4')).toBe('max-depth');
    expect(crawl.externalLinks.count).toBe(1);
    // /about#team s'kërkohet si faqe e dytë; serveri e sheh /about dy herë vetëm sepse /old-page ridrejton aty
    expect(crawl.pages.filter((p) => new URL(p.url).pathname === '/about')).toHaveLength(1);
    const hops = crawl.pages.filter((p) => p.source !== 'homepage').reduce((n, p) => n + (p.error ? 0 : p.redirects.length - (p.redirectNotFollowed ? 1 : 0)), 0); // hop i bllokuar/i pandjekur s'arrin te serveri
    expect(visited.filter((p) => p === '/about')).toHaveLength(1 + crawl.pages.filter((p) => p.finalUrl?.endsWith('/about') && p.redirects.length).length);
    expect(hops).toBeGreaterThan(0);
    expect(pageByPath(crawl, '/level3')!.depth).toBe(3);
    expect(crawl.truncated).toBe(false);
  });

  it('kufiri maxPages: jo më shumë se 25 kërkesa faqesh; pjesa tjetër "max-pages" dhe truncated', async () => {
    const { crawl, site: s } = await crawlFixture({ productPages: 40 });
    const pageRequests = paths(s).filter((p) => p !== '/robots.txt' && p !== '/sitemap.xml');
    // 25 faqe; hop-et e ridrejtimeve brenda së njëjtës kërkesë faqeje s'numërohen si faqe të reja
    const hops = crawl.pages.filter((p) => p.source !== 'homepage').reduce((n, p) => n + (p.error ? 0 : p.redirects.length - (p.redirectNotFollowed ? 1 : 0)), 0); // hop i bllokuar/i pandjekur s'arrin te serveri
    expect(crawl.pages).toHaveLength(25);
    expect(pageRequests.length).toBe(25 + hops);
    expect(crawl.notCheckedCounts['max-pages']).toBeGreaterThan(0);
    expect(crawl.truncated).toBe(true);
  });

  it('concurrency ≤ 2 dhe vonesa për host respektohet', async () => {
    const { site: s } = await crawlFixture({ latencyMs: 60 }, {}, { requestDelay: 100 });
    expect(s.maxActive()).toBeLessThanOrEqual(2);
    // Koha matet te serveri (përfshin luhatjen e lidhjes TCP): tolerancë e vogël për çdo hap, mesatarja ≥ vonesës.
    const starts = s.requests.map((r) => r.at).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(70);
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeGreaterThanOrEqual(97);
  });

  it('--ignore-robots (respectRobots=false) e lejon URL-në e ndaluar; unsafe mbetet i ndaluar', async () => {
    const { site: s } = await crawlFixture({}, {}, { respectRobots: false });
    expect(paths(s)).toContain('/private/secret');
    expect(paths(s)).not.toContain('/wp-login.php');
  });

  it('ridrejtimet: drejt adrese private (port jashtë allowlist) bllokohet; 301 i brendshëm ndiqet pa rianalizuar faqen', async () => {
    const { crawl } = await crawlFixture();
    const toLocal = pageByPath(crawl, '/to-local')!;
    expect(toLocal.error?.code).toBe('BLOCKED');
    expect(toLocal.redirects[0]!.location).toBe('http://127.0.0.1:1/admin');
    const old = pageByPath(crawl, '/old-page')!;
    expect(old.status).toBe(200);
    expect(old.redirects[0]!.status).toBe(301);
    expect(new URL(old.finalUrl!).pathname).toBe('/about');
    // /about u analizua vetëm një herë
    expect(crawl.pages.filter((p) => p.page && new URL(p.finalUrl!).pathname === '/about')).toHaveLength(1);
  });

  it("ridrejtimet s'ndiqen drejt /logout, host-i tjetër ose URL të ndaluar nga robots.txt", async () => {
    const { crawl, site: s } = await crawlFixture({ robotsTxt: 'User-agent: *\nDisallow: /private/\nDisallow: /about\n', sitemap: 'none' });
    expect(paths(s)).not.toContain('/logout');
    expect(paths(s)).not.toContain('/about');
    expect(pageByPath(crawl, '/to-logout')!.redirectNotFollowed).toEqual({ location: `${s.base}/logout`, reason: 'unsafe' });
    expect(pageByPath(crawl, '/to-partner')!.redirectNotFollowed!.reason).toBe('external');
    expect(pageByPath(crawl, '/to-partner')!.external).toBe(true);
    expect(pageByPath(crawl, '/old-page')!.redirectNotFollowed!.reason).toBe('robots');
    // S'janë "linke të prishura"
    const r = runLinks({ crawl: { status: 'ok', value: crawl } } as unknown as AuditContext);
    expect(r.issues.some((i) => i.code === 'BROKEN_INTERNAL_LINK' && /to-logout|to-partner|old-page/.test(i.url!))).toBe(false);
  });

  it('URL nga sitemap-i që s\'kanë link kontrollohen me buxhetin që mbetet', async () => {
    const { crawl } = await crawlFixture();
    expect(pageByPath(crawl, '/orphan')!.source).toBe('sitemap');
    expect(pageByPath(crawl, '/gone-from-sitemap')!.status).toBe(404);
  });

  it('ndalet pas 3 përgjigjesh 403 radhazi dhe shënon pjesën tjetër "crawl-stopped"', async () => {
    const { crawl } = await crawlFixture({ blockedSection: true, sitemap: 'none' }, { concurrency: 1 });
    expect(crawl.stopReason).toMatch(/3 përgjigjesh 401\/403\/429/);
    expect(crawl.pages.filter((p) => p.access === 'blocked')).toHaveLength(3);
    expect(crawl.notCheckedCounts['crawl-stopped']).toBe(2);
    expect(crawl.truncated).toBe(true);
  });
});

describe('Moduli i linkeve', () => {
  it('link i prishur: URL, status dhe faqet burim me tekstin e linkut si provë', async () => {
    const { ctx } = await crawlFixture();
    const r = runLinks(ctx);
    const broken = r.issues.find((i) => i.code === 'BROKEN_INTERNAL_LINK' && i.url!.endsWith('/missing'))!;
    expect(broken.severity).toBe('medium');
    expect(broken.affectedPages.map((u) => new URL(u).pathname).sort()).toEqual(['/', '/contact']);
    expect(broken.evidence[0]!.detected).toMatch(/^HTTP 404; lidhet nga: .*\("Link i prishur"\)/);
    const server = r.issues.find((i) => i.code === 'INTERNAL_LINK_SERVER_ERROR')!;
    expect(server).toMatchObject({ severity: 'high', confidence: 0.8 });
    // /gone-from-sitemap s'ka link: s'është "link i prishur" (e vlerëson moduli Sitemap)
    expect(r.issues.some((i) => i.url?.endsWith('/gone-from-sitemap'))).toBe(false);
    const redirects = r.issues.find((i) => i.code === 'INTERNAL_LINKS_VIA_REDIRECT')!;
    expect(redirects.affectedPages.some((u) => u.endsWith('/old-page'))).toBe(true);
    expect(r.issues.find((i) => i.code === 'LINK_TARGET_UNREACHABLE')!.needsManualReview).toBe(true);
    expect(r.score).not.toBeNull();
    for (const i of r.issues) {
      expect(i.url).toBeTruthy();
      expect(i.evidence.length).toBeGreaterThan(0);
    }
  });

  it('linket e template-it (≥ 3 faqe) bashkohen në një issue "template"', async () => {
    const { ctx } = await crawlFixture({ productPages: 3 });
    // /old-page është në nav të çdo faqeje → një issue për ridrejtimin, jo një për faqe
    const r = runLinks(ctx);
    expect(r.issues.filter((i) => i.code === 'INTERNAL_LINKS_VIA_REDIRECT')).toHaveLength(1);
  });

  it('pa faqe përtej hyrëses → score null (jo 100), me arsye', async () => {
    const { ctx } = await crawlFixture({}, { maxPages: 1 });
    const r = runLinks(ctx);
    expect(r.score).toBeNull();
    expect(r.status).toBe('skipped');
    expect(r.checks[0]!.reason).toMatch(/s'kontrolloi asnjë faqe përtej hyrëses/);
    expect(r.checks[0]!.reason).toMatch(/kufiri i faqeve/);
  });

  it('crawl i çaktivizuar → modul skipped me arsye', () => {
    const ctx = { crawl: { status: 'skipped', reason: 'Crawl-i u çaktivizua (--no-crawl)' } } as unknown as AuditContext;
    expect(runLinks(ctx)).toMatchObject({ score: null, status: 'skipped', reason: 'Crawl-i u çaktivizua (--no-crawl)' });
  });
});
