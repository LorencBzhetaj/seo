import type { AuditContext } from '../../core/context.js';
import type { AuditResult } from '../../core/schemas.js';
import type { DetectionPage } from '../../detection/page-type.js';
import type { FormSignal } from '../../parse/business.js';
import { crawlCoverage } from '../site/common.js';

/** Arsyeja kur s'ka HTML të faqes reale (bllokim, gabim), ose undefined. */
export function businessUnavailable(ctx: AuditContext): string | undefined {
  if (ctx.main.status !== 'ok') return 'Faqja hyrëse s\'u arrit';
  if (ctx.access.state !== 'ok') return `HTML-ja reale s'u mor (${ctx.access.summary})`;
  return undefined;
}

/**
 * Mbulimi: faqet me HTML të analizuar. Pa crawl (--no-crawl ose crawl i dështuar) vetëm faqja hyrëse →
 * partial; me crawl të cunguar nga kufijtë → partial, si te MVP-2.
 */
export function businessCoverage(ctx: AuditContext, pages: DetectionPage[]): AuditResult['coverage'] {
  if (ctx.crawl.status !== 'ok') return { checked: pages.length, discovered: pages.length, truncated: true };
  return crawlCoverage(ctx.crawl.value, pages.length);
}

export function scopeLimitation(ctx: AuditContext, module: string): string | undefined {
  if (ctx.crawl.status === 'ok') return undefined;
  return `${module}: vetëm faqja hyrëse — crawl-i s'u krye (${ctx.crawl.status === 'skipped' ? ctx.crawl.reason : ctx.crawl.error}); gjetjet s'vlejnë për gjithë sitin.`;
}

/**
 * Një komponent formulari (sipas identitetit të qëndrueshëm: id/klasat + action + fushat) raportohet
 * një herë, me numrin e faqeve ku shfaqet — jo si 78 formularë të ndryshëm.
 */
export function distinctForms(pages: DetectionPage[]): { form: FormSignal; urls: string[] }[] {
  const by = new Map<string, { form: FormSignal; urls: string[] }>();
  for (const p of pages) {
    for (const f of p.page.business.forms) {
      const e = by.get(f.identity);
      if (e) {
        if (!e.urls.includes(p.url)) e.urls.push(p.url);
      } else by.set(f.identity, { form: f, urls: [p.url] });
    }
  }
  return [...by.values()];
}

/** "1 formular i përsëritur në 78 faqe (i njëjti komponent)" ose "1 faqe". */
export function formOccurrence(urls: string[]): string {
  return urls.length > 1 ? `1 formular i përsëritur në ${urls.length} faqe (i njëjti komponent)` : '1 faqe';
}

/** Action-i pa query dhe me shteg të shkurtuar (disa shërbime vendosin token në URL). */
export function shortAction(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname.length > 24 ? `${x.pathname.slice(0, 24)}…` : x.pathname;
    return `${x.host}${path}`;
  } catch {
    return u.slice(0, 40);
  }
}

/** Inventari i formularëve për raportin JSON: identiteti, qëllimi, fushat dhe në sa faqe shfaqet. */
export function formInventory(pages: DetectionPage[]) {
  return distinctForms(pages).map(({ form, urls }) => ({
    identity: form.identity,
    purpose: form.purpose,
    id: form.id,
    method: form.method,
    submission: form.jsHandled ? 'javascript (pa action)' : form.action ? shortAction(form.action) : 'e njëjta faqe',
    fields: form.fields.map((f) => `${f.type}:${f.name}`),
    honeypotFields: form.honeypotFields,
    initiallyHidden: form.initiallyHidden,
    pageCount: urls.length,
    repeated: urls.length > 1,
    sampleUrls: urls.slice(0, 5),
  }));
}

/**
 * Çfarë mbulon score-i i Conversion: vetëm sinjalet në HTML statik. Shfaqet pranë score-it
 * në terminal dhe JSON, që 100 të mos lexohet si provë se rrjedha e konvertimit funksionon.
 */
export const CONVERSION_SCORE_SCOPE = 'Pikët vlejnë vetëm për sinjalet e kontrolluara në HTML statik (CTA, kontakt, struktura e formularëve, dëshmi besimi) — jo provë se rrjedha e konvertimit funksionon.';
export const CONVERSION_NOT_TESTED = [
  'rezervimi / blerja nga fillimi në fund',
  'dërgimi i formularëve (SAFE mode: asnjë submit), validimi dhe mesazhet e gabimit',
  'pozicioni real i CTA-ve në viewport (above the fold)',
  'përmbajtja e iframe-ve ndër-domain',
  'elementet që shfaqen vetëm pas JavaScript-it',
];

export const FORM_PURPOSE_LABELS: Record<FormSignal['purpose'], string> = {
  search: 'kërkim', filter: 'filtër/renditje', login: 'hyrje (login)', newsletter: 'newsletter', booking: 'rezervim', order: 'porosi', comment: 'koment', contact: 'kontakt', other: 'tjetër',
};

export function listUrls(urls: string[], n = 3): string {
  return `${urls.slice(0, n).join(', ')}${urls.length > n ? ` … +${urls.length - n}` : ''}`;
}
