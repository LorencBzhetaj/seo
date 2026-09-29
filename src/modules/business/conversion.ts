import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import { businessPages, detectionFor } from '../../detection/index.js';
import type { CtaSignal } from '../../parse/business.js';
import { ModuleBuilder } from '../helpers.js';
import { groupByTemplate } from '../site/common.js';
import { businessCoverage, businessUnavailable, CONVERSION_NOT_TESTED, CONVERSION_SCORE_SCOPE, distinctForms, FORM_PURPOSE_LABELS, formOccurrence, listUrls, scopeLimitation, shortAction } from './common.js';

const CTA_KIND_LABELS: Record<CtaSignal['kind'], string> = {
  book: 'rezervim', buy: 'blerje', contact: 'kontakt', call: 'telefonatë', quote: 'ofertë', signup: 'regjistrim', directions: 'drejtime', other: 'buton',
};
/** Llojet e sitit për të cilat informacioni lokal (adresë, hartë, orar) ka kuptim. */
const LOCAL_TYPES = new Set(['lodging', 'restaurant', 'local-business']);

const staticNote = (js: boolean) => (js ? 'HTML-ja duket e renderuar me JavaScript — mungesa është edhe më pak e sigurt' : 'vetëm HTML-ja statike, pa JavaScript');

/**
 * Conversion Audit (MVP-3): CTA, mënyrat e kontaktit, formularët (SAFE: pa submit), dëshmi besimi.
 * Gjithçka nga HTML-ja e shërbyer: asnjë klik, asnjë submit, asnjë URL që ndryshon gjendje.
 */
