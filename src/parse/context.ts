import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

type El = Parameters<cheerio.CheerioAPI>[0];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const BLOCK = new Set(['br', 'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'tr', 'section', 'article', 'header', 'footer', 'figcaption']);

/** Teksti me hapësirë te <br> dhe elementet bllok ("Intake<br>and integrations" → "Intake and integrations"). */
function readableText(node: AnyNode): string {
  const walk = (n: AnyNode): string => {
    if (n.type === 'text') return (n as unknown as { data: string }).data;
    if (n.type === 'script' || n.type === 'style' || n.type === 'comment') return '';
    const name = (n as unknown as { name?: string }).name?.toLowerCase() ?? '';
    const inner = ((n as unknown as { children?: AnyNode[] }).children ?? []).map(walk).join('');
    return BLOCK.has(name) ? ` ${inner} ` : inner;
  };
  return clean(walk(node));
}

export type NameSource = 'aria-labelledby' | 'aria-label' | 'text' | 'img-alt' | 'title' | 'value' | 'none';

/**
 * Emri i aksesueshëm (përafrim i thjeshtuar i accname): aria-labelledby → aria-label → teksti
 * (me alt-in e imazheve) → title. Mjafton për të dalluar "Details" nga "Details: Deluxe Double".
 */
export function accessibleName($: cheerio.CheerioAPI, el: El): { name: string; source: NameSource } {
  const $el = $(el);
  const ids = ($el.attr('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (ids.length) {
    const t = clean(ids.map((id) => $(`[id="${id.replace(/"/g, '')}"]`).first().text()).join(' '));
    if (t) return { name: t, source: 'aria-labelledby' };
  }
  const label = clean($el.attr('aria-label') ?? '');
  if (label) return { name: label, source: 'aria-label' };
  const text = clean($el.text());
  if (text) return { name: text, source: 'text' };
  const alt = clean($el.find('img[alt]').map((_, i) => $(i).attr('alt') ?? '').get().join(' '));
  if (alt) return { name: alt, source: 'img-alt' };
  const title = clean($el.attr('title') ?? '');
  if (title) return { name: title, source: 'title' };
  const value = clean($el.attr('value') ?? '');
  if (value) return { name: value, source: 'value' };
  return { name: '', source: 'none' };
}

/**
 * Konteksti që e identifikon elementin (karta, produkti, plani): paraardhësi më i madh që përmban
 * vetëm këtë element nga grupi i njëjtë (p.sh. vetëm një "Details"), pastaj titulli i tij, teksti
 * pranë, ose koka e kolonës në tabelë. undefined kur s'ka kontekst dallues.
 */
export function entityContext($: cheerio.CheerioAPI, el: El, sameAs: (text: string) => boolean): string | undefined {
  const own = clean($(el).text());
  let best: cheerio.Cheerio<AnyNode> | undefined;
  let cur = $(el).parent();
  for (let depth = 0; depth < 6 && cur.length && !cur.is('body, html, main'); depth++) {
    const same = cur.find('a, button').filter((_, x) => sameAs(clean($(x).text()))).length;
    if (same > 1) break;
    best = cur;
    cur = cur.parent();
  }
  if (best) {
    const h = best.find('h1, h2, h3, h4, h5, h6, [role="heading"]').first();
    const heading = h.length ? readableText(h.get(0)!) : '';
    if (heading) return heading.slice(0, 80);
    const text = clean(readableText(best.get(0)!).replace(own, ' '));
    if (text.length >= 3) return text.slice(0, 80);
  }
  // Tabelë çmimesh/krahasimi: koka e kolonës (plani) ose e rreshtit.
  const cell = $(el).closest('td, th');
  if (cell.length) {
    const row = cell.parent();
    const idx = row.children('td, th').index(cell);
    const head = clean(cell.closest('table').find('tr').first().children('td, th').eq(idx).text().replace(own, ' '));
    if (head.length >= 2) return head.slice(0, 80);
    const rowHead = clean(row.children('th').first().text().replace(own, ' '));
    if (rowHead.length >= 2) return rowHead.slice(0, 80);
  }
  return undefined;
}
