import { describe, expect, it } from 'vitest';
import type { AuditContext } from '../src/core/context.js';
import type { Issue } from '../src/core/schemas.js';
import { runModules, BUSINESS_MODULES, MVP1_MODULES } from '../src/core/run.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { runConversion } from '../src/modules/business/conversion.js';
import { runPrivacy } from '../src/modules/business/privacy.js';
import { computeHealth } from '../src/scoring/scorer.js';
import { lighthouseFixture, makeCtx } from './helpers.js';
import { htmlPage, siteCtx, words } from './site-helpers.js';

const B = 'https://e.com';
const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const code = (r: { issues: Issue[] }, c: string) => r.issues.find((i) => i.code === c);
const allText = (r: ReturnType<typeof runPrivacy>) => JSON.stringify(r);

/** Lighthouse me log rrjeti dhe entitete (third-party-web), pa Chrome. */
function lhWith(requests: { url: string; entity: string; resourceType?: string; statusCode?: number }[], entities: LighthouseData['entities'], cookies: { name: string; url: string }[] = []): LighthouseData {
  const base = lighthouseFixture();
  return {
    ...base,
    entities,
    audits: {
      ...base.audits,
      'network-requests': { id: 'network-requests', title: 'Network Requests', score: null, scoreDisplayMode: 'informative', details: { type: 'table', items: requests.map((r) => ({ networkRequestTime: 1500, statusCode: 200, resourceType: 'Script', ...r })) } },
      'third-party-cookies': { id: 'third-party-cookies', title: 'c', score: 1, scoreDisplayMode: 'binary', details: { type: 'table', items: cookies } },
    },
  };
}
const GA = [
  { url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234', entity: 'Google Tag Manager' },
  { url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-TEST1234&cid=123.456', entity: 'Google Analytics', resourceType: 'Fetch', statusCode: 204 },
  { url: 'https://fonts.googleapis.com/css2?family=Inter', entity: 'Google Fonts', resourceType: 'Stylesheet' },
];
const GA_ENTITIES = [
  { name: 'e.com', isFirstParty: true, origins: ['https://e.com'] },
  { name: 'Google Tag Manager', category: 'tag-manager', origins: ['https://www.googletagmanager.com'] },
  { name: 'Google Analytics', category: 'analytics', origins: ['https://www.google-analytics.com'] },
  { name: 'Google Fonts', category: 'cdn', origins: ['https://fonts.googleapis.com'] },
];
const withLh = (ctx: AuditContext, lh: LighthouseData): AuditContext => ({ ...ctx, lighthouse: { status: 'ok', value: lh } });

describe('Conversion (SAFE, HTML statik)', () => {
  it('faqe pa CTA → issue me confidence të ulët dhe verifikim manual, jo mungesë e sigurt', () => {
    const r = runConversion(makeCtx({ html: htmlPage({ title: 'Kreu', main: `<p>${words('x', 150)}</p>` }) }));
    const i = code(r, 'NO_CTA_IN_STATIC_HTML')!;
    expect(i).toMatchObject({ confidence: 0.5, needsManualReview: true });
    expect(i.evidence[0]!.detected).toMatch(/vetëm HTML-ja statike, pa JavaScript/);
    expect(r.partial).toBe(true); // vetëm faqja hyrëse (pa crawl)
    expect(r.limitations.join(' ')).toMatch(/vetëm faqja hyrëse — crawl-i s'u krye/);
  });

  it('SPA e renderuar me JS pa CTA në HTML → kontrolli skipped, pa issue "mungon CTA"', () => {
    const r = runConversion(makeCtx({ html: '<html><body><div id="__next"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>' }));
    expect(r.checks.find((c) => c.id === 'primary-cta')).toMatchObject({ status: 'skipped' });
    expect(code(r, 'NO_CTA_IN_STATIC_HTML')).toBeUndefined();
    const contact = code(r, 'NO_CLICKABLE_CONTACT')!;
    expect(contact.confidence).toBeLessThanOrEqual(0.3);
    expect(contact.evidence[0]!.detected).toMatch(/renderuar me JavaScript/);
  });

  it('CTA në përmbajtje + tel/mailto → pa issue; numri si tekst → PHONE_NOT_CLICKABLE me provë', () => {
    const r = runConversion(makeCtx({ html: htmlPage({ title: 'K', main: `<a class="btn" href="/book">Rezervo</a><a href="tel:+355671234567">Thirr</a><a href="mailto:a@e.com">Email</a><p>WhatsApp: +39 333 123 4567</p>` }) }));
    expect(code(r, 'NO_CTA_IN_STATIC_HTML')).toBeUndefined();
    expect(code(r, 'NO_CLICKABLE_CONTACT')).toBeUndefined();
    expect(code(r, 'PHONE_NOT_CLICKABLE')!.evidence[0]).toMatchObject({ detected: '"+39 333 123 4567" pa href="tel:"', expected: '<a href="tel:+393331234567">' });
  });

  it('informacioni lokal aktivizohet vetëm kur lloji i sitit e kërkon; confidence trashëgohet', () => {
    const plain = runConversion(makeCtx({ html: htmlPage({ title: 'K', main: '<a class="btn" href="/x">Contact us</a>' }) }));
    expect(plain.checks.find((c) => c.id === 'local-info')).toMatchObject({ status: 'not_applicable' });
    const rest = runConversion(makeCtx({ html: htmlPage({ title: 'K', head: ld({ '@type': 'Restaurant' }), main: '<a class="btn" href="/book">Book a table</a>' }) }));
    const hours = code(rest, 'OPENING_HOURS_NOT_FOUND')!;
    expect(hours.needsManualReview).toBe(true);
    expect(hours.confidence).toBeLessThanOrEqual(0.5);
    expect(code(rest, 'ADDRESS_NOT_FOUND')).toBeDefined();
    expect(rest.checks.find((c) => c.id === 'local-info')!.observations![0]).toMatch(/Aktivizuar nga lloji i sitit: restaurant/);
  });

  it('formularët: e njëjta formë në shumë faqe = një; fushë pa etiketë; honeypot s\'raportohet; asnjë submit', () => {
    const form = '<form id="c"><input type="text" name="email"><label>Mesazhi <textarea name="message"></textarea></label><input name="hp" tabindex="-1" aria-hidden="true"><button>Dërgo</button></form>';
    const ctx = siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'K', main: `<a class="btn" href="/c">Contact</a>${form}` }) },
      { url: `${B}/contact/`, html: htmlPage({ title: 'C', main: form }) },
    ]);
    const r = runConversion(ctx);
    const unl = r.issues.filter((i) => i.code === 'FORM_FIELDS_WITHOUT_LABEL');
    expect(unl).toHaveLength(1);
    expect(unl[0]!.affectedPages).toEqual([`${B}/`, `${B}/contact/`]);
    expect(unl[0]!.evidence[0]!.detected).toBe('<input type="text" name="email">');
    expect(code(r, 'FORM_INPUT_TYPE')!.message).toMatch(/type="email"/);
    const obs = r.checks.find((c) => c.id === 'forms')!.observations!.join(' ');
    expect(obs).toMatch(/1 fushë kurth \(honeypot\) e përjashtuar/);
    expect(obs).toMatch(/SAFE mode: asnjë formë s'u plotësua apo dërgua/);
  });

  it('iframe ndër-domain: shënohet qartë që përmbajtja s\'u kontrollua', () => {
    const r = runConversion(makeCtx({ html: htmlPage({ title: 'K', main: '<a class="btn" href="/b">Book now</a><iframe src="https://booking.other.com/reserve"></iframe>' }) }));
    expect(r.checks.find((c) => c.id === 'cross-origin-iframes')!.observations![0]).toMatch(/^booking: https:\/\/booking\.other\.com\/reserve .*përmbajtja e iframe-it s'u kontrollua/);
    expect(r.limitations.join(' ')).toMatch(/1 iframe ndër-domain \(booking\.other\.com\)/);
  });

  it('faqja e bllokuar (403) → skipped me arsye, jo score', () => {
    const r = runConversion(makeCtx({ main: { status: 'ok', value: { requestedUrl: `${B}/`, finalUrl: `${B}/`, status: 403, statusText: 'Forbidden', headers: {}, body: 'blocked', bodyTruncated: false, bodyBytes: 7, redirects: [], ttfbMs: 1, totalMs: 1, httpVersion: '1.1' } } }));
    expect(r).toMatchObject({ score: null, status: 'skipped' });
  });
});

