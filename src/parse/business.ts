import type * as cheerio from 'cheerio';
import { snippet } from './html.js';

/**
 * Sinjale biznesi dhe privatësie nga HTML-ja STATIKE e një faqeje (MVP-3).
 * Asgjë këtu s'dërgon formularë apo ekzekuton JavaScript: mungesa e një sinjali do të thotë
 * vetëm "s'u gjet në HTML-në e shërbyer", jo "s'ekziston" (mund ta renderojë JS-ja).
 */

export type CtaKind = 'book' | 'contact' | 'call' | 'buy' | 'quote' | 'signup' | 'directions' | 'other';

export interface CtaSignal {
  kind: CtaKind;
  text: string;
  href?: string;
  element: 'a' | 'button' | 'input';
  /** Duket si buton (klasë btn/button/cta ose <button>), jo link i thjeshtë teksti. */
  styled: boolean;
  /** Brenda <header>/<nav> ose <footer>. */
  region: 'header' | 'footer' | 'main';
  /** Radha në DOM mes elementeve të klikueshëm — përafrim, JO pozicion "above the fold". */
  order: number;
  snippet: string;
}

export interface ContactSignals {
  phones: { href: string; digits: string; text: string }[];
  emails: { href: string; obfuscated: boolean }[];
  whatsapp: string[];
  messengers: string[];
  /** Numra telefoni në tekst (format ndërkombëtar) që s'janë link tel:. */
  unlinkedPhones: { text: string; digits: string }[];
  addresses: { source: 'schema' | 'address-tag'; text: string }[];
  mapLinks: string[];
  openingHours: { source: 'schema' | 'text'; value: string }[];
}

/** filter = renditje/filtrim (GET me select/checkbox, p.sh. woocommerce-ordering): s'është formë konvertimi. */
export type FormPurpose = 'search' | 'filter' | 'login' | 'newsletter' | 'booking' | 'order' | 'comment' | 'contact' | 'other';

export interface FormField {
  tag: string;
  type: string;
  name: string;
  required: boolean;
  /** Ka <label>, aria-label/aria-labelledby ose title (placeholder s'mjafton). */
  labelled: boolean;
  autocomplete?: string;
}

export interface FormSignal {
  id?: string;
  action?: string;
  method: string;
  purpose: FormPurpose;
  fields: FormField[];
  hasSubmit: boolean;
  submitText?: string;
  novalidate: boolean;
  captcha?: string;
  consentCheckbox: boolean;
  collectsPersonalData: boolean;
  /** Pa action (ose "#"/javascript:): dërgohet me JavaScript — rruga e dërgimit s'mund të verifikohet statikisht. */
  jsHandled: boolean;
  /** Çelës i strukturës (qëllimi + emrat e fushave) për të bashkuar të njëjtën formë në shumë faqe. */
  signature: string;
  /**
   * Identitet i qëndrueshëm i komponentit: qëllimi + metoda + id + klasat pa numra + action
   * ("self" kur dërgon te vetë faqja, "js" pa action) + fushat. I njëjti komponent në 78 faqe = 1 formular.
   */
  identity: string;
  /** Fusha kurth për bot-ë (tabindex=-1/aria-hidden): s'numërohen si fusha reale. */
  honeypotFields: number;
  /** Forma është e fshehur në HTML (klasë hidden / display:none): mund të shfaqet me JS. */
  initiallyHidden: boolean;
  snippet: string;
}

export type IframeKind = 'map' | 'booking' | 'video' | 'menu' | 'form' | 'social' | 'other';

export interface IframeSignal {
  src: string;
  host: string;
  /** Origjinë tjetër nga faqja: përmbajtja e saj s'kontrollohet. */
  crossOrigin: boolean;
  kind: IframeKind;
  title?: string;
}

export interface TrustSignals {
  aggregateRating?: { ratingValue?: string; reviewCount?: string };
  reviewSchemaCount: number;
  testimonialHints: string[];
  reviewPlatforms: string[];
  socialProfiles: string[];
}

export type TrackerCategory = 'analytics' | 'ads' | 'tag-manager' | 'session-replay';

export interface TrackerSignal {
  name: string;
  category: TrackerCategory;
  id?: string;
  /** Mjete që deklarohen pa cookies (p.sh. Plausible, Cloudflare Web Analytics). */
  cookieless?: boolean;
  evidence: string;
}