export function runConversion(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('conversion', 'conversion');
  const unavailable = businessUnavailable(ctx);
  const pages = unavailable ? [] : businessPages(ctx);
  const home = pages.find((p) => p.isHome);
  if (unavailable || !home) {
    m.skip('conversion', 'Conversion', 1, unavailable ?? 'Pa HTML të faqes hyrëse');
    return m.build({ score: null, reason: unavailable ?? 'Pa HTML të faqes hyrëse' });
  }
  const detection = detectionFor(ctx);
  const hb = home.page.business;
  const homeJs = hb.jsRendered.likely;

  // --- 1. CTA në faqen hyrëse ---
  const ctas = hb.ctas.filter((c) => c.kind !== 'other');
  const prominent = ctas.filter((c) => c.region === 'main' || (c.styled && c.region !== 'footer'));
  const describe = (c: CtaSignal) => `${CTA_KIND_LABELS[c.kind]}: "${c.text}"${c.href ? ` → ${c.href}` : ''} (${c.region === 'main' ? 'përmbajtje' : c.region}${c.styled ? ', si buton' : ''})`;
  const uniqueCtas = [...new Map(prominent.map((c) => [`${c.kind}|${c.text.toLowerCase()}`, c])).values()];
  const ctaObs = uniqueCtas.slice(0, 6).map(describe);
  const kindsInMain = [...new Set(uniqueCtas.map((c) => c.kind))];
  if (kindsInMain.length >= 4) ctaObs.push(`${kindsInMain.length} lloje CTA në përmbajtje (${kindsInMain.map((k) => CTA_KIND_LABELS[k]).join(', ')}) — shqyrto nëse ka një veprim kryesor të qartë (pragu s'është validuar; pa issue).`);
  ctaObs.push('Pozicioni "above the fold" s\'matet (pa renderim në viewport); radha në DOM është vetëm përafrim.');
  const ctaIssues: IssueDraft[] = [];
  if (ctas.length === 0) {
    ctaIssues.push({
      code: 'NO_CTA_IN_STATIC_HTML', scope: 'page', url: home.url, severity: 'medium', impact: 'Konvertim', impactLevel: 'medium', effort: 'low',
      confidence: homeJs ? 0.3 : 0.5,
      message: 'S\'u gjet CTA e qartë (rezervo, kontakto, bli, telefono…) në HTML-në statike të faqes hyrëse — kërkon verifikim',
      whyItMatters: 'Pa një veprim kryesor të dukshëm, vizitorët s\'e dinë hapin tjetër. CTA-ja mund të renderohet me JavaScript ose të ketë tekst që s\'njihet.',
      fix: 'Verifiko në browser. Nëse mungon, shto një buton kryesor (p.sh. "Rezervo", "Na kontaktoni") në pjesën e sipërme të faqes.',
      evidence: [{ type: 'dom', url: home.url, detected: `0 CTA të njohura mes ${hb.ctas.length} butonave/linkeve të kontrolluara (${staticNote(homeJs)})` }],
    });
  } else if (prominent.length === 0) {
    ctaIssues.push({
      code: 'CTA_ONLY_IN_NAVIGATION', scope: 'page', url: home.url, severity: 'low', impact: 'Konvertim', impactLevel: 'low', effort: 'low', confidence: 0.5,
      message: 'CTA-të në faqen hyrëse janë vetëm në menu/footer, jo në përmbajtje — kërkon verifikim',
      whyItMatters: 'Një buton i dukshëm në përmbajtje zakonisht konverton më mirë se një link në menu.',
      fix: 'Shqyrto të shtosh një buton kryesor në seksionin e parë të faqes.',
      evidence: [{ type: 'dom', url: home.url, detected: ctas.slice(0, 3).map(describe).join('; ') }],
    });
  }
  if (homeJs && ctas.length === 0) m.skip('primary-cta', 'CTA kryesore (faqja hyrëse)', 2, `HTML-ja duket e renderuar me JavaScript (${hb.jsRendered.reason}); CTA s'mund të vlerësohet pa browser`);
  else m.check('primary-cta', 'CTA kryesore (faqja hyrëse)', 2, ctaIssues, ctaObs);

  // --- 2. Mënyrat e kontaktit ---
  const sum = (f: (p: (typeof pages)[number]) => number) => pages.reduce((s, p) => s + f(p), 0);
  const pagesWith = (f: (p: (typeof pages)[number]) => boolean) => pages.filter(f).map((p) => p.url);
  const telPages = pagesWith((p) => p.page.business.contact.phones.length > 0);
  const mailPages = pagesWith((p) => p.page.business.contact.emails.length > 0);
  const waPages = pagesWith((p) => p.page.business.contact.whatsapp.length > 0);
  const contactPages = detection?.pages.filter((c) => c.type === 'contact').map((c) => c.url) ?? [];
  const forms = distinctForms(pages);
  const contactForms = forms.filter((f) => f.form.purpose === 'contact' || f.form.purpose === 'booking');
  const homeClickable = hb.contact.phones.length + hb.contact.emails.length + hb.contact.whatsapp.length + hb.contact.messengers.length;
  const contactObs = [
    `Telefon i klikueshëm (tel:): ${telPages.length} faqe${telPages.length ? `, p.sh. ${hb.contact.phones[0]?.href ?? pages.find((p) => p.page.business.contact.phones.length)!.page.business.contact.phones[0]!.href}` : ''}`,
    `Email (mailto:/Cloudflare): ${mailPages.length} faqe${sum((p) => p.page.business.contact.emails.filter((e) => e.obfuscated).length) ? ' (përfshirë email të fshehur nga Cloudflare)' : ''}`,
    `WhatsApp: ${waPages.length} faqe${waPages.length ? ` (${listUrls(waPages, 2)})` : ''}`,
    `Faqe kontakti: ${contactPages.length ? listUrls(contactPages, 2) : 'nuk u identifikua'}`,
    `Forma kontakti/rezervimi: ${contactForms.length} të ndryshme`,
  ];
  const contactIssues: IssueDraft[] = [];
  if (telPages.length + mailPages.length + waPages.length === 0 && contactForms.length === 0) {
    contactIssues.push({
      code: 'NO_CLICKABLE_CONTACT', scope: 'site', url: home.url, affectedPages: pages.map((p) => p.url), severity: 'medium', impact: 'Konvertim', impactLevel: 'high', effort: 'low',
      confidence: homeJs ? 0.3 : 0.6,
      message: `S'u gjet telefon/email/WhatsApp i klikueshëm as formë kontakti në ${pages.length} faqet e kontrolluara — kërkon verifikim`,
      whyItMatters: 'Në mobile, një link tel:/mailto:/WhatsApp e kthen interesin në kontakt me një prekje.',
      fix: 'Shto linke tel:+… dhe mailto:… (ose WhatsApp) në header/footer dhe në faqen e kontaktit.',
      evidence: [{ type: 'dom', url: home.url, detected: `0 linke tel:/mailto:/wa.me në HTML statik (${staticNote(homeJs)})` }],
    });
  } else if (homeClickable === 0) {
    contactIssues.push({
      code: 'CONTACT_NOT_ON_HOMEPAGE', scope: 'page', url: home.url, severity: 'low', impact: 'Konvertim', impactLevel: 'medium', effort: 'low', confidence: homeJs ? 0.3 : 0.6,
      message: 'Faqja hyrëse s\'ka telefon/email/WhatsApp të klikueshëm (ekziston në faqe të tjera)',
      whyItMatters: 'Shumë vizitorë kërkojnë kontaktin direkt nga faqja hyrëse.',
      fix: 'Shto telefonin/email-in e klikueshëm në header ose footer të template-it.',
      evidence: [{ type: 'dom', url: home.url, detected: `0 në faqen hyrëse; p.sh. te ${listUrls([...telPages, ...mailPages, ...waPages], 2)}` }],
    });
  }
  contactIssues.push(...groupByTemplate(
    { code: 'PHONE_NOT_CLICKABLE', severity: 'low', impact: 'Konvertim (mobile)', impactLevel: 'low', effort: 'low', confidence: 0.7,
      whyItMatters: 'Numri si tekst s\'mund të thirret me një prekje në telefon.', fix: 'Mbështille numrin me <a href="tel:+…">.' },
    (n) => `${n} faqe me numër telefoni si tekst, jo link tel:`,
    pages.filter((p) => p.page.business.contact.unlinkedPhones.length > 0).map((p) => ({
      url: p.url, templateKey: p.page.templateKey,
      detected: `"${p.page.business.contact.unlinkedPhones[0]!.text}" pa href="tel:"`, expected: `<a href="tel:+${p.page.business.contact.unlinkedPhones[0]!.digits}">`,
    })),
  ));
  m.check('contact-methods', 'Mënyrat e kontaktit', 2, contactIssues, contactObs);

  // --- 3. Informacion lokal: aktivizohet nga lloji i sitit (Page Type Detection) ---
  const site = detection?.pageType;
  if (!site || !LOCAL_TYPES.has(site.type)) {
    m.notApplicable('local-info', 'Adresë, hartë dhe orar', site ? `Lloji i sitit: ${site.type} (${site.confidence}) — kontrolli vlen vetëm për biznes lokal` : 'Pa detektim');
  } else {
    const addr = pages.flatMap((p) => p.page.business.contact.addresses.map((a) => ({ ...a, url: p.url })));
    const maps = pagesWith((p) => p.page.business.contact.mapLinks.length > 0 || p.page.business.iframes.some((f) => f.kind === 'map'));
    const hours = pages.flatMap((p) => p.page.business.contact.openingHours.map((h) => ({ ...h, url: p.url })));
    const needsHours = site.type === 'restaurant' || site.alternatives.some((a) => a.type === 'restaurant' && a.confidence >= 0.6);
    // Issue-t trashëgojnë confidence nga detektimi (§3): lloj i pasigurt → issue i pasigurt.
    const conf = Math.min(0.7, site.confidence);
    const localIssues: IssueDraft[] = [];
    const base = { scope: 'site' as const, url: home.url, severity: 'low' as const, impact: 'SEO lokal/Konvertim', impactLevel: 'low' as const, effort: 'low' as const, confidence: conf };
    if (!addr.length) localIssues.push({ ...base, code: 'ADDRESS_NOT_FOUND', message: 'S\'u gjet adresë (schema PostalAddress ose <address>) në faqet e kontrolluara', whyItMatters: 'Për biznes lokal, adresa e qartë ndihmon vizitorët dhe SEO-në lokale.', fix: 'Shto adresën në footer/kontakt dhe në JSON-LD (address: PostalAddress).', evidence: [{ type: 'dom', url: home.url, detected: `0 adresa në ${pages.length} faqe (${staticNote(homeJs)})` }] });
    if (!maps.length) localIssues.push({ ...base, code: 'MAP_LINK_NOT_FOUND', message: 'S\'u gjet link ose hartë (Google/Apple Maps) në faqet e kontrolluara', whyItMatters: 'Një link harte e bën më të lehtë gjetjen e vendndodhjes.', fix: 'Shto link "Si të na gjeni" drejt Google Maps.', evidence: [{ type: 'dom', url: home.url, detected: '0 linke/iframe hartash' }] });
    if (needsHours && !hours.length) localIssues.push({ ...base, code: 'OPENING_HOURS_NOT_FOUND', confidence: Math.min(conf, 0.5), message: 'S\'u gjet orari (openingHours në JSON-LD ose tekst "orari/opening hours") — kërkon verifikim', whyItMatters: 'Për restorant, orari është ndër informacionet më të kërkuara.', fix: 'Shto orarin në faqe dhe në JSON-LD (openingHoursSpecification).', evidence: [{ type: 'dom', url: home.url, detected: `0 sinjale orari në ${pages.length} faqe; lloji: ${site.type}${needsHours && site.type !== 'restaurant' ? ' + restaurant (alternativë)' : ''}` }] });
    m.check('local-info', 'Adresë, hartë dhe orar', 1, localIssues, [
      `Aktivizuar nga lloji i sitit: ${site.type} (confidence ${site.confidence})`,
      `Adresë: ${addr.length ? `${addr[0]!.text.slice(0, 80)} (${addr[0]!.source})` : 'nuk u gjet'}`,
      `Hartë: ${maps.length} faqe`,
      `Orar: ${hours.length ? `${hours[0]!.value.slice(0, 60)} (${hours[0]!.source})` : needsHours ? 'nuk u gjet' : 'jo i kërkuar për këtë lloj'}`,
    ]);
  }

  // --- 4. Formularët: SAFE mode, vetëm struktura ---
  const relevant = forms.filter((f) => !['search', 'filter', 'login'].includes(f.form.purpose));
  const formIssues: IssueDraft[] = [];
  const formObs: string[] = [];
  const repeated = relevant.filter((f) => f.urls.length > 1).length;
  if (relevant.length) formObs.push(`${relevant.length} formularë të ndryshëm (identitet: id/klasat + action + fushat)${repeated ? `, nga të cilët ${repeated} të përsëritur në shumë faqe` : ''}`);
  for (const { form, urls } of relevant) {
    const required = form.fields.filter((f) => f.required).length;
    formObs.push(
      `${formOccurrence(urls)}: ${FORM_PURPOSE_LABELS[form.purpose]}${form.id ? ` #${form.id}` : ''} — ${form.fields.length} fusha (${required} të detyrueshme)` +
        `${form.hasSubmit ? `, buton "${form.submitText ?? ''}"` : ''}${form.captcha ? `, ${form.captcha}` : ''}${form.honeypotFields ? `, ${form.honeypotFields} fushë kurth (honeypot) e përjashtuar` : ''}` +
        `${form.jsHandled ? ', dërgohet me JavaScript (s\'ka action)' : `, action ${form.action ? shortAction(form.action) : '(e njëjta faqe)'}`}${form.initiallyHidden ? ', e fshehur fillimisht' : ''}`,
    );
    const unlabeled = form.fields.filter((f) => !f.labelled);
    if (unlabeled.length) {
      formIssues.push({
        code: 'FORM_FIELDS_WITHOUT_LABEL', scope: urls.length > 1 ? 'template' : 'page', url: urls[0]!, affectedPages: urls, severity: 'low', impact: 'Accessibility/Konvertim', impactLevel: 'low', effort: 'low', confidence: 0.8,
        message: `${unlabeled.length} fusha pa etiketë në formën ${FORM_PURPOSE_LABELS[form.purpose]}${urls.length > 1 ? ` (${urls.length} faqe)` : ''}`,
        whyItMatters: 'Fushat pa <label> (placeholder s\'mjafton) janë të vështira për lexuesit e ekranit dhe rrisin gabimet në plotësim.',
        fix: 'Lidh çdo fushë me <label for="…"> ose aria-label.',
        evidence: [{ type: 'dom', url: urls[0]!, detected: unlabeled.slice(0, 4).map((f) => `<${f.tag} type="${f.type}" name="${f.name}">`).join(', ') }],
      });
    }
    const mistyped = form.fields.filter((f) => f.tag === 'input' && ((/e-?mail/i.test(f.name) && f.type !== 'email') || (/(phone|tel|mobile|telefon)/i.test(f.name) && f.type !== 'tel')));
    if (mistyped.length) {
      formIssues.push({
        code: 'FORM_INPUT_TYPE', scope: urls.length > 1 ? 'template' : 'page', url: urls[0]!, affectedPages: urls, severity: 'low', impact: 'Konvertim (mobile)', impactLevel: 'low', effort: 'low', confidence: 0.7,
        message: `Fusha email/telefon pa type="email"/"tel" në formën ${FORM_PURPOSE_LABELS[form.purpose]}`,
        whyItMatters: 'Tipi i duhur hap tastierën e duhur në mobile dhe aktivizon validimin/autocomplete.',
        fix: 'Përdor type="email" dhe type="tel" (me autocomplete="email"/"tel").',
        evidence: [{ type: 'dom', url: urls[0]!, detected: mistyped.slice(0, 3).map((f) => `name="${f.name}" type="${f.type}"`).join(', ') }],
      });
    }
    if (!form.hasSubmit && !form.initiallyHidden) {
      formIssues.push({
        code: 'FORM_SUBMIT_NOT_FOUND', scope: 'page', url: urls[0]!, affectedPages: urls, severity: 'low', impact: 'Konvertim', impactLevel: 'medium', effort: 'low', confidence: 0.4,
        message: `S'u gjet buton dërgimi në HTML-në statike të formës ${FORM_PURPOSE_LABELS[form.purpose]} — kërkon verifikim`,
        whyItMatters: 'Mund të jetë buton i shtuar me JavaScript; nëse mungon vërtet, forma s\'dërgohet.',
        fix: 'Verifiko në browser (pa e dërguar formën).',
        evidence: [{ type: 'dom', url: urls[0]!, detected: form.snippet.slice(0, 160) }],
      });
    }
  }
  if (!relevant.length) formObs.push('S\'u gjetën formularë kontakti/rezervimi në HTML statik (s\'është domosdoshmëri kur ka telefon/email).');
  formObs.push('SAFE mode: asnjë formë s\'u plotësua apo dërgua; validimi, mesazhet e gabimit dhe dërgimi real s\'u testuan.');
  m.check('forms', 'Formularët (SAFE, pa submit)', 1.5, formIssues, formObs);

  // --- 5. Përmbajtje në iframe ndër-domain: e pakontrolluar ---
  const iframes = pages.flatMap((p) => p.page.business.iframes.filter((f) => f.crossOrigin).map((f) => ({ ...f, page: p.url })));
  const byHost = [...new Map(iframes.map((f) => [f.src, f])).values()];
  if (byHost.length) {
    m.info('cross-origin-iframes', 'Iframe ndër-domain (përmbajtja s\'u kontrollua)', byHost.slice(0, 8).map((f) => `${f.kind === 'other' ? 'iframe' : f.kind}: ${f.src} në ${f.page} — përmbajtja e iframe-it s'u kontrollua (CTA, forma, kontakt brenda tij s'numërohen)`));
    m.limitations.push(`Conversion: ${byHost.length} iframe ndër-domain (${[...new Set(byHost.map((f) => f.host))].join(', ')}) — përmbajtja e tyre s'u kontrollua.`);
  }

  // --- 6. Dëshmi besimi ---
  const rating = pages.find((p) => p.page.business.trust.aggregateRating);
  const reviewsSchema = pages.filter((p) => p.page.business.trust.reviewSchemaCount > 0);
  const testimonials = pages.filter((p) => p.page.business.trust.testimonialHints.length > 0);
  const platforms = [...new Set(pages.flatMap((p) => p.page.business.trust.reviewPlatforms))];
  const social = [...new Set(pages.flatMap((p) => p.page.business.trust.socialProfiles))];
  const trustObs = [
    `Vlerësim në schema (aggregateRating): ${rating ? `${rating.page.business.trust.aggregateRating!.ratingValue ?? '?'} (${rating.page.business.trust.aggregateRating!.reviewCount ?? '?'} vlerësime) te ${rating.url}` : 'nuk u gjet'}`,
    `Review në schema: ${reviewsSchema.length} faqe`,
    `Seksione testimonial/review: ${testimonials.length ? `${testimonials.length} faqe (p.sh. ${testimonials[0]!.page.business.trust.testimonialHints[0]})` : 'nuk u gjetën'}`,
    `Platforma vlerësimesh të lidhura: ${platforms.join(', ') || 'asnjë'}`,
    `Profile sociale: ${social.join(', ') || 'asnjë'}`,
  ];
  const trustIssues: IssueDraft[] = [];
  if (!rating && !reviewsSchema.length && !testimonials.length && !platforms.length) {
    trustIssues.push({
      code: 'TRUST_SIGNALS_NOT_FOUND', scope: 'site', url: home.url, affectedPages: pages.map((p) => p.url), severity: 'low', impact: 'Konvertim', impactLevel: 'low', effort: 'medium', confidence: 0.5,
      message: 'S\'u gjetën dëshmi besimi (vlerësime, testimoniale, platforma review) në faqet e kontrolluara — kërkon verifikim',
      whyItMatters: 'Vlerësimet dhe testimonialet ulin pasigurinë para rezervimit/blerjes. Mund të ngarkohen me widget JavaScript.',
      fix: 'Shto disa vlerësime reale ose link te profili në Google/Tripadvisor/Booking.',
      evidence: [{ type: 'dom', url: home.url, detected: `0 sinjale besimi në ${pages.length} faqe (${staticNote(homeJs)})` }],
    });
  }
  m.check('trust-signals', 'Dëshmi besimi', 1, trustIssues, trustObs);

  m.limitations.push(`Conversion: ${CONVERSION_SCORE_SCOPE} S'u testuan: ${CONVERSION_NOT_TESTED.join('; ')}.`);
  m.limitations.push('Conversion: sinjale nga HTML-ja e shërbyer (pa JavaScript, pa klikime); elementet e shtuara me JS mund të mungojnë — mungesat kanë confidence të ulët dhe kërkojnë verifikim.');
  const scope = scopeLimitation(ctx, 'Conversion');
  if (scope) m.limitations.push(scope);
  return m.build({ coverage: businessCoverage(ctx, pages) });
}
