import type { PageData } from '../parse/page.js';
import type { TextPage } from './text.js';

/** PageData (crawl ose skedar HTML) → hyrja e analizës së tekstit. */
export function textPageFrom(id: string, page: PageData, source?: string): TextPage {
  return {
    id,
    lang: page.lang,
    title: page.titles[0],
    h1s: page.h1s,
    mainText: page.mainText,
    wordCount: page.wordCount,
    contentBlocks: page.contentBlocks,
    genericLinks: page.genericLinks,
    ctas: page.business.ctas.map((c) => ({ text: c.text, region: c.region, href: c.href, context: c.context })),
    iframes: page.iframes,
    noindex: page.noindex,
    templateKey: page.templateKey,
    source,
  };
}
