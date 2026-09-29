import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import { businessPages, detectionFor } from '../../detection/index.js';
import type { LhEntity } from '../../lighthouse/run-lighthouse.js';
import { ModuleBuilder } from '../helpers.js';
import { businessCoverage, businessUnavailable, distinctForms, FORM_PURPOSE_LABELS, formOccurrence, listUrls, scopeLimitation } from './common.js';

/** Kategoritë e third-party-web (Lighthouse) që zakonisht gjurmojnë ose profilizojnë. */
const TRACKING_CATEGORIES = new Set(['analytics', 'ad', 'social', 'marketing', 'customer-success', 'tag-manager']);
const DISCLAIMER = 'Privacy: sinjale të vëzhgueshme për shqyrtim manual — NUK është vlerësim ligjor i pajtueshmërisë me GDPR/ePrivacy.';

interface NetRequest { url: string; entity?: string; resourceType?: string; statusCode?: number; networkRequestTime?: number }

/** URL pa query/fragment: query-t e tracker-ave mbajnë ID klienti — s'ruhen në raport. */
function stripQuery(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.split('?')[0]!;
  }
}

function part(u: string | undefined, k: 'host' | 'pathname'): string {
  try {
    return u ? new URL(u)[k] : '';
  } catch {
    return u ?? '';
  }
}

/**
 * Privacy signals (MVP-3): politika, mekanizëm pëlqimi, tracker-a të thirrur gjatë ngarkimit pa ndërveprim
 * (log-u i rrjetit të Lighthouse, profil i ri), cookies të palëve të treta, forma me të dhëna personale.
 * Pa score me qëllim: moduli s'jep verdikt "në përputhje / jo në përputhje".
 */
