import type { PageData } from '../parse/page.js';
import { combine, MIN_CONFIDENCE, rank, type DetectionSignal } from './signals.js';
import type { TechStackResult } from './tech-stack.js';

/**
 * Page Type Detection (§2 J, §3): lloji i sitit (me confidence, signals, capabilities, languages)
 * dhe lloji i çdo faqeje të analizuar. "unknown" kur provat s'mjaftojnë.
 */
export type SiteType = 'lodging' | 'restaurant' | 'ecommerce' | 'blog' | 'local-business' | 'unknown';
export type PageKind =
  | 'home' | 'contact' | 'about' | 'menu' | 'booking' | 'rooms' | 'product' | 'shop' | 'blog-post' | 'blog-index'
  | 'legal' | 'faq' | 'gallery' | 'unknown';

export interface PageTypeResult {
  type: SiteType;
  confidence: number;
  signals: DetectionSignal[];
  /** Llojet e tjera me prova (p.sh. guesthouse me restorant). */
  alternatives: { type: SiteType; confidence: number }[];
  /** Kur lloji i dytë është pothuajse i barabartë (≤ 0.05): siti duket i përzier — mos e trajto si të vetëm. */
  mixedWith?: SiteType;
  capabilities: string[];
  languages: string[];
}

export interface PageClassification {
  url: string;
  type: PageKind;
  confidence: number;
  signals: string[];
}

export interface DetectionPage {
  url: string;
  isHome: boolean;
  page: PageData;
}

const LODGING_SCHEMA = /^(LodgingBusiness|Hotel|Hostel|BedAndBreakfast|Motel|Resort|Campground|VacationRental|GuestHouse)$/;
const FOOD_SCHEMA = /^(Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|FastFoodRestaurant|Winery|Brewery)$/;
const ARTICLE_SCHEMA = /^(Article|BlogPosting|NewsArticle)$/;
const LOCAL_SCHEMA = /^(LocalBusiness|Store|ProfessionalService|MedicalBusiness|HomeAndConstructionBusiness|AutomotiveBusiness|HealthAndBeautyBusiness|SportsActivityLocation)$/;

/** Fjalë kyçe në segmentet e URL-së (en/sq/it/de). */
const PATH_KINDS: [PageKind, RegExp, number][] = [
  ['home', /^(home|kryefaqja|faqja-kryesore|startseite|inicio|accueil)$/, 0.6],
  ['contact', /^(contact(-us)?|kontakt(i)?|na-kontaktoni|contatti)$/, 0.6],
  ['about', /^(about(-us)?|rreth(-nesh)?|per-ne|chi-siamo|ueber-uns|story|historia|history)$/, 0.55],
  ['menu', /^(menu|menuja|menyja|speisekarte)$/, 0.6],
  ['booking', /^(book(ing)?|book-a-table|reserve|reservations?|rezervo(ni)?|rezervime?|prenota(zioni)?|buchen)$/, 0.55],
  ['rooms', /^(rooms?|dhomat?|accommodations?|suites?|stay|akomodim|camere|zimmer)$/, 0.55],
  ['shop', /^(shop|store|dyqan|product-category|category|categories|collections)$/, 0.5],
  ['blog-index', /^(blog|journal|news|lajme|artikuj|magazine)$/, 0.5],
  ['legal', /^(privacy(-policy)?|cookies?(-policy)?|terms(-and-conditions|-of-service)?|impressum|imprint|legal|politika-e-privatesise|politika-e-cookies|kushtet(-e-perdorimit)?|gdpr)$/, 0.7],
  ['faq', /^(faq|faqs|pyetjet-e-bera-shpesh(-faq)?|pyetje)$/, 0.6],
  ['gallery', /^(gallery|galeria|galeri|photos|foto)$/, 0.6],
];

function segments(url: string): string[] {
  try {
    return new URL(url).pathname.toLowerCase().split('/').filter(Boolean).filter((s) => !/^[a-z]{2}(-[a-z]{2})?$/.test(s));
  } catch {
    return [];
  }
}

/** Format i një forme që del në (pothuajse) çdo faqe: e template-it (p.sh. modal global), s'e karakterizon faqen. */
function siteWideForms(pages: DetectionPage[]): Set<string> {
  const count = new Map<string, number>();
  for (const p of pages) for (const s of new Set(p.page.business.forms.map((f) => f.signature))) count.set(s, (count.get(s) ?? 0) + 1);
  const threshold = Math.max(3, pages.length * 0.6);
  return new Set([...count].filter(([, n]) => n >= threshold).map(([s]) => s));
}

