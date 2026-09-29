import { describe, expect, it } from 'vitest';
import { classifyPage, detectPageType, type DetectionPage } from '../src/detection/page-type.js';
import { combine } from '../src/detection/signals.js';
import { detectTechStack } from '../src/detection/tech-stack.js';
import { parsePage } from '../src/parse/page.js';

const B = 'https://e.com';
const page = (path: string, body: string, head = '', isHome = false): DetectionPage => {
  const url = `${B}${path}`;
  return { url, isHome, page: parsePage(`<!doctype html><html lang="${path.startsWith('/sq/') ? 'sq' : 'en'}"><head><title>T</title>${head}</head><body>${body}</body></html>`, url) };
};
const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const tech = (html: string, headers: Record<string, string> = {}, generators: string[] = []) => detectTechStack({ url: `${B}/`, html, headers, generators });

describe('combine (confidence nga sinjalet)', () => {
  it('1 − Π(1 − w), e rrumbullakosur, maks. 0.99', () => {
    expect(combine([{ weight: 0.5 }, { weight: 0.5 }])).toBe(0.75);
    expect(combine([])).toBe(0);
    expect(combine([{ weight: 1 }, { weight: 1 }])).toBe(0.99);
  });
});

describe('CMS/Tech Stack', () => {
  it('WordPress + Divi + WooCommerce + Cloudflare, me version nga generator', () => {
    const html = `<link rel="https://api.w.org/" href="https://e.com/wp-json/"><link rel="stylesheet" href="/wp-content/themes/Divi/style.css">
      <script src="/wp-includes/js/jquery/jquery.min.js"></script><body class="woocommerce-no-js et-db"><div class="et_pb_section"></div></body>`;
    const t = tech(html, { 'cf-ray': 'abc-FRA', server: 'cloudflare' }, ['WordPress 7.1.2', 'Divi v.4.27.9']);
    expect(t).toMatchObject({ cms: 'WordPress', cmsVersion: '7.1.2' });
    expect(t.confidence).toBeGreaterThanOrEqual(0.9);
    expect(t.signals.map((s) => s.signal)).toContain('<meta name="generator" content="WordPress 7.1.2">');
    expect(t.builder?.name).toBe('Divi');
    expect(t.ecommerce?.name).toBe('WooCommerce');
    expect(t.cdn?.name).toBe('Cloudflare');
  });

  it('Shopify nga header-at; Next.js nga __NEXT_DATA__', () => {
    expect(tech('<html></html>', { 'x-shopid': '1' }).cms).toBe('Shopify');
    const n = tech('<script id="__NEXT_DATA__" type="application/json">{}</script><script src="/_next/static/chunks/main.js"></script>');
    expect(n.framework?.name).toBe('Next.js');
    expect(n.cms).toBe('unknown');
  });

  it('pa prova → "unknown" (s\'hamendëson)', () => {
    const t = tech('<html><body><h1>Faqe statike</h1></body></html>', { server: 'nginx' });
    expect(t).toMatchObject({ cms: 'unknown', confidence: 0, candidates: [] });
  });

  it('false positive: artikull që PËRMEND "/wp-content/" në tekst s\'e bën sitin WordPress', () => {
    const t = tech('<article><p>Në WordPress, imazhet ruhen te /wp-content/uploads/ dhe skriptet te /wp-includes/.</p></article>');
    expect(t.cms).toBe('unknown');
  });

  it('një sinjal i dobët nën prag → unknown, por kandidati mbetet i dukshëm', () => {
    const t = tech('<script>var prestashop = {};</script>');
    expect(t.cms).toBe('unknown');
    expect(t.candidates).toEqual([{ name: 'PrestaShop', confidence: 0.4 }]);
  });
});