describe('Privacy (sinjale, jo verdikt ligjor)', () => {
  const page = (main: string, head = '') => htmlPage({ title: 'K', head, main, extra: '<footer><a href="/privacy/">Privacy Policy</a></footer>' });

  it('tracker-a në ngarkim pa CMP → sinjal për shqyrtim, pa score, pa query/ID klienti në provë', () => {
    const r = runPrivacy(withLh(makeCtx({ html: page('<p>x</p>', '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>') }), lhWith(GA, GA_ENTITIES)));
    expect(r).toMatchObject({ score: null, status: 'info' });
    const i = code(r, 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL')!;
    expect(i).toMatchObject({ severity: 'medium', confidence: 0.6, needsManualReview: true });
    // Mesazhi = vetëm fakti i vëzhguar; mungesa e CMP-së në HTML statik s'paraqitet si përfundim
    expect(i.message).toBe('U vëzhgua kërkesë te Google Tag Manager, Google Analytics (/g/collect) gjatë ngarkimit, pa asnjë ndërveprim — kërkon verifikim manual');
    expect(i.message).not.toMatch(/s'u gjet|mungon|pa pëlqim/);
    expect(i.evidence.map((e) => e.url)).toEqual(['https://www.googletagmanager.com/gtag/js', 'https://www.google-analytics.com/g/collect', 'https://example.com/']);
    expect(i.evidence[2]!.detected).toMatch(/në HTML statik .* — kjo s'provon që mekanizmi mungon$/);
    expect(allText(r)).not.toMatch(/cid=123/);
    expect(r.checks.find((c) => c.id === 'third-parties')!.observations!.join(' ')).toMatch(/Google Fonts ngarkohen nga serverat e Google/);
    expect(r.limitations).toContain('Privacy: sinjale të vëzhgueshme për shqyrtim manual — NUK është vlerësim ligjor i pajtueshmërisë me GDPR/ePrivacy.');
  });

  it('me CMP të njohur → vetëm sinjal "low" për verifikim; pa tracker-a → pa issue', () => {
    const cmp = '<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js"></script>';
    const r = runPrivacy(withLh(makeCtx({ html: page('<p>x</p>', cmp) }), lhWith(GA, GA_ENTITIES)));
    expect(code(r, 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL')).toBeUndefined();
    expect(code(r, 'TRACKING_ON_LOAD_WITH_CMP')).toMatchObject({ severity: 'low', confidence: 0.4 });
    const clean = runPrivacy(withLh(makeCtx({ html: page('<p>x</p>') }), lhWith([], GA_ENTITIES.slice(0, 1))));
    expect(clean.issues).toEqual([]);
  });

  it('pa Lighthouse → kontrolli i rrjetit skipped (partial), mbeten sinjalet statike; asnjë issue tracker-i nga hamendja', () => {
    const r = runPrivacy(makeCtx({ html: page('<p>x</p>', '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>') }));
    expect(r.checks.find((c) => c.id === 'trackers-on-load')).toMatchObject({ status: 'skipped' });
    expect(r.checks.find((c) => c.id === 'static-trackers')!.observations![0]).toMatch(/Google Analytics 4 \(G-TEST1234\)/);
    expect(r).toMatchObject({ status: 'info', partial: true });
    expect(code(r, 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL')).toBeUndefined();
  });

  it('pa link privatësie; formë me të dhëna personale pa link në faqe', () => {
    const r = runPrivacy(makeCtx({ html: htmlPage({ title: 'K', main: '<form action="/s" method="post"><label>Email <input type="email" name="email"></label><label>Msg <textarea name="m"></textarea></label><button>Dërgo</button></form>' }) }));
    expect(code(r, 'PRIVACY_POLICY_LINK_NOT_FOUND')).toMatchObject({ confidence: 0.6, needsManualReview: true });
    expect(code(r, 'PERSONAL_DATA_FORM_WITHOUT_PRIVACY_LINK')).toMatchObject({ confidence: 0.5, needsManualReview: true });
  });

  it('asnjë formulim "në përputhje / shkel GDPR" në rezultat', () => {
    const r = runPrivacy(withLh(makeCtx({ html: page('<p>x</p>') }), lhWith(GA, GA_ENTITIES)));
    expect(allText(r)).not.toMatch(/(është|s'është|nuk është) në përputhje|shkel(je|ë)? (të )?GDPR|GDPR[- ]compliant|non-compliant|violat/i);
  });
});

describe('MVP-3 s\'ndryshon pikëzimin e MVP-1', () => {
  it('Health Score dhe kategoritë janë të njëjta me dhe pa modulet e biznesit', () => {
    const ctx = makeCtx({ lighthouse: { status: 'ok', value: lighthouseFixture() } });
    const base = runModules(ctx, MVP1_MODULES);
    const all = runModules(ctx, [...MVP1_MODULES, ...BUSINESS_MODULES]);
    expect(all.filter((r) => r.section === 'business').map((r) => r.module)).toEqual(['conversion', 'privacy']);
    const h1 = computeHealth(base, base.flatMap((r) => r.issues));
    const h2 = computeHealth(all.filter((r) => r.section === 'homepage'), all.filter((r) => r.section === 'homepage').flatMap((r) => r.issues));
    expect(h2).toEqual(h1);
    // edhe nëse dikush i kalon të gjitha rezultatet, kategoritë e biznesit s'hyjnë
    expect(computeHealth(all, base.flatMap((r) => r.issues)).score).toBe(h1.score);
  });
});
