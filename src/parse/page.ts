import * as cheerio from 'cheerio';
import { extractBusinessSignals, type BusinessSignals } from './business.js';
import { accessibleName, entityContext, type NameSource } from './context.js';
import { parseHtml, parseXRobotsTag, snippet, type ParsedHtml } from './html.js';

export interface GenericLink {
  /** Teksti i dukshëm. */
  text: string;
  /** Emri i aksesueshëm dhe burimi i tij (teksti, aria-label…). */
  name: string;
  nameSource: NameSource;
  href?: string;
  region: 'header' | 'footer' | 'main';
  /** Titulli/teksti i kartës ose koka e kolonës që e dallon; mungon kur s'gjendet. */
  context?: string;
}

export interface PageLink {
  /** URL absolute (pa #fragment); linket jo-http(s) s'ruhen. */
  url: string;
  text: string;
  rel: string;
}

export interface PageData extends ParsedHtml {
  links: PageLink[];
  hreflang: { lang: string; href: string; resolved: string | null; snippet: string }[];
  headings: { level: number; text: string }[];
  images: { total: number; missingAlt: { src: string; snippet: string }[] };
  /** Teksti kryesor pa nav/header/footer/aside/script, për numër fjalësh dhe ngjashmëri. */
  mainText: string;
  wordCount: number;
  /** src e iframe-ve (maks. 5): përmbajtja mund të jetë brenda tyre. */
  iframes: string[];
  noindex: boolean;
  /**
   * Cloudflare Email Address Obfuscation: linket /cdn-cgi/l/email-protection#<hex> që skripti
   * email-decode.min.js i kthen në mailto: në browser. S'janë faqe — s'futen te `links`.
   */
  cfEmailLinks: { count: number; decoderScript: boolean; sample?: string };
  /** Sinjale biznesi/privatësie nga HTML-ja statike (MVP-3). */
  business: BusinessSignals;
  /**
   * Blloqe teksti të përmbajtjes kryesore (p, li, h2–h4, blockquote…), pa header/nav/footer/aside/form,
   * për krahasim mes faqeve (cilësia e përmbajtjes). Vetëm blloqe me ≥ 6 fjalë, unikë brenda faqes.
   */
  contentBlocks: { tag: string; text: string }[];
  /** Linke/butona me tekst të përgjithshëm ("Read more", "Mëso më shumë"…), me rajonin. */
  /** Linke/butona me tekst të përgjithshëm, me emrin e aksesueshëm dhe kontekstin dallues (titulli i kartës…). */
  genericLinks: GenericLink[];
  /** Identifikues i template-it (klasat e body pa ID, ose skeleti i DOM-it), për grupimin e issue-ve. */
  templateKey: string;
}

/** Tekst linku që s'thotë ku të çon (EN/SQ/IT/DE). */
const GENERIC_LINK_TEXT = /^(read more|learn more|more|click here|here|see more|discover more|find out more|view more|details|lexo më shumë|mëso më shumë|më shumë|kliko këtu|këtu|shiko më shumë|zbulo më shumë|detaje|scopri di più|leggi di più|mehr erfahren|weiterlesen)[\s.…→›»>]*$/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Hash i shkurtër, deterministik (FNV-1a 32-bit) — për çelësa, jo për siguri. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function templateKeyOf($: cheerio.CheerioAPI): string {
  const classes = ($('body').attr('class') ?? '')
    .split(/\s+/)
    .filter((c) => c && !/\d/.test(c))
    .sort();
  if (classes.length) return `body:${classes.join(' ').slice(0, 120)}`;
  const skeleton = $('body')
    .children()
    .slice(0, 30)
    .map((_, el) => {
      const cls = ($(el).attr('class') ?? '').split(/\s+/).filter((c) => c && !/\d/.test(c)).slice(0, 2).join('.');
      return `${(el as { tagName?: string }).tagName ?? '?'}${cls ? `.${cls}` : ''}`;
    })
    .get()
    .join('>');
  return `dom:${fnv1a(skeleton)}`;
}

const CF_EMAIL_PATH = /^\/cdn-cgi\/l\/email-protection\/?$/;