export function classifyPage(p: DetectionPage, globalForms: Set<string>): PageClassification {
  if (p.isHome) return { url: p.url, type: 'home', confidence: 1, signals: ['faqja hyrëse'] };
  const found: { name: PageKind; signal: DetectionSignal }[] = [];
  const add = (name: PageKind, signal: string, weight: number, source: DetectionSignal['source'] = 'url') => found.push({ name, signal: { signal, source, weight } });
  const segs = segments(p.url);
  // Rrënja e një gjuhe (p.sh. /sq/, /en/) është faqe hyrëse e asaj gjuhe.
  if (segs.length === 0) add('home', 'rrënja e një gjuhe (p.sh. /sq/)', 0.6);
  segs.forEach((s, i) => {
    for (const [kind, re, w] of PATH_KINDS) {
      // Segmenti i fundit peshon plotësisht; më lart në shteg (p.sh. /blog/x/) = kontekst.
      if (re.test(s)) add(kind === 'blog-index' && i < segs.length - 1 ? 'blog-post' : kind, `URL: /${s}/`, i === segs.length - 1 ? (kind === 'blog-index' ? 0.6 : w) : w * 0.6);
    }
    if (s === 'product' && i < segs.length - 1) add('product', 'URL: /product/…', 0.45);
    // Faqja e një dhome (/rooms/deluxe-…/) është faqe dhomash, jo e panjohur.
    if (/^(rooms?|dhomat?|accommodations?|suites?)$/.test(s) && i < segs.length - 1) add('rooms', `URL: /${s}/…`, 0.5);
  });
  const b = p.page.business;
  const types = b.jsonLd.types;
  if (types.includes('Product')) add('product', 'JSON-LD Product', 0.5, 'schema');
  if (types.some((t) => ARTICLE_SCHEMA.test(t))) add('blog-post', `JSON-LD ${types.find((t) => ARTICLE_SCHEMA.test(t))}`, 0.5, 'schema');
  // Plugin-et SEO (p.sh. Yoast) vendosin og:type article edhe në faqe të zakonshme: sinjal i dobët.
  if (b.ogType === 'article') add('blog-post', 'og:type article', 0.15, 'html');
  if (types.includes('FAQPage')) add('faq', 'JSON-LD FAQPage', 0.4, 'schema');
  if (types.includes('ContactPage') || types.includes('ContactPoint')) add('contact', `JSON-LD ${types.includes('ContactPage') ? 'ContactPage' : 'ContactPoint'}`, 0.3, 'schema');
  if (types.includes('Menu')) add('menu', 'JSON-LD Menu', 0.4, 'schema');
  if (b.iframes.some((f) => f.kind === 'menu')) add('menu', 'iframe menuje', 0.3, 'html');
  if (b.iframes.some((f) => f.kind === 'booking')) add('booking', 'iframe rezervimi', 0.35, 'html');
  const own = b.forms.filter((f) => !globalForms.has(f.signature) && !f.initiallyHidden);
  if (own.some((f) => f.purpose === 'booking')) add('booking', 'formë rezervimi e kësaj faqeje', 0.4, 'html');
  if (own.some((f) => f.purpose === 'contact')) add('contact', 'formë kontakti e kësaj faqeje', 0.3, 'html');
  if (/single-product/.test(p.page.templateKey)) add('product', 'template single-product', 0.3, 'html');
  if (/\b(blog|archive|category)\b/.test(p.page.templateKey) && !types.includes('Product')) add('blog-index', 'template arkive', 0.2, 'html');

  const ranked = rank(found);
  const top = ranked[0];
  if (!top || top.confidence < MIN_CONFIDENCE) {
    return { url: p.url, type: 'unknown', confidence: top?.confidence ?? 0, signals: top ? top.signals.map((s) => s.signal) : [] };
  }
  return { url: p.url, type: top.name as PageKind, confidence: top.confidence, signals: top.signals.map((s) => s.signal) };
}

export interface PageTypeInput {
  pages: DetectionPage[];
  tech: TechStackResult;
  /** URL të zbuluara por të pavizituara (p.sh. /cart/ nga rregullat e sigurisë): tregojnë aftësi. */
  discoveredUrls: string[];
}

