import * as cheerio from 'cheerio';

export interface MixedContentRef {
  tag: string;
  attr: string;
  url: string;
  /** Script/stylesheet/iframe bllokohen nga browser-i; imazhet/media zakonisht auto-upgrade. */
  active: boolean;
  snippet: string;
}

export interface ParsedHtml {
  titles: string[];
  titleSnippet?: string;
  metaDescriptions: string[];
  h1s: string[];
  h1Snippets: string[];
  canonicals: { href: string; resolved: string | null; snippet: string }[];
  robotsMeta: { name: string; content: string; snippet: string }[];
  lang?: string;
  viewport?: string;
  baseHref?: string;
  forms: { count: number; postCount: number; hasPasswordInput: boolean; insecureActions: string[] };
  mixedContent: MixedContentRef[];
}

const SNIPPET_MAX = 300;

export function snippet(html: string | null | undefined): string {
  const s = (html ?? '').replace(/\s+/g, ' ').trim();
  return s.length > SNIPPET_MAX ? `${s.slice(0, SNIPPET_MAX)}…` : s;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function parseHtml(html: string, pageUrl: string): ParsedHtml {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href');
  const base = baseHref ? (resolve(baseHref, pageUrl) ?? pageUrl) : pageUrl;
  const outer = (el: Parameters<typeof $>[0]) => snippet($.html(el));

  // Vetëm <title> jashtë <svg> (SVG lejon <title> si etiketë aksesueshmërie).
  const titleEls = $('title').filter((_, el) => $(el).parents('svg').length === 0);

  const canonicals = $('link[rel]')
    .filter((_, el) => ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((_, el) => {
      const href = ($(el).attr('href') ?? '').trim();
      return { href, resolved: href ? resolve(href, base) : null, snippet: outer(el) };
    })
    .get();

  const robotsMeta = $('meta[name]')
    .filter((_, el) => /^(robots|googlebot)$/i.test($(el).attr('name') ?? ''))
    .map((_, el) => ({
      name: ($(el).attr('name') ?? '').toLowerCase(),
      content: ($(el).attr('content') ?? '').toLowerCase(),
      snippet: outer(el),
    }))
    .get();

  const mixedContent: MixedContentRef[] = [];
  if (pageUrl.startsWith('https:')) {
    const candidates: [string, string, boolean][] = [
      ['script[src]', 'src', true],
      ['link[href]', 'href', true],
      ['iframe[src]', 'src', true],
      ['img[src]', 'src', false],
      ['source[src]', 'src', false],
      ['video[src]', 'src', false],
      ['audio[src]', 'src', false],
    ];
    for (const [selector, attr, active] of candidates) {
      $(selector).each((_, el) => {
        if (selector === 'link[href]') {
          const rel = ($(el).attr('rel') ?? '').toLowerCase();
          if (!/stylesheet|preload|modulepreload|icon/.test(rel)) return;
        }
        const raw = ($(el).attr(attr) ?? '').trim();
        const abs = resolve(raw, base);
        if (abs?.startsWith('http:')) {
          mixedContent.push({ tag: selector.split('[')[0]!, attr, url: abs, active, snippet: outer(el) });
        }
      });
    }
  }

  const insecureActions = $('form[action]')
    .map((_, el) => resolve(($(el).attr('action') ?? '').trim(), base))
    .get()
    .filter((u): u is string => !!u && pageUrl.startsWith('https:') && u.startsWith('http:'));

  const h1Els = $('h1');
  return {
    titles: titleEls.map((_, el) => clean($(el).text())).get(),
    titleSnippet: titleEls.length ? outer(titleEls.get(0)!) : undefined,
    metaDescriptions: $('meta[name]')
      .filter((_, el) => ($(el).attr('name') ?? '').toLowerCase() === 'description')
      .map((_, el) => clean($(el).attr('content') ?? ''))
      .get(),
    h1s: h1Els.map((_, el) => clean($(el).text())).get(),
    h1Snippets: h1Els.slice(0, 3).map((_, el) => outer(el)).get(),
    canonicals,
    robotsMeta,
    lang: $('html').attr('lang')?.trim() || undefined,
    viewport: $('meta[name="viewport"]').attr('content') || undefined,
    baseHref,
    forms: {
      count: $('form').length,
      postCount: $('form').filter((_, el) => ($(el).attr('method') ?? '').toLowerCase() === 'post').length,
      hasPasswordInput: $('input[type="password"]').length > 0,
      insecureActions,
    },
    mixedContent,
  };
}

/** Direktivat e robots nga meta dhe X-Robots-Tag, të filtruara për crawler-a të përgjithshëm/Google. */
export function parseXRobotsTag(value: string | undefined): string[] {
  if (!value) return [];
  // Format: "noindex, nofollow" ose "googlebot: noindex, nofollow" ose "otherbot: noindex".
  let v = value.trim().toLowerCase();
  const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(v);
  if (m && m[1] !== 'unavailable_after') {
    if (m[1] !== 'googlebot') return [];
    v = m[2]!;
  }
  return v.split(',').map((d) => d.trim()).filter(Boolean);
}