/** Dekodon formatin e Cloudflare (bajti i parë = çelësi XOR); null kur s'del adresë email. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : null;
}

export function parsePage(html: string, pageUrl: string, xRobotsTag?: string): PageData {
  const base = parseHtml(html, pageUrl);
  const $ = cheerio.load(html);
  const baseUrl = base.baseHref ? (() => { try { return new URL(base.baseHref!, pageUrl).href; } catch { return pageUrl; } })() : pageUrl;

  const links: PageLink[] = [];
  let cfEmailCount = 0;
  let cfEmailSample: string | undefined;
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || /^(mailto|tel|javascript|data|sms|whatsapp):/i.test(href) || href.startsWith('#')) return;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    // Email i fshehur nga Cloudflare: vetëm kur të dhënat dekodohen realisht në adresë email
    // (në href#hex ose në <span data-cfemail>); përndryshe trajtohet si link i zakonshëm.
    if (CF_EMAIL_PATH.test(abs.pathname)) {
      const encoded = [abs.hash.slice(1), $(el).attr('data-cfemail') ?? '', ...$(el).find('[data-cfemail]').map((_, x) => $(x).attr('data-cfemail') ?? '').get()];
      if (encoded.some((h) => decodeCfEmail(h))) {
        cfEmailCount++;
        cfEmailSample ??= href;
        return;
      }
    }
    abs.hash = '';
    links.push({ url: abs.href, text: clean($(el).text()).slice(0, 80) || clean($(el).attr('aria-label') ?? $(el).find('img').attr('alt') ?? '').slice(0, 80), rel: ($(el).attr('rel') ?? '').toLowerCase() });
  });

  const hreflang = $('link[rel="alternate"][hreflang]')
    .map((_, el) => {
      const href = ($(el).attr('href') ?? '').trim();
      let resolved: string | null = null;
      try {
        resolved = href ? new URL(href, baseUrl).href : null;
      } catch {
        resolved = null;
      }
      return { lang: ($(el).attr('hreflang') ?? '').trim(), href, resolved, snippet: snippet($.html(el)) };
    })
    .get();

  const headings = $('h1, h2, h3, h4, h5, h6')
    .map((_, el) => ({ level: Number((el as { tagName: string }).tagName.slice(1)), text: clean($(el).text()).slice(0, 80) }))
    .get();

  const imgs = $('img');
  const missingAlt = imgs
    .filter((_, el) => $(el).attr('alt') === undefined) // alt="" është i vlefshëm (imazh dekorativ)
    .map((_, el) => ({ src: $(el).attr('src') ?? $(el).attr('data-src') ?? '', snippet: snippet($.html(el)) }))
    .get();

  const templateKey = templateKeyOf($);
  const cfDecoder = $('script[src*="/cdn-cgi/scripts/"][src*="email-decode"]').length > 0;

  // MVP-3: para heqjes së script/iframe/footer (tracker-at, CMP-të dhe linket e politikave janë aty).
  const business = extractBusinessSignals($, pageUrl, baseUrl, fnv1a);

  // Tekste linkesh të përgjithshme, me rajonin (para heqjes së header/footer).
  const genericLinks: PageData['genericLinks'] = [];
  $('a, button').each((_, el) => {
    const t = clean($(el).text());
    if (!GENERIC_LINK_TEXT.test(t) || genericLinks.length >= 100) return;
    // Emri i aksesueshëm përshkrues (aria-label, aria-labelledby) e zgjidh paqartësinë: s'ka ç'të raportohet.
    const acc = accessibleName($, el);
    if (acc.name && !GENERIC_LINK_TEXT.test(acc.name)) return;
    const region = $(el).closest('footer, [role="contentinfo"]').length ? 'footer' : $(el).closest('header, nav, [role="banner"], [role="navigation"]').length ? 'header' : 'main';
    const context = entityContext($, el, (x) => x.toLowerCase() === t.toLowerCase());
    genericLinks.push({ text: t, name: acc.name || t, nameSource: acc.source, href: $(el).attr('href') ?? undefined, region, ...(context ? { context } : {}) });
  });

  // iframe-t regjistrohen para heqjes: përmbajtja mund të jetë brenda tyre (p.sh. menu e jashtme).
  const iframes = $('iframe[src]').map((_, el) => $(el).attr('src') ?? '').get().filter(Boolean).slice(0, 5);

  // Teksti kryesor: hiq pjesët e template-it dhe jo-përmbajtjen.
  $('script, style, noscript, template, svg, iframe, header, nav, footer, aside, form').remove();
  const words = (t: string) => (t ? t.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length : 0);
  const bodyText = clean($('body').text());
  const bodyWords = words(bodyText);
  // <main>/<article> vetëm kur mbajnë pjesën kryesore të tekstit: te disa theme (p.sh. Divi)
  // <article> është mbështjellës bosh dhe përmbajtja është jashtë tij.
  const candidates = [$('main').first(), ...$('article').toArray().map((el) => $(el))]
    .map((c) => ({ text: clean(c.text()) }))
    .map((c) => ({ ...c, words: words(c.text) }))
    .sort((a, b) => b.words - a.words);
  const best = candidates.find((c) => c.words >= Math.max(50, bodyWords * 0.3));
  const mainText = best ? best.text : bodyText;
  // Blloqet e përmbajtjes kryesore (template-i header/nav/footer/aside është hequr më lart).
  const contentBlocks: PageData['contentBlocks'] = [];
  const seenBlocks = new Set<string>();
  $('body').find('p, li, h2, h3, h4, blockquote, dd, figcaption').each((_, el) => {
    if ($(el).find('p, li').length) return; // vetëm blloqe "gjethe", që teksti të mos numërohet dy herë
    const text = clean($(el).text());
    if (words(text) < 6 || seenBlocks.has(text) || contentBlocks.length >= 300) return;
    seenBlocks.add(text);
    contentBlocks.push({ tag: (el as { tagName?: string }).tagName ?? 'p', text: text.slice(0, 600) });
  });
  const wordCount = best ? best.words : bodyWords;

  const metaNoindex = base.robotsMeta.some((m) => m.content.split(',').map((d) => d.trim()).some((d) => d === 'noindex' || d === 'none'));
  const headerNoindex = parseXRobotsTag(xRobotsTag).some((d) => d === 'noindex' || d === 'none');

  return {
    ...base,
    links,
    hreflang,
    headings,
    images: { total: imgs.length, missingAlt },
    mainText,
    wordCount,
    iframes,
    noindex: metaNoindex || headerNoindex,
    business,
    contentBlocks,
    genericLinks,
    cfEmailLinks: { count: cfEmailCount, decoderScript: cfDecoder, sample: cfEmailSample },
    templateKey,
  };
}
