import * as cheerio from 'cheerio';
import { parseHtml, parseXRobotsTag, snippet, type ParsedHtml } from './html.js';

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
  /** Identifikues i template-it (klasat e body pa ID, ose skeleti i DOM-it), për grupimin e issue-ve. */
  templateKey: string;
}

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

export function parsePage(html: string, pageUrl: string, xRobotsTag?: string): PageData {
  const base = parseHtml(html, pageUrl);
  const $ = cheerio.load(html);
  const baseUrl = base.baseHref ? (() => { try { return new URL(base.baseHref!, pageUrl).href; } catch { return pageUrl; } })() : pageUrl;

  const links: PageLink[] = [];
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
    templateKey,
  };
}
