import * as cheerio from 'cheerio';

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  lastmodValid?: boolean;
}

export interface ParsedSitemap {
  kind: 'urlset' | 'index' | 'invalid';
  entries: SitemapEntry[];
  /** Arsyeja kur kind = invalid. */
  error?: string;
}

/** W3C Datetime (formati i lejuar për <lastmod>): YYYY, YYYY-MM, YYYY-MM-DD ose me orë dhe zonë. */
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

export function isValidLastmod(v: string): boolean {
  return W3C_DATETIME.test(v) && !Number.isNaN(Date.parse(v.length === 4 ? `${v}-01-01` : v.length === 7 ? `${v}-01` : v));
}

export function parseSitemap(body: string, contentType?: string): ParsedSitemap {
  const text = body.replace(/^﻿/, '').trim();
  if (!text) return { kind: 'invalid', entries: [], error: 'Përgjigje bosh' };
  if (/text\/html/i.test(contentType ?? '') || /^<!doctype html|^<html[\s>]/i.test(text)) {
    return { kind: 'invalid', entries: [], error: 'U kthye HTML në vend të XML (shpesh faqe 404/redirect)' };
  }
  const $ = cheerio.load(text, { xml: true });
  const root = $.root().children().first();
  const name = ((root.get(0) as { tagName?: string; name?: string } | undefined)?.tagName ?? '').toLowerCase().replace(/^.*:/, '');
  if (name !== 'urlset' && name !== 'sitemapindex') {
    return { kind: 'invalid', entries: [], error: `Elementi rrënjë "${name || '?'}" s'është urlset ose sitemapindex` };
  }
  const kind = name === 'urlset' ? 'urlset' : 'index';
  const child = kind === 'urlset' ? 'url' : 'sitemap';
  const entries: SitemapEntry[] = [];
  root.children().each((_, el) => {
    const tag = ((el as { tagName?: string }).tagName ?? '').toLowerCase().replace(/^.*:/, '');
    if (tag !== child) return;
    const kids = $(el).children();
    const pick = (n: string) =>
      kids.filter((_, k) => ((k as { tagName?: string }).tagName ?? '').toLowerCase().replace(/^.*:/, '') === n).first().text().trim();
    const loc = pick('loc');
    if (!loc) return;
    const lastmod = pick('lastmod') || undefined;
    entries.push({ loc, lastmod, lastmodValid: lastmod ? isValidLastmod(lastmod) : undefined });
  });
  return { kind, entries };
}