export interface PrivacySignals {
  policyLinks: { kind: 'privacy' | 'cookies' | 'terms' | 'imprint'; href: string; text: string }[];
  /** Platforma pëlqimi (CMP) të njohura, ose markup i përgjithshëm banner-i (confidence më e ulët). */
  cmp: { name: string; evidence: string; generic: boolean }[];
  /** gtag('consent', 'default', …) në HTML — Google Consent Mode. */
  consentModeDefault: boolean;
  trackers: TrackerSignal[];
  remoteFonts: string[];
}

export interface JsonLdSummary {
  types: string[];
  openingHours: string[];
  address?: string;
  telephone?: string;
  aggregateRating?: { ratingValue?: string; reviewCount?: string };
  reviewCount: number;
  parseErrors: number;
}

export interface BusinessSignals {
  ctas: CtaSignal[];
  contact: ContactSignals;
  forms: FormSignal[];
  iframes: IframeSignal[];
  trust: TrustSignals;
  privacy: PrivacySignals;
  jsonLd: JsonLdSummary;
  /** Të gjitha <meta name="generator"> (p.sh. WordPress + Divi). */
  generators: string[];
  ogType?: string;
  /** HTML-ja duket e renderuar nga JavaScript (pak tekst + app root): mungesat janë edhe më pak të sigurta. */
  jsRendered: { likely: boolean; reason?: string };
}

const MAX_CTAS = 40;
const MAX_ITEMS = 20;

const CTA_PATTERNS: [CtaKind, RegExp][] = [
  ['book', /\b(book(ing)?|reserve|reservation|rezervo|rezervim\w*|prenota|buchen|check availability|disponueshm\w*)\b/i],
  ['buy', /\b(buy|shop now|add to cart|order( now)?|porosit\w*|bli|blej|purchase|gift cards?)\b/i],
  ['contact', /\b(contact( us)?|kontakt\w*|na kontaktoni|get in touch|na shkruani|message us|write to us|enquire|inquire)\b/i],
  ['call', /\b(call( us| now)?|na telefononi|telefono)\b/i],
  ['quote', /\b(get a quote|request a quote|kërko ofertë|get started)\b/i],
  ['signup', /\b(sign up|subscribe|regjistrohu|abonohu|newsletter|join)\b/i],
  ['directions', /\b(get directions|directions|si të vini|udhëzime|how to get)\b/i],
];
const STYLED = /\b(btn|button|cta)\b|[-_](btn|button|cta)\b|\b(btn|button|cta)[-_]/i;