describe('Page Type Detection', () => {
  const booking = '<form id="b"><input name="name"><input type="email" name="email"><input type="date" name="checkin"><input type="date" name="checkout"><select name="adults"></select><textarea name="note"></textarea><button>Dërgo</button></form>';

  it('guesthouse me restorant: lodging primar, restaurant alternativë, aftësi dhe gjuhë', () => {
    const pages = [
      page('/', `<a class="btn" href="/restaurant/book-a-table/">Book a Table</a><a href="tel:+355671234567">+355 67 123 4567</a>${booking}`, ld({ '@type': 'LodgingBusiness', address: { '@type': 'PostalAddress', streetAddress: 'Rr. 1' } }), true),
      page('/restaurant/menu/', `<iframe src="https://menu.other.com/?embed=1" title="Menu"></iframe>${booking}`),
      page('/guesthouse/rooms/', `<h1>Dhomat</h1>${booking}`),
      page('/sq/kryefaqja/', `<p>Mirë se vini</p>${booking}`),
    ];
    const tech = detectTechStack({ url: `${B}/`, html: '', headers: {}, generators: [] });
    const { site, pages: cls } = detectPageType({ pages, tech, discoveredUrls: [] });
    expect(site.type).toBe('lodging');
    expect(site.confidence).toBeGreaterThanOrEqual(0.7);
    expect(site.alternatives.map((a) => a.type)).toContain('restaurant');
    expect(site.capabilities).toEqual(expect.arrayContaining(['booking', 'menu', 'contact', 'multilingual']));
    expect(site.languages).toEqual(['en', 'sq']);
    expect(cls.map((c) => c.type)).toEqual(['home', 'menu', 'rooms', 'home']);
    // Forma globale (në çdo faqe) s'e bën çdo faqe "booking"
    expect(cls.some((c) => c.type === 'booking')).toBe(false);
  });

  it('pa prova të mjaftueshme → unknown, jo hamendësim', () => {
    const { site, pages: cls } = detectPageType({
      pages: [page('/', '<h1>Mirë se vini</h1><p>Tekst</p>', '', true), page('/x/', '<p>faqe</p>')],
      tech: detectTechStack({ url: `${B}/`, html: '', headers: {}, generators: [] }),
      discoveredUrls: [],
    });
    expect(site).toMatchObject({ type: 'unknown', capabilities: [] });
    expect(site.confidence).toBeLessThan(0.5);
    expect(cls[1]).toMatchObject({ type: 'unknown' });
  });

  it('e-commerce nga Product + WooCommerce + URL shporte e pavizituar', () => {
    const pages = [page('/', '<p>Dyqan</p>', '', true), ...[1, 2, 3].map((i) => page(`/product/p${i}/`, '<p>x</p>', ld({ '@type': 'Product', name: `P${i}` })))];
    const tech = detectTechStack({ url: `${B}/`, html: '<body class="woocommerce-page"></body>', headers: {}, generators: [] });
    const { site, pages: cls } = detectPageType({ pages, tech, discoveredUrls: [`${B}/cart/`] });
    expect(site.type).toBe('ecommerce');
    expect(site.capabilities).toContain('shop');
    expect(cls.slice(1).every((c) => c.type === 'product')).toBe(true);
  });

  it('klasifikimi i faqeve: ligjore, kontakt, indeks blogu vs artikull; og:type article vetëm s\'mjafton', () => {
    const g = new Set<string>();
    expect(classifyPage(page('/sq/politika-e-privatesise/', '<p>x</p>'), g)).toMatchObject({ type: 'legal' });
    expect(classifyPage(page('/contact/', '<p>x</p>'), g)).toMatchObject({ type: 'contact' });
    expect(classifyPage(page('/journal/', '<p>x</p>', ld({ '@type': 'BlogPosting' })), g).type).toBe('blog-index');
    expect(classifyPage(page('/journal/heritage/a-story/', '<p>x</p>', `<meta property="og:type" content="article">${ld({ '@type': 'Article' })}`), g).type).toBe('blog-post');
    // Yoast vendos og:type article edhe në faqe të zakonshme
    expect(classifyPage(page('/restaurant/', '<p>x</p>', '<meta property="og:type" content="article">'), g).type).toBe('unknown');
  });
});

describe('Regresione nga auditi real i gjecaj.al (MVP-3)', () => {
  it('faqja e një dhome (/guesthouse/rooms/deluxe/) → rooms', () => {
    expect(classifyPage(page('/guesthouse/rooms/deluxe-double-balcony/', '<p>x</p>'), new Set()).type).toBe('rooms');
  });

  it('dy lloje pothuajse të barabarta → mixedWith (siti i përzier), jo një lloj i vetëm me siguri të rreme', () => {
    const booking = '<form><input name="name"><input type="email" name="email"><input type="date" name="checkin"><input type="date" name="checkout"><button>Dërgo</button></form>';
    const table = '<form><input name="rtb-date"><input name="rtb-time"><select name="rtb-party"></select><input type="email" name="rtb-email"><button>Book</button></form>';
    const pages = [
      page('/', `<a class="btn" href="/b">Book a Table</a>${booking}`, ld({ '@type': 'LodgingBusiness' }), true),
      page('/restaurant/', '<p>x</p>', ld({ '@type': 'Restaurant' })),
      page('/restaurant/menu/', '<p>menu</p>'),
      page('/restaurant/book-a-table/', table),
      page('/guesthouse/rooms/', '<p>dhomat</p>'),
    ];
    const { site } = detectPageType({ pages, tech: detectTechStack({ url: `${B}/`, html: '', headers: {}, generators: [] }), discoveredUrls: [] });
    expect(['lodging', 'restaurant']).toContain(site.type);
    expect(site.mixedWith).toBe(site.type === 'lodging' ? 'restaurant' : 'lodging');
  });
});