export function runPrivacy(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('privacy', 'privacy');
  const unavailable = businessUnavailable(ctx);
  const pages = unavailable ? [] : businessPages(ctx);
  const home = pages.find((p) => p.isHome);
  if (unavailable || !home) {
    m.skip('privacy', 'Privacy', 1, unavailable ?? 'Pa HTML të faqes hyrëse');
    return m.build({ score: null, reason: unavailable ?? 'Pa HTML të faqes hyrëse' });
  }
  const homeJs = home.page.business.jsRendered.likely;
  const tech = detectionFor(ctx)?.techStack;
  const wp = tech?.cms === 'WordPress' && tech.confidence >= 0.7;

  // --- 1. Linke te politikat ---
  const links = pages.flatMap((p) => p.page.business.privacy.policyLinks.map((l) => ({ ...l, page: p.url })));
  const kinds = (k: string) => [...new Set(links.filter((l) => l.kind === k).map((l) => l.href))];
  const privacyLinks = kinds('privacy');
  const cookieLinks = kinds('cookies');
  const policyIssues: IssueDraft[] = [];
  if (!privacyLinks.length) {
    policyIssues.push({
      code: 'PRIVACY_POLICY_LINK_NOT_FOUND', scope: 'site', url: home.url, affectedPages: pages.map((p) => p.url), severity: 'medium', impact: 'Privatësi/Besim', impactLevel: 'medium', effort: 'low',
      confidence: homeJs ? 0.3 : 0.6,
      message: `S'u gjet link te politika e privatësisë në ${pages.length} faqet e kontrolluara — kërkon verifikim`,
      whyItMatters: 'Vizitorët dhe autoritetet presin informacion të qartë se si përpunohen të dhënat. Mungesa e linkut s\'provon mungesën e politikës.',
      fix: 'Verifiko; nëse mungon, shto një faqe politike privatësie dhe lidhe nga footer-i.',
      evidence: [{ type: 'dom', url: home.url, detected: `0 linke me "privacy/privatësi/datenschutz…" (${homeJs ? 'HTML e renderuar me JS' : 'HTML statik'})` }],
    });
  }
  m.info('policy-links', 'Linke te politikat', [
    `Politika e privatësisë: ${privacyLinks.length ? listUrls(privacyLinks, 3) : 'nuk u gjet'}`,
    `Politika e cookies: ${cookieLinks.length ? listUrls(cookieLinks, 3) : 'nuk u gjet'}`,
    `Kushtet: ${kinds('terms').length ? listUrls(kinds('terms'), 2) : 'nuk u gjetën'}; Impressum: ${kinds('imprint').length ? listUrls(kinds('imprint'), 1) : '—'}`,
    'Përmbajtja e politikave s\'u lexua dhe s\'u vlerësua.',
  ], policyIssues);

  // --- 2. Mekanizëm pëlqimi (CMP) në HTML statik dhe/ose në rrjet ---
  const lh = ctx.lighthouse.status === 'ok' ? ctx.lighthouse.value : undefined;
  const entities: LhEntity[] = lh?.entities ?? [];
  const requests: NetRequest[] = ((lh?.audits['network-requests']?.details?.items as NetRequest[] | undefined) ?? []);
  const cmpStatic = pages.flatMap((p) => p.page.business.privacy.cmp.map((c) => ({ ...c, page: p.url })));
  const cmpKnown = [...new Map(cmpStatic.filter((c) => !c.generic).map((c) => [c.name, c])).values()];
  const cmpGeneric = cmpStatic.filter((c) => c.generic);
  const cmpNetwork = entities.filter((e) => e.category === 'consent-provider').map((e) => e.name);
  const consentMode = pages.some((p) => p.page.business.privacy.consentModeDefault);
  const cmpFound = cmpKnown.length > 0 || cmpNetwork.length > 0;
  m.info('consent-mechanism', 'Mekanizëm pëlqimi (cookie banner/CMP)', [
    `CMP e njohur në HTML: ${cmpKnown.length ? cmpKnown.map((c) => `${c.name} ("${c.evidence}" te ${c.page})`).join('; ') : 'asnjë'}`,
    `CMP në rrjet (Lighthouse): ${lh ? (cmpNetwork.join(', ') || 'asnjë') : 'pa të dhëna (Lighthouse s\'u ekzekutua)'}`,
    `Markup i përgjithshëm banner-i: ${cmpGeneric.length ? `${cmpGeneric[0]!.evidence} (confidence e ulët)` : 'asnjë'}`,
    `Google Consent Mode (gtag consent default): ${consentMode ? 'po' : 'nuk u gjet në HTML'}`,
    'Banner-i s\'u klikua dhe zgjedhjet e pëlqimit s\'u testuan. Një banner i ndërtuar me JS pa CMP të njohur mund të mos zbulohet.',
  ]);

  // --- 3. Tracker-a gjatë ngarkimit, pa ndërveprim (Lighthouse: profil i ri, asnjë klik) ---
  const staticTrackers = [...new Map(pages.flatMap((p) => p.page.business.privacy.trackers.map((t) => [t.name, { ...t, page: p.url }] as const))).values()];
  const trackerObs = [`Tracker-a në HTML statik: ${staticTrackers.length ? staticTrackers.map((t) => `${t.name}${t.id ? ` (${t.id})` : ''}${t.cookieless ? ' [deklaron pa cookies]' : ''}`).join(', ') : 'asnjë i njohur'}`];
  const trackerIssues: IssueDraft[] = [];
  if (!lh) {
    m.skip('trackers-on-load', 'Tracker-a të thirrur gjatë ngarkimit', 1, `Pa log rrjeti: ${ctx.lighthouse.status === 'error' ? `Lighthouse dështoi (${ctx.lighthouse.error.slice(0, 80)})` : ctx.lighthouse.status === 'skipped' ? ctx.lighthouse.reason : 'pa Lighthouse'} — mbeten vetëm sinjalet e HTML-së statike`);
    m.info('static-trackers', 'Tracker-a në HTML statik', trackerObs);
  } else {
    const byEntity = new Map(entities.map((e) => [e.name, e]));
    const tracking = requests.filter((r) => {
      const e = r.entity ? byEntity.get(r.entity) : undefined;
      return e && !e.isFirstParty && e.category && TRACKING_CATEGORIES.has(e.category);
    });
    const groups = new Map<string, NetRequest[]>();
    for (const r of tracking) groups.set(r.entity!, [...(groups.get(r.entity!) ?? []), r]);
    trackerObs.push(
      `Kërkesa te palë të treta gjurmuese gjatë ngarkimit të faqes hyrëse (pa ndërveprim): ${groups.size ? [...groups].map(([name, rs]) => `${name} [${byEntity.get(name)?.category}] ${rs.length}×`).join(', ') : 'asnjë'}`,
    );
    // "Collect"/beacon = të dhëna të dërguara, jo vetëm skript i ngarkuar
    const beacons = tracking.filter((r) => /collect|\/tr\b|\/tr\/|pixel|beacon|events?\b|\/g\/|analytics/i.test(part(r.url, 'pathname')) && r.resourceType !== 'Script');
    if (groups.size) {
      const names = [...groups.keys()];
      const evidence = [...groups].slice(0, 4).map(([name, rs]) => {
        const sent = rs.find((r) => beacons.includes(r)) ?? rs[0]!;
        return {
          type: 'network' as const, url: stripQuery(sent.url),
          detected: `${name} (${byEntity.get(name)?.category}): ${sent.resourceType ?? 'kërkesë'} HTTP ${sent.statusCode ?? '?'} në ${Math.round(sent.networkRequestTime ?? 0)} ms, pa asnjë ndërveprim (profil i ri Chrome)`,
        };
      });
      if (!cmpFound && !consentMode) {
        trackerIssues.push({
          code: 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL', scope: 'site', url: home.url, severity: 'medium', impact: 'Privatësi (sinjal për shqyrtim)', impactLevel: 'medium', effort: 'medium',
          confidence: beacons.length ? 0.6 : 0.5,
          // Mesazhi përmban vetëm faktin e vëzhguar (kërkesa); mungesa e CMP-së në HTML statik s'është provë.
          message: `U vëzhgua kërkesë te ${names.join(', ')}${beacons.length ? ` (${[...new Set(beacons.map((b) => part(b.url, 'pathname')))].slice(0, 2).join(', ')})` : ''} gjatë ngarkimit, pa asnjë ndërveprim — kërkon verifikim manual`,
          whyItMatters: 'Tracker-at jo-thelbësorë zakonisht lidhen me kërkesën për pëlqim paraprak. Ky është sinjal teknik, jo përfundim ligjor: mund të ketë mekanizëm pëlqimi që s\'u zbulua (i ngarkuar ndryshe), konfigurim pa cookies, ose bazë tjetër ligjore.',
          fix: `Verifiko me DevTools në një profil të ri. Nëse kërkohet pëlqim, ngarko tracker-at vetëm pas pëlqimit (CMP me bllokim paraprak ose Google Consent Mode v2)${wp ? '; në WordPress, p.sh. një plugin CMP që mbështet Consent Mode' : ''}.`,
          evidence: [
            ...evidence,
            { type: 'dom', url: home.url, detected: `S'u gjet CMP e njohur apo gtag consent default në HTML statik (${pages.length} faqe) as në kërkesat e Lighthouse — kjo s'provon që mekanizmi mungon` },
          ],
        });
      } else {
        trackerIssues.push({
          code: 'TRACKING_ON_LOAD_WITH_CMP', scope: 'site', url: home.url, severity: 'low', impact: 'Privatësi (sinjal për shqyrtim)', impactLevel: 'low', effort: 'low', confidence: 0.4,
          message: `${names.join(', ')} u thirr para ndërveprimit, ndonëse u gjet ${cmpFound ? 'CMP' : 'Consent Mode'} — verifiko nëse bllokohet para pëlqimit`,
          whyItMatters: 'Me Consent Mode, ping-et pa cookies para pëlqimit mund të jenë të qëllimshme; me CMP bllokuese, s\'duhet të ketë thirrje para pëlqimit.',
          fix: 'Kontrollo në DevTools: cookies/parametrat e kërkesave para dhe pas pranimit/refuzimit.',
          evidence,
        });
      }
    }
    m.info('trackers-on-load', 'Tracker-a të thirrur gjatë ngarkimit', trackerObs, trackerIssues);

    // --- 4. Cookies të palëve të treta dhe palë të tjera të treta (Lighthouse) ---
    const tpCookies = ((lh.audits['third-party-cookies']?.details?.items as { name?: string; url?: string }[] | undefined) ?? []);
    const others = entities.filter((e) => !e.isFirstParty && !(e.category && TRACKING_CATEGORIES.has(e.category)));
    const fonts = others.find((e) => /google fonts/i.test(e.name));
    m.info('third-parties', 'Palë të treta dhe cookies të tyre', [
      `Cookies të palëve të treta (Lighthouse, vetëm emrat): ${tpCookies.length ? tpCookies.slice(0, 8).map((c) => `${c.name ?? '?'} (${part(c.url, 'host') || '?'})`).join(', ') : 'asnjë e raportuar'}`,
      `Palë të tjera të treta: ${others.length ? others.map((e) => `${e.name}${e.category ? ` [${e.category}]` : ''}`).join(', ') : 'asnjë'}`,
      ...(fonts ? ['Google Fonts ngarkohen nga serverat e Google: IP-ja e vizitorit i dërgohet Google-it — në BE është diskutuar si çështje privatësie; mund të hostohen lokalisht.'] : []),
    ]);
  }

  // --- 5. Forma që mbledhin të dhëna personale ---
  const pdForms = distinctForms(pages).filter((f) => f.form.collectsPersonalData && !['search', 'filter', 'login'].includes(f.form.purpose));
  const formObs: string[] = [];
  const formIssues: IssueDraft[] = [];
  for (const { form, urls } of pdForms) {
    const withoutPolicy = urls.filter((u) => !pages.find((p) => p.url === u)?.page.business.privacy.policyLinks.some((l) => l.kind === 'privacy'));
    const pd = form.fields.filter((f) => f.type === 'email' || f.type === 'tel' || /name|emri/i.test(f.name)).map((f) => f.name).join(', ');
    // Newsletter: vetëm sinjali teknik + verifikim manual i mënyrës së abonimit (pa shpjegim për bazë ligjore).
    const consent = form.purpose === 'newsletter'
      ? `checkbox pëlqimi në HTML statik: ${form.consentCheckbox ? 'po' : 'nuk u gjet'}; mënyra e abonimit/pëlqimit (p.sh. teksti pranë fushës, konfirmimi me email te ofruesi) kërkon verifikim manual`
      : `checkbox pëlqimi: ${form.consentCheckbox ? 'po' : 'jo (s\'është gjithmonë i nevojshëm — baza ligjore mund të jetë kontrata/kërkesa)'}`;
    formObs.push(`Formë ${FORM_PURPOSE_LABELS[form.purpose]} me të dhëna personale (${pd}) — ${formOccurrence(urls)}; link privatësie në faqe: ${urls.length - withoutPolicy.length}/${urls.length}; ${consent}`);
    if (withoutPolicy.length) {
      formIssues.push({
        code: 'PERSONAL_DATA_FORM_WITHOUT_PRIVACY_LINK', scope: withoutPolicy.length > 1 ? 'template' : 'page', url: withoutPolicy[0]!, affectedPages: withoutPolicy, severity: 'low', impact: 'Privatësi/Besim', impactLevel: 'low', effort: 'low', confidence: 0.5,
        message: `Formë ${FORM_PURPOSE_LABELS[form.purpose]} mbledh të dhëna personale në ${withoutPolicy.length} faqe pa link të dukshëm te politika e privatësisë — kërkon verifikim`,
        whyItMatters: 'Njoftimi për përpunimin e të dhënave zakonisht jepet pranë formës ose me link te politika.',
        fix: 'Shto pranë butonit një rresht të shkurtër me link te politika e privatësisë.',
        evidence: [{ type: 'dom', url: withoutPolicy[0]!, detected: `fusha: ${form.fields.map((f) => `${f.type}:${f.name}`).slice(0, 5).join(', ')}; 0 linke privatësie në faqe` }],
      });
    }
  }
  if (!pdForms.length) formObs.push('S\'u gjetën forma me të dhëna personale në HTML statik.');
  formObs.push('Asnjë formë s\'u dërgua; ku shkojnë të dhënat pas dërgimit s\'u verifikua.');
  m.info('forms-personal-data', 'Forma me të dhëna personale', formObs, formIssues);

  const iframes = [...new Set(pages.flatMap((p) => p.page.business.iframes.filter((f) => f.crossOrigin).map((f) => f.host)))];
  if (iframes.length) m.limitations.push(`Privacy: iframe ndër-domain (${iframes.join(', ')}) mund të vendosin cookies/tracker-a të vetët — përmbajtja e tyre s'u kontrollua.`);
  m.limitations.push(
    DISCLAIMER,
    lh ? 'Privacy: log-u i rrjetit vjen nga Lighthouse — vetëm faqja hyrëse, një ngarkim, profil i ri Chrome, pa klikuar banner; faqet e tjera kontrollohen vetëm në HTML statik.' : 'Privacy: pa log rrjeti (Lighthouse s\'dha rezultat) — vetëm HTML statik.',
    'Privacy: cookies të palës së parë dhe vlerat e cookies s\'lexohen e s\'ruhen.',
  );
  const scope = scopeLimitation(ctx, 'Privacy');
  if (scope) m.limitations.push(scope);
  return m.build({ score: null, informational: true, reason: 'Pa score me qëllim: sinjale për shqyrtim manual, jo verdikt ligjor', coverage: businessCoverage(ctx, pages) });
}