const CMP_RULES: { name: string; re: RegExp }[] = [
  { name: 'Cookiebot', re: /consent\.cookiebot\.com|CybotCookiebot/i },
  { name: 'OneTrust', re: /cdn\.cookielaw\.org|otSDKStub|onetrust-banner-sdk|optanon/i },
  { name: 'CookieYes', re: /cdn-cookieyes\.com|cky-consent|cookie-law-info|cli-bar/i },
  { name: 'Complianz', re: /complianz|cmplz-cookiebanner/i },
  { name: 'Borlabs Cookie', re: /borlabs-cookie/i },
  { name: 'Cookie Notice (Hu-manity)', re: /id=["']cookie-notice["']|cookie-notice-front/i },
  { name: 'GDPR Cookie Compliance (Moove)', re: /moove[-_]gdpr/i },
  { name: 'Real Cookie Banner', re: /real-cookie-banner/i },
  { name: 'iubenda', re: /cdn\.iubenda\.com|iubenda_cs/i },
  { name: 'Usercentrics', re: /usercentrics\.eu|usercentrics/i },
  { name: 'Termly', re: /app\.termly\.io/i },
  { name: 'Didomi', re: /sdk\.privacy-center\.org|didomi/i },
  { name: 'Quantcast Choice', re: /quantcast\.mgr\.consensu\.org|cmp\.quantcast\.com/i },
  { name: 'TrustArc', re: /consent\.trustarc\.com|truste\.com\/notice/i },
  { name: 'Osano', re: /cmp\.osano\.com/i },
  { name: 'Axeptio', re: /axept\.io|axeptio/i },
  { name: 'CookieFirst', re: /consent\.cookiefirst\.com/i },
  { name: 'Cookie Script', re: /cdn\.cookie-script\.com/i },
  { name: 'Klaro', re: /klaro(\.min)?\.js|klaro-config/i },
  { name: 'Google Funding Choices', re: /fundingchoicesmessages\.google\.com/i },
];
/** Markup i përgjithshëm banner-i (pa CMP të njohur): sinjal më i dobët. */
const GENERIC_BANNER = /(cookie|consent)[-_]?(banner|notice|bar|popup|modal|consent|manager)/i;

const TRACKER_RULES: { name: string; category: TrackerCategory; re: RegExp; id?: RegExp; cookieless?: boolean }[] = [
  { name: 'Google Analytics 4', category: 'analytics', re: /googletagmanager\.com\/gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i, id: /\bG-[A-Z0-9]{4,}\b/ },
  { name: 'Universal Analytics', category: 'analytics', re: /google-analytics\.com\/(analytics|ga)\.js|['"]UA-\d+-\d+['"]/i, id: /\bUA-\d+-\d+\b/ },
  { name: 'Google Ads', category: 'ads', re: /gtag\/js\?id=AW-|['"]AW-\d+['"]/i, id: /\bAW-\d+\b/ },
  { name: 'Google Tag Manager', category: 'tag-manager', re: /googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]{4,}\b/, id: /\bGTM-[A-Z0-9]{4,}\b/ },
  { name: 'Meta Pixel', category: 'ads', re: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init['"]/i },
  { name: 'TikTok Pixel', category: 'ads', re: /analytics\.tiktok\.com/i },
  { name: 'LinkedIn Insight', category: 'ads', re: /snap\.licdn\.com/i },
  { name: 'Pinterest Tag', category: 'ads', re: /s\.pinimg\.com\/ct\/core\.js|pintrk\(/i },
  { name: 'Hotjar', category: 'session-replay', re: /static\.hotjar\.com|hotjar\.com\/c\/hotjar/i },
  { name: 'Microsoft Clarity', category: 'session-replay', re: /clarity\.ms\/tag/i },
  { name: 'Yandex Metrica', category: 'analytics', re: /mc\.yandex\.ru\/metrika/i },
  { name: 'Matomo', category: 'analytics', re: /matomo\.js|piwik\.js|_paq\.push/i },
  { name: 'Plausible', category: 'analytics', re: /plausible\.io\/js/i, cookieless: true },
  { name: 'Cloudflare Web Analytics', category: 'analytics', re: /static\.cloudflareinsights\.com\/beacon/i, cookieless: true },
];

const POLICY_RULES: { kind: PrivacySignals['policyLinks'][number]['kind']; re: RegExp }[] = [
  { kind: 'cookies', re: /cookie/i },
  { kind: 'privacy', re: /privacy|privat[eë]si|privatesise|datenschutz|privacidad|informativa|gdpr|politika-e-privat/i },
  { kind: 'terms', re: /\bterms\b|terms-|kushtet|conditions|agb\b/i },
  { kind: 'imprint', re: /impressum|imprint|legal notice/i },
];

const REVIEW_PLATFORMS: [string, RegExp][] = [
  ['Tripadvisor', /tripadvisor\./i],
  ['Booking.com', /(^|\.)booking\.com/i],
  ['Google (reviews/maps)', /(g\.page|google\.[a-z.]+\/maps|maps\.app\.goo\.gl|search\.google\.com\/local\/reviews)/i],
  ['Trustpilot', /trustpilot\./i],
  ['Yelp', /yelp\./i],
  ['Airbnb', /airbnb\./i],
];
const SOCIAL: [string, RegExp][] = [
  ['Facebook', /(^|\.)facebook\.com$/i],
  ['Instagram', /(^|\.)instagram\.com$/i],
  ['TikTok', /(^|\.)tiktok\.com$/i],
  ['X/Twitter', /(^|\.)(x|twitter)\.com$/i],
  ['LinkedIn', /(^|\.)linkedin\.com$/i],
  ['YouTube', /(^|\.)youtube\.com$/i],
];
const SHARE_PATH = /sharer|share\?|intent\/tweet|shareArticle/i;
const MAP_LINK = /(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|openstreetmap\.org|waze\.com)/i;
/** Telefon në tekst: vetëm format ndërkombëtar (+/00) për të shmangur data, çmime, kode. */
const PHONE_TEXT = /(?:\+|\b00)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g;
const HOURS_TEXT = /(opening hours|orari|orar(i)? i punës|öffnungszeiten|orario|hours:)/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const bareHost = (h: string) => h.replace(/^www\./, '');

function resolve(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

function digitsOf(s: string): string {
  return s.replace(/^tel:/i, '').replace(/[^\d+]/g, '').replace(/^00/, '+');
}

/** Lexon JSON-LD (edhe @graph dhe objekte të mbivendosura), pa u rrëzuar nga JSON i pavlefshëm. */
function readJsonLd($: cheerio.CheerioAPI): JsonLdSummary {
  const out: JsonLdSummary = { types: [], openingHours: [], reviewCount: 0, parseErrors: 0 };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    for (const type of Array.isArray(t) ? t : t ? [t] : []) if (typeof type === 'string' && !out.types.includes(type)) out.types.push(type);
    if (o.openingHours) out.openingHours.push(...(Array.isArray(o.openingHours) ? o.openingHours : [o.openingHours]).map(String));
    if (o.openingHoursSpecification) out.openingHours.push('openingHoursSpecification');
    if (!out.telephone && typeof o.telephone === 'string') out.telephone = o.telephone;
    if (!out.address && o.address && typeof o.address === 'object') {
      const a = o.address as Record<string, unknown>;
      const text = [a.streetAddress, a.addressLocality, a.addressCountry].filter((x) => typeof x === 'string').join(', ');
      if (text) out.address = text;
    } else if (!out.address && typeof o.address === 'string') out.address = o.address;
    if (o.aggregateRating && typeof o.aggregateRating === 'object') {
      const r = o.aggregateRating as Record<string, unknown>;
      out.aggregateRating = { ratingValue: r.ratingValue?.toString(), reviewCount: (r.reviewCount ?? r.ratingCount)?.toString() };
    }
    if (o.review) out.reviewCount += Array.isArray(o.review) ? o.review.length : 1;
    for (const [k, v] of Object.entries(o)) if (k !== '@context' && typeof v === 'object') visit(v, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()), 0);
    } catch {
      out.parseErrors++;
    }
  });
  return out;
}

function regionOf($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): CtaSignal['region'] {
  const $el = $(el);
  if ($el.closest('footer, [role="contentinfo"]').length) return 'footer';
  if ($el.closest('header, nav, [role="banner"], [role="navigation"]').length) return 'header';
  return 'main';
}

function labelledField($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): boolean {
  const $el = $(el);
  if ($el.attr('aria-label')?.trim() || $el.attr('aria-labelledby')?.trim() || $el.attr('title')?.trim()) return true;
  if ($el.closest('label').length) return true;
  const id = $el.attr('id');
  return !!id && $(`label[for="${id.replace(/"/g, '')}"]`).length > 0;
}

/** Action-i si pjesë e identitetit: "js" pa action, "self" kur dërgon te vetë faqja (p.sh. add-to-cart), përndryshe host+path. */
function actionKey(action: string | undefined, base: string, pageUrl: string): string {
  if (!action || /^(#|javascript:)/i.test(action)) return 'js';
  const abs = resolve(action, base);
  if (!abs) return 'invalid';
  try {
    const a = new URL(abs);
    const p = new URL(pageUrl);
    if (a.host === p.host && a.pathname === p.pathname) return 'self';
    return `${a.host}${a.pathname}`;
  } catch {
    return 'invalid';
  }
}

function formPurpose(fields: FormField[], hint: string, method = 'get'): FormPurpose {
  const names = fields.map((f) => `${f.name} ${f.type}`.toLowerCase()).join(' ');
  if (fields.some((f) => f.type === 'password')) return 'login';
  const choiceOnly = fields.length > 0 && fields.every((f) => ['select', 'checkbox', 'radio', 'range'].includes(f.type));
  if (method === 'get' && (choiceOnly || /\b(ordering|orderby|filters?|sort(by)?)\b/.test(hint))) return 'filter';
  if (fields.some((f) => f.type === 'search') || (fields.length <= 2 && /\b(s|q|search|query)\b/.test(fields.map((f) => f.name.toLowerCase()).join(' ')))) return 'search';
  if (/commentform|comment-form/.test(hint) || fields.some((f) => f.name === 'comment')) return 'comment';
  if (/(check-?in|check-?out|arrival|departure|adults|guests|persons|party|date|time)/.test(names) || /(booking|reserv|rezerv)/.test(hint)) return 'booking';
  if (/(quantity|add-to-cart|product_id|variation)/.test(names)) return 'order';
  const onlyContactish = fields.every((f) => f.type === 'email' || /name|emri|consent|gdpr|privacy|checkbox/.test(`${f.name} ${f.type}`.toLowerCase()));
  if (fields.some((f) => f.type === 'email') && onlyContactish && /(newsletter|subscribe|abonohu|mailchimp|list-manage|mc4wp|sibforms|sendinblue|brevo|mailerlite|klaviyo|convertkit)/.test(hint)) return 'newsletter';
  if (fields.some((f) => f.tag === 'textarea') && fields.some((f) => f.type === 'email' || f.type === 'tel')) return 'contact';
  return 'other';
}

export function extractBusinessSignals($: cheerio.CheerioAPI, pageUrl: string, baseUrl: string, fnv: (s: string) => string): BusinessSignals {
  const pageHost = bareHost(hostOf(pageUrl));
  const html = $.html();

  // --- JSON-LD / meta ---
  const jsonLd = readJsonLd($);
  const generators = $('meta[name="generator"]').map((_, el) => ($(el).attr('content') ?? '').trim()).get().filter(Boolean).slice(0, 5);
  const ogType = $('meta[property="og:type"]').first().attr('content')?.trim() || undefined;

  // --- CTA-t dhe kontakti ---
  const ctas: CtaSignal[] = [];
  const contact: ContactSignals = { phones: [], emails: [], whatsapp: [], messengers: [], unlinkedPhones: [], addresses: [], mapLinks: [], openingHours: [] };
  const trust: TrustSignals = { reviewSchemaCount: jsonLd.reviewCount, aggregateRating: jsonLd.aggregateRating, testimonialHints: [], reviewPlatforms: [], socialProfiles: [] };
  const policyLinks: PrivacySignals['policyLinks'] = [];
  let order = 0;
  $('a[href], button, input[type="submit"], input[type="button"]').each((_, el) => {
    order++;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'a';
    const $el = $(el);
    const rawHref = ($el.attr('href') ?? '').trim();
    const text = clean(tag === 'input' ? ($el.attr('value') ?? '') : $el.text() || $el.attr('aria-label') || '').slice(0, 80);
    const abs = rawHref ? resolve(rawHref, baseUrl) : undefined;
    const host = abs ? hostOf(abs) : '';

    if (tag === 'a' && rawHref) {
      if (/^tel:/i.test(rawHref)) {
        if (contact.phones.length < MAX_ITEMS) contact.phones.push({ href: rawHref, digits: digitsOf(rawHref), text });
      } else if (/^mailto:/i.test(rawHref)) {
        if (contact.emails.length < MAX_ITEMS) contact.emails.push({ href: rawHref.split('?')[0]!, obfuscated: false });
      } else if (/\/cdn-cgi\/l\/email-protection/i.test(rawHref)) {
        if (contact.emails.length < MAX_ITEMS) contact.emails.push({ href: '/cdn-cgi/l/email-protection (Cloudflare)', obfuscated: true });
      } else if (/^(whatsapp:)|wa\.me\/|api\.whatsapp\.com|chat\.whatsapp\.com/i.test(rawHref)) {
        if (contact.whatsapp.length < MAX_ITEMS) contact.whatsapp.push(rawHref);
      } else if (/(^viber:)|m\.me\/|t\.me\//i.test(rawHref)) {
        if (contact.messengers.length < MAX_ITEMS) contact.messengers.push(rawHref);
      }
      if (abs && MAP_LINK.test(abs) && contact.mapLinks.length < MAX_ITEMS) contact.mapLinks.push(abs);
      if (abs && host && bareHost(host) !== pageHost) {
        for (const [name, re] of REVIEW_PLATFORMS) if (re.test(abs) && !trust.reviewPlatforms.includes(name)) trust.reviewPlatforms.push(name);
        if (!SHARE_PATH.test(abs)) for (const [name, re] of SOCIAL) if (re.test(host) && !trust.socialProfiles.includes(name)) trust.socialProfiles.push(name);
      }
      // Linket vetëm "#…" (p.sh. href="#book" në faqen e privatësisë) s'janë linke te politika.
      if (abs && !rawHref.startsWith('#') && (!host || bareHost(host) === pageHost)) {
        const probe = `${abs} ${text}`;
        for (const { kind, re } of POLICY_RULES) {
          const bare = abs.split('#')[0]!;
          if (re.test(probe) && !policyLinks.some((p) => p.href === bare)) {
            if (policyLinks.length < MAX_ITEMS) policyLinks.push({ kind, href: bare, text });
            break;
          }
        }
      }
    }

    // CTA: teksti vendos llojin; "styled" = duket si buton
    if (ctas.length >= MAX_CTAS || !text) return;
    const cls = `${$el.attr('class') ?? ''} ${$el.attr('role') ?? ''}`;
    const styled = tag !== 'a' || STYLED.test(cls);
    let kind: CtaKind | undefined;
    if (/^tel:/i.test(rawHref)) kind = 'call';
    else for (const [k, re] of CTA_PATTERNS) if (re.test(text)) { kind = k; break; }
    if (!kind && styled && tag === 'a') kind = 'other';
    if (!kind) return;
    // Butonat brenda formularëve (submit) i mbulon kontrolli i formave.
    if (tag !== 'a' && $el.closest('form').length) return;
    ctas.push({ kind, text, href: abs, element: tag === 'button' ? 'button' : tag === 'input' ? 'input' : 'a', styled, region: regionOf($, el), order, snippet: snippet($.html(el)) });
  });

  // --- Adresë, orar, dëshmi ---
  if (jsonLd.address) contact.addresses.push({ source: 'schema', text: jsonLd.address });
  $('address').slice(0, 3).each((_, el) => {
    const t = clean($(el).text()).slice(0, 120);
    if (t) contact.addresses.push({ source: 'address-tag', text: t });
  });
  for (const h of jsonLd.openingHours.slice(0, 5)) contact.openingHours.push({ source: 'schema', value: h });

  // Tekst i dukshëm (pa script/style) për numra dhe fjalë kyçe; s'e prek $ origjinal.
  const $body = $('body').clone();
  $body.find('script, style, noscript, template, svg').remove();
  // .text() ngjit tekstin e elementeve fqinjë ("4567" + "Footer" → "4567Footer"): hapësirë mes tyre.
  $body.find('*').each((_, el) => {
    $(el).prepend(' ').append(' ');
  });
  const bodyText = clean($body.text());
  const hoursMatch = bodyText.match(HOURS_TEXT);
  if (hoursMatch && contact.openingHours.length === 0) {
    contact.openingHours.push({ source: 'text', value: bodyText.slice(hoursMatch.index ?? 0, (hoursMatch.index ?? 0) + 80) });
  }
  const linkedDigits = new Set(contact.phones.map((p) => p.digits.replace(/^\+/, '')));
  const $noLinks = $body.clone();
  $noLinks.find('a[href^="tel:"], a[href^="TEL:"]').remove();
  const seenPhones = new Set<string>();
  for (const m of clean($noLinks.text()).matchAll(PHONE_TEXT)) {
    const d = digitsOf(m[0]).replace(/^\+/, '');
    if (d.length < 8 || d.length > 15 || seenPhones.has(d)) continue;
    seenPhones.add(d);
    // I njëjti numër është edhe link tel: diku në faqe → s'është mungesë
    if ([...linkedDigits].some((l) => l.endsWith(d.slice(-8)))) continue;
    if (contact.unlinkedPhones.length < 5) contact.unlinkedPhones.push({ text: m[0].trim(), digits: d });
  }

  $('[class*="testimonial" i], [id*="testimonial" i], [class*="review" i], [id*="reviews" i]').slice(0, 5).each((_, el) => {
    const c = ($(el).attr('class') ?? $(el).attr('id') ?? '').slice(0, 60);
    if (c && !trust.testimonialHints.includes(c)) trust.testimonialHints.push(c);
  });
  $('h1, h2, h3').each((_, el) => {
    const t = clean($(el).text());
    if (/(testimonials?|reviews|what (our )?(guests|clients|customers) say|vlerësime|përshtypje|recensioni|bewertungen)/i.test(t) && trust.testimonialHints.length < 8) {
      trust.testimonialHints.push(`titull: "${t.slice(0, 60)}"`);
    }
  });

  // --- Formularët (SAFE: vetëm lexim i strukturës) ---
  const forms: FormSignal[] = [];
  $('form').slice(0, 10).each((_, formEl) => {
    const $f = $(formEl);
    const fields: FormField[] = [];
    let honeypotFields = 0;
    $f.find('input, select, textarea').each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'input';
      const type = tag === 'input' ? ($(el).attr('type') ?? 'text').toLowerCase() : tag;
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
      const hp = `${$(el).attr('class') ?? ''} ${$(el).attr('name') ?? ''} ${$(el).parent().attr('class') ?? ''}`;
      if ($(el).attr('tabindex') === '-1' && ($(el).attr('aria-hidden') === 'true' || /(^|[-_\s])(hp|honeypot|hpot|gotcha)([-_\s]|$)/i.test(hp))) {
        honeypotFields++;
        return;
      }
      fields.push({
        tag, type, name: ($(el).attr('name') ?? $(el).attr('id') ?? '').slice(0, 40),
        required: $(el).is('[required], [aria-required="true"]'),
        labelled: labelledField($, el),
        autocomplete: $(el).attr('autocomplete') ?? undefined,
      });
    });
    const submit = $f.find('button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"]').first();
    const actionAttr = $f.attr('action')?.trim();
    // Tekst nga elementet e brendshme me hapësirë mes tyre (butona dygjuhësh me <span> për çdo gjuhë).
    const submitLabel = submit.length ? clean((submit.html() ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') || submit.attr('value') || '') : '';
    const hint = `${$f.attr('id') ?? ''} ${$f.attr('class') ?? ''} ${actionAttr ?? ''} ${submitLabel}`.toLowerCase();
    const purpose = formPurpose(fields, hint, ($f.attr('method') ?? 'get').toLowerCase());
    const formHtml = $.html(formEl);
    const captcha = /g-recaptcha|recaptcha\/api/i.test(formHtml) ? 'reCAPTCHA' : /recaptcha\/api\.js/i.test(html) ? 'reCAPTCHA (skript në faqe)'
      : /h-captcha|hcaptcha/i.test(formHtml) ? 'hCaptcha'
        : /cf-turnstile/i.test(formHtml) ? 'Cloudflare Turnstile' : undefined;
    const consentCheckbox = $f.find('input[type="checkbox"]').toArray().some((cb) => {
      const t = clean($(cb).closest('label').text() || $(cb).parent().text());
      return /(privacy|privat|consent|pëlqim|gdpr|agree|pajtohem|accept|terms|kushtet)/i.test(t);
    });
    forms.push({
      id: $f.attr('id') || undefined,
      action: actionAttr && !/^(#|javascript:)/i.test(actionAttr) ? resolve(actionAttr, baseUrl) : undefined,
      method: ($f.attr('method') ?? 'get').toLowerCase(),
      purpose,
      fields,
      hasSubmit: submit.length > 0,
      submitText: submitLabel ? submitLabel.slice(0, 40) : undefined,
      novalidate: $f.is('[novalidate]'),
      captcha,
      consentCheckbox,
      collectsPersonalData: fields.some((f) => f.type === 'email' || f.type === 'tel' || /(^|_|-)(name|emri|email|phone|tel|mobile|surname|mbiemri)($|_|-)/i.test(f.name)),
      jsHandled: !actionAttr || /^(#|javascript:)/i.test(actionAttr),
      honeypotFields,
      initiallyHidden: /(^|[-_\s])hidden([-_\s]|$)/i.test($f.attr('class') ?? '') || /display\s*:\s*none/i.test($f.attr('style') ?? '') || $f.is('[hidden]'),
      identity: fnv([
        purpose,
        ($f.attr('method') ?? 'get').toLowerCase(),
        $f.attr('id') ?? '',
        ($f.attr('class') ?? '').split(/\s+/).filter((c) => c && !/\d/.test(c)).sort().slice(0, 6).join('.'),
        actionKey(actionAttr, baseUrl, pageUrl),
        fields.map((f) => `${f.type}:${f.name}`).sort().join(','),
      ].join('|')),
      signature: fnv(`${purpose}|${fields.map((f) => `${f.type}:${f.name}`).sort().join(',')}`),
      snippet: snippet(formHtml.slice(0, 400)),
    });
  });

  // --- iframe (përmbajtja ndër-domain s'kontrollohet) ---
  const iframes: IframeSignal[] = [];
  $('iframe').slice(0, 10).each((_, el) => {
    const raw = ($(el).attr('src') ?? $(el).attr('data-src') ?? $(el).attr('data-lazy-src') ?? '').trim();
    const src = raw ? resolve(raw, baseUrl) : undefined;
    if (!src || !/^https?:/i.test(src)) return;
    const host = hostOf(src);
    const probe = `${src} ${$(el).attr('title') ?? ''}`;
    const kind: IframeKind = /google\.[a-z.]+\/maps|maps\.google|openstreetmap/i.test(probe) ? 'map'
      : /youtube|youtu\.be|vimeo/i.test(probe) ? 'video'
        : /(book|reserv|rezerv|beds24|cloudbeds|sirvoy|opentable|resdiary|thefork|sevenrooms|checkfront)/i.test(probe) ? 'booking'
          : /menu/i.test(probe) ? 'menu'
            : /(forms\.gle|docs\.google\.com\/forms|typeform|jotform|tally\.so)/i.test(probe) ? 'form'
              : /(facebook|instagram|twitter|tiktok)/i.test(probe) ? 'social' : 'other';
    iframes.push({ src, host, crossOrigin: bareHost(host) !== pageHost, kind, title: $(el).attr('title') || undefined });
  });

  // --- Privatësia: CMP, Consent Mode, tracker-a, fonte të largëta (vetëm në HTML statik) ---
  const cmp: PrivacySignals['cmp'] = [];
  for (const r of CMP_RULES) {
    const m = html.match(r.re);
    if (m) cmp.push({ name: r.name, evidence: m[0].slice(0, 80), generic: false });
  }
  if (!cmp.length) {
    const el = $('[id], [class]').toArray().find((e) => GENERIC_BANNER.test(`${$(e).attr('id') ?? ''} ${$(e).attr('class') ?? ''}`));
    if (el) cmp.push({ name: 'banner i përgjithshëm (pa CMP të njohur)', evidence: snippet($.html(el)).slice(0, 120), generic: true });
  }
  const scriptsText = $('script').toArray().map((s) => `${$(s).attr('src') ?? ''}\n${$(s).html() ?? ''}`).join('\n');
  const trackers: TrackerSignal[] = [];
  for (const r of TRACKER_RULES) {
    const m = scriptsText.match(r.re);
    if (!m) continue;
    const id = r.id ? scriptsText.match(r.id)?.[0] : undefined;
    trackers.push({ name: r.name, category: r.category, id, cookieless: r.cookieless, evidence: m[0].slice(0, 100) });
  }
  const remoteFonts = $('link[rel~="stylesheet"][href*="fonts.googleapis.com"], link[rel~="stylesheet"][href*="use.typekit.net"]')
    .map((_, el) => $(el).attr('href') ?? '').get().filter(Boolean).slice(0, 5);

  // --- A është HTML e renderuar nga JS? ---
  const words = bodyText ? bodyText.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length : 0;
  const appRoot = $('#root, #app, #__next, #__nuxt, [data-reactroot], [ng-app], [ng-version]').length > 0;
  const scriptCount = $('script').length;
  const jsRendered = words < 50 && (appRoot || scriptCount >= 3)
    ? { likely: true, reason: `${words} fjalë në HTML statik${appRoot ? ', app root (React/Vue/Next/Nuxt/Angular)' : ''}, ${scriptCount} script` }
    : { likely: false };

  return {
    ctas,
    contact,
    forms,
    iframes,
    trust,
    privacy: {
      policyLinks,
      cmp,
      consentModeDefault: /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]/.test(scriptsText),
      trackers,
      remoteFonts,
    },
    jsonLd,
    generators,
    ogType,
    jsRendered,
  };
}