export function detectPageType(input: PageTypeInput): { site: PageTypeResult; pages: PageClassification[] } {
  const { pages } = input;
  const globalForms = siteWideForms(pages);
  const classified = pages.map((p) => classifyPage(p, globalForms));
  const kinds = (k: PageKind) => classified.filter((c) => c.type === k);
  const home = pages.find((p) => p.isHome);
  const allTypes = (re: RegExp) => pages.filter((p) => p.page.business.jsonLd.types.some((t) => re.test(t)));
  const allForms = pages.flatMap((p) => p.page.business.forms);
  const found: { name: SiteType; signal: DetectionSignal }[] = [];
  const add = (name: SiteType, signal: string, weight: number, source: DetectionSignal['source'], url?: string) => found.push({ name, signal: { signal, source, weight, url } });

  // Lodging
  const lodgingSchema = allTypes(LODGING_SCHEMA);
  if (lodgingSchema.length) {
    const onHome = lodgingSchema.find((p) => p.isHome);
    add('lodging', `JSON-LD ${lodgingSchema[0]!.page.business.jsonLd.types.find((t) => LODGING_SCHEMA.test(t))}${onHome ? ' në faqen hyrëse' : ''}`, onHome ? 0.6 : 0.4, 'schema', (onHome ?? lodgingSchema[0]!).url);
  }
  if (allForms.some((f) => f.purpose === 'booking' && f.fields.some((x) => /check-?in|arrival/i.test(x.name)))) add('lodging', 'formë rezervimi me check-in/check-out', 0.4, 'html');
  if (kinds('rooms').length) add('lodging', `faqe dhomash: ${kinds('rooms')[0]!.url}`, 0.3, 'url');
  // Restaurant
  const foodSchema = allTypes(FOOD_SCHEMA);
  if (foodSchema.length) add('restaurant', `JSON-LD ${foodSchema[0]!.page.business.jsonLd.types.find((t) => FOOD_SCHEMA.test(t))}`, foodSchema.some((p) => p.isHome) ? 0.6 : 0.45, 'schema', foodSchema[0]!.url);
  if (kinds('menu').length) add('restaurant', `faqe menuje: ${kinds('menu')[0]!.url}`, 0.35, 'url');
  if (allForms.some((f) => f.purpose === 'booking' && f.fields.some((x) => /time|party|persons|guests-count|rtb-party/i.test(x.name)) && !f.fields.some((x) => /check-?in/i.test(x.name)))) add('restaurant', 'formë rezervimi tavoline (orë + persona)', 0.35, 'html');
  const tableCta = pages.flatMap((p) => p.page.business.ctas).find((c) => /\btable\b|tavolin/i.test(c.text));
  if (tableCta) add('restaurant', `CTA "${tableCta.text}"`, 0.3, 'html');
  // E-commerce
  const products = allTypes(/^(Product|Offer|AggregateOffer)$/);
  if (products.length) add('ecommerce', `JSON-LD Product në ${products.length} faqe`, products.length >= 3 ? 0.45 : 0.3, 'schema', products[0]!.url);
  if (input.tech.ecommerce) add('ecommerce', `${input.tech.ecommerce.name}`, 0.35, 'html');
  if (input.discoveredUrls.some((u) => /\/(cart|basket|checkout|shporta)\/?$/i.test(u))) add('ecommerce', 'URL shporte/checkout (e pavizituar)', 0.25, 'crawl');
  // Blog
  const articles = pages.filter((p) => p.page.business.jsonLd.types.some((t) => ARTICLE_SCHEMA.test(t)) || p.page.business.ogType === 'article');
  if (articles.length >= 3) add('blog', `${articles.length} faqe artikujsh (Article/og:type)`, 0.45, 'schema');
  if (kinds('blog-post').length >= 3) add('blog', `${kinds('blog-post').length} faqe blog/journal`, 0.3, 'url');
  // Biznes lokal i përgjithshëm
  const local = allTypes(LOCAL_SCHEMA);
  if (local.length) add('local-business', `JSON-LD ${local[0]!.page.business.jsonLd.types.find((t) => LOCAL_SCHEMA.test(t))}`, 0.5, 'schema', local[0]!.url);
  if (home?.page.business.contact.addresses.length && home.page.business.contact.phones.length) add('local-business', 'adresë + telefon në faqen hyrëse', 0.3, 'html', home.url);

  const ranked = rank(found);
  // Biznes lokal i përgjithshëm s'duhet të mbulojë një tip më specifik me prova të ngjashme.
  const specific = ranked.filter((r) => r.name !== 'local-business');
  const top = specific[0] && specific[0].confidence >= (ranked[0]?.confidence ?? 0) - 0.1 ? specific[0] : ranked[0];
  const primary = top && top.confidence >= MIN_CONFIDENCE ? top : undefined;

  const capabilities: string[] = [];
  const cap = (c: string, ok: boolean) => ok && capabilities.push(c);
  cap('booking', allForms.some((f) => f.purpose === 'booking') || pages.some((p) => p.page.business.iframes.some((f) => f.kind === 'booking')) || kinds('booking').length > 0);
  cap('menu', kinds('menu').length > 0);
  cap('contact', pages.some((p) => p.page.business.contact.phones.length || p.page.business.contact.emails.length) || allForms.some((f) => f.purpose === 'contact'));
  cap('blog', articles.length > 0 || kinds('blog-index').length > 0);
  cap('shop', products.length > 0 || !!input.tech.ecommerce);
  cap('newsletter', allForms.some((f) => f.purpose === 'newsletter'));
  const languages = [...new Set(pages.map((p) => p.page.lang?.toLowerCase().slice(0, 2)).filter((l): l is string => !!l))].sort();
  cap('multilingual', languages.length > 1);

  return {
    site: {
      type: (primary?.name as SiteType | undefined) ?? 'unknown',
      confidence: primary?.confidence ?? ranked[0]?.confidence ?? 0,
      signals: primary?.signals ?? ranked[0]?.signals ?? [],
      mixedWith: primary ? (ranked.find((r) => r !== primary && r.name !== 'local-business' && primary.confidence - r.confidence <= 0.05)?.name as SiteType | undefined) : undefined,
      alternatives: ranked.filter((r) => r !== primary && r.confidence >= 0.4).map((r) => ({ type: r.name as SiteType, confidence: r.confidence })),
      capabilities,
      languages,
    },
    pages: classified,
  };
}

export { combine };
