import type { AuditContext } from '../core/context.js';
import type { AuditResult, Evidence, IssueDraft } from '../core/schemas.js';
import { isSuccess } from '../core/access.js';
import { ModuleBuilder } from './helpers.js';

const HSTS_MIN_AGE = 15_552_000; // 180 ditë
/** "Apache/2.4.41", "PHP/8.1.2", "nginx/1.18" — jo emra hostesh me shifra (p.sh. mw-web.eqiad.main-695). */
export const VERSION_PATTERN = /\/\s*v?\d+(\.\d+)+/i;

export function runSecurity(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('security', 'security');
  if (ctx.main.status !== 'ok') {
    const reason = `Faqja hyrëse s'u mor: ${ctx.main.status === 'error' ? ctx.main.error : ctx.main.reason}`;
    for (const [id, label, w] of [
      ['https', 'HTTPS', 4], ['http-redirect', 'http → https', 2],
      ['mixed-content', 'Mixed content', 2], ['hsts', 'HSTS', 2], ['csp', 'Content-Security-Policy', 1],
      ['frame-protection', 'Mbrojtje nga framing', 1], ['x-content-type-options', 'X-Content-Type-Options', 1],
    ] as const) {
      m.skip(id, label, w, reason);
    }
    // TLS lexohet veçmas: shpesh është pikërisht arsyeja pse faqja dështoi (certifikatë e skaduar).
    runTlsCheck(ctx, m, ctx.url, ctx.url.startsWith('https:'));
    return m.build();
  }

  const res = ctx.main.value;
  const pageUrl = res.finalUrl;
  const isHttps = pageUrl.startsWith('https:');
  const html = ctx.html.status === 'ok' ? ctx.html.value : undefined;
  const h = res.headers;
  // Formularët POST/me fjalëkalim kryejnë veprime të ndjeshme; një kërkim GET jo.
  const hasSensitiveForms = (html?.forms.postCount ?? 0) > 0 || (html?.forms.hasPasswordInput ?? false);
  const hasPassword = html?.forms.hasPasswordInput ?? false;
  const headerEvidence = (name: string, expected: string): Evidence => ({
    type: 'http',
    url: pageUrl,
    detected: h[name] !== undefined ? `${name}: ${h[name]}` : `Header "${name}" mungon në përgjigjen e faqes hyrëse`,
    expected,
  });

  // --- HTTPS ---
  const httpsIssues: IssueDraft[] = [];
  if (!isHttps) {
    const downgraded = ctx.url.startsWith('https:');
    httpsIssues.push({
      code: downgraded ? 'HTTPS_DOWNGRADE' : 'NOT_HTTPS', scope: 'site', url: pageUrl, severity: 'high',
      impact: 'Security dhe besueshmëri e lartë', impactLevel: 'high', effort: 'medium',
      message: downgraded ? 'URL https ridrejton te http' : 'Faqja shërbehet pa HTTPS',
      whyItMatters: 'Pa HTTPS trafiku mund të lexohet/ndryshohet gjatë rrugës; browser-at e shënojnë faqen "Not secure".',
      fix: 'Aktivizo certifikatë (p.sh. Let\'s Encrypt / CDN) dhe ridrejto 301 gjithë trafikun http → https.',
      evidence: [{
        type: 'http', url: ctx.url,
        detected: res.redirects.length ? res.redirects.map((r) => `${r.status} ${r.url} → ${r.location}`).join(' | ') : `Faqja përfundimtare: ${pageUrl}`,
        expected: 'URL përfundimtare me https://',
      }],
    });
  }
  m.check('https', 'HTTPS', 4, httpsIssues);

  // --- http:// → https:// ---
  if (!isHttps) m.notApplicable('http-redirect', 'http → https', 'Faqja s\'shërbehet me HTTPS');
  else if (ctx.httpVariant.status === 'ok') {
    const v = ctx.httpVariant.value;
    const issues: IssueDraft[] = [];
    if (!v.finalUrl.startsWith('https:') && isSuccess(v.status)) {
      issues.push({
        code: 'HTTP_NOT_REDIRECTED', scope: 'site', url: v.requestedUrl, severity: 'medium', impact: 'Security/SEO mesatar', impactLevel: 'medium', effort: 'low',
        message: 'Versioni http:// nuk ridrejton te https://',
        whyItMatters: 'Vizitorët/linqet e vjetra me http mbeten në lidhje të pambrojtur dhe krijohen URL të dyfishta.',
        fix: 'Shto ridrejtim 301 nga http:// te https:// në server/CDN.',
        evidence: [{ type: 'http', url: v.requestedUrl, detected: `HTTP ${v.status} në ${v.finalUrl} pa ridrejtim te https`, expected: '301 → https://…' }],
      });
    }
    if (!v.finalUrl.startsWith('https:') && !isSuccess(v.status)) {
      // p.sh. http:// ktheu 403 për këtë klient: s'dimë nëse vizitorët ridrejtohen.
      m.skip('http-redirect', 'http → https', 2, `http:// ktheu HTTP ${v.status} pa ridrejtim; sjellja për vizitorët s'dihet`);
    } else {
      m.check('http-redirect', 'http → https', 2, issues, issues.length ? undefined : [`${v.requestedUrl} → ${v.finalUrl} (${v.redirects.map((r) => r.status).join('→')})`]);
    }
  } else if (ctx.httpVariant.status === 'error' && ['NETWORK', 'TIMEOUT'].includes(ctx.httpVariant.code ?? '')) {
    m.info('http-redirect', 'http → https', [`Porti 80 nuk përgjigjet (${ctx.httpVariant.error}); http s'shërben përmbajtje — s'është problem.`]);
  } else {
    m.skip('http-redirect', 'http → https', 2, ctx.httpVariant.status === 'error' ? ctx.httpVariant.error : ctx.httpVariant.reason);
  }

  runTlsCheck(ctx, m, pageUrl, isHttps);

  if (ctx.access.state !== 'ok') {
    // Header-at dhe HTML-ja janë të përgjigjes së bllokimit/gabimit, jo të faqes reale:
    // mungesa e tyre s'raportohet si rekomandim.
    const reason = `Header-at i përkasin përgjigjes HTTP ${res.status}, jo faqes reale`;
    for (const [id, label, w] of [
      ['mixed-content', 'Mixed content', 2], ['hsts', 'HSTS', 2], ['csp', 'Content-Security-Policy', 1],
      ['frame-protection', 'Mbrojtje nga framing', 1], ['x-content-type-options', 'X-Content-Type-Options', 1],
      ['referrer-policy', 'Referrer-Policy', 0.5], ['version-disclosure', 'Zbulim versioni në header', 0.5],
    ] as const) {
      m.skip(id, label, w, reason);
    }
    return m.build({ score: null, reason: `Faqja reale s'u mor (${ctx.access.summary}); u vlerësuan vetëm HTTPS dhe TLS` });
  }

  // --- Mixed content ---
  if (!isHttps) m.notApplicable('mixed-content', 'Mixed content', 'Faqja s\'shërbehet me HTTPS');
  else if (!html) m.skip('mixed-content', 'Mixed content', 2, ctx.html.status === 'skipped' ? ctx.html.reason : 'HTML s\'u analizua');
  else {
    const issues: IssueDraft[] = [];
    const active = html.mixedContent.filter((r) => r.active);
    const passive = html.mixedContent.filter((r) => !r.active);
    if (active.length || html.forms.insecureActions.length) {
      issues.push({
        code: 'MIXED_CONTENT_ACTIVE', scope: 'page', url: pageUrl, severity: 'high', impact: 'Security/funksionalitet i lartë', impactLevel: 'high', effort: 'low',
        message: `${active.length} burime aktive dhe ${html.forms.insecureActions.length} formularë me http:// në faqe HTTPS`,
        whyItMatters: 'Browser-at bllokojnë script/CSS/iframe mbi http në faqe https (faqja prishet); formularët http dërgojnë të dhëna pa enkriptim.',
        fix: 'Ndrysho URL-të në https:// (ose relative) dhe verifiko që burimi shërbehet me HTTPS.',
        evidence: [
          ...active.slice(0, 5).map((r) => ({ type: 'dom' as const, url: pageUrl, detected: r.snippet, expected: r.url.replace(/^http:/, 'https:') })),
          ...html.forms.insecureActions.slice(0, 3).map((a) => ({ type: 'dom' as const, url: pageUrl, detected: `<form action="${a}">`, expected: 'action me https://' })),
        ],
      });
    }
    if (passive.length) {
      issues.push({
        code: 'MIXED_CONTENT_PASSIVE', scope: 'page', url: pageUrl, severity: 'low', impact: 'Security i ulët', impactLevel: 'low', effort: 'low',
        message: `${passive.length} imazhe/media me http:// në faqe HTTPS`,
        whyItMatters: 'Browser-at modernë i përmirësojnë automatikisht në https ose i bllokojnë nëse s\'ekzistojnë — mund të mungojnë imazhe.',
        fix: 'Përditëso URL-të e imazheve/medias në https://.',
        evidence: passive.slice(0, 5).map((r) => ({ type: 'dom' as const, url: pageUrl, detected: r.snippet, expected: r.url.replace(/^http:/, 'https:') })),
      });
    }
    m.check('mixed-content', 'Mixed content', 2, issues);
  }

  // --- Header-at e sigurisë: rëndësia sipas kontekstit, jo "high" automatikisht ---
  if (!isHttps) m.notApplicable('hsts', 'HSTS', 'HSTS ka kuptim vetëm mbi HTTPS');
  else {
    const hsts = h['strict-transport-security'];
    const issues: IssueDraft[] = [];
    if (!hsts) {
      issues.push({
        code: 'MISSING_HSTS', scope: 'site', url: pageUrl, severity: 'medium', impact: 'Security mesatar', impactLevel: 'medium', effort: 'low',
        message: 'Mungon Strict-Transport-Security',
        whyItMatters: 'Faqja është në HTTPS; pa HSTS, vizita e parë me http mund të kapet (SSL stripping) para ridrejtimit.',
        fix: 'Shto "Strict-Transport-Security: max-age=31536000" (includeSubDomains vetëm kur të gjitha subdomain-et kanë HTTPS).',
        estimatedTime: '10–30 min',
        evidence: [headerEvidence('strict-transport-security', 'Strict-Transport-Security: max-age=31536000')],
      });
    } else {
      const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
      if (age < HSTS_MIN_AGE) {
        issues.push({
          code: 'HSTS_SHORT_MAX_AGE', scope: 'site', url: pageUrl, severity: 'low', impact: 'Security i ulët', impactLevel: 'low', effort: 'low',
          message: `HSTS max-age=${age} (< 180 ditë)`,
          whyItMatters: 'Një max-age i shkurtër e zvogëlon mbrojtjen mes vizitave.',
          fix: 'Rrite gradualisht max-age deri në 31536000 pasi ta kesh verifikuar.',
          evidence: [headerEvidence('strict-transport-security', `max-age ≥ ${HSTS_MIN_AGE}`)],
        });
      }
    }
    m.check('hsts', 'HSTS', 2, issues);
  }

  const csp = h['content-security-policy'];
  {
    const issues: IssueDraft[] = [];
    const obs: string[] = [];
    if (!csp) {
      if (h['content-security-policy-report-only']) obs.push('Ka vetëm Content-Security-Policy-Report-Only (monitorim, jo zbatim).');
      issues.push({
        code: 'MISSING_CSP', scope: 'site', url: pageUrl,
        severity: hasPassword ? 'medium' : 'low', impact: 'Security (mbrojtje shtesë nga XSS)', impactLevel: hasPassword ? 'medium' : 'low', effort: 'medium',
        message: 'Mungon Content-Security-Policy',
        whyItMatters: hasPassword
          ? 'Faqja ka fushë fjalëkalimi; CSP kufizon dëmin e një XSS-i të mundshëm mbi kredencialet.'
          : 'CSP është mbrojtje shtesë (defense-in-depth) kundër XSS; mungesa vetëm s\'do të thotë cenueshmëri.',
        fix: 'Fillo me Content-Security-Policy-Report-Only, mblidh shkeljet, pastaj zbato një politikë (script-src me nonce/hash).',
        evidence: [headerEvidence('content-security-policy', 'Content-Security-Policy: default-src \'self\'; …')],
      });
    }
    m.check('csp', 'Content-Security-Policy', 1, issues, obs.length ? obs : undefined);
  }

  {
    const xfo = h['x-frame-options'];
    const frameAncestors = csp ? /frame-ancestors/i.test(csp) : false;
    const issues: IssueDraft[] = [];
    if (!xfo && !frameAncestors) {
      issues.push({
        code: 'MISSING_FRAME_PROTECTION', scope: 'site', url: pageUrl,
        severity: hasSensitiveForms ? 'medium' : 'low', impact: 'Security (clickjacking)', impactLevel: hasSensitiveForms ? 'medium' : 'low', effort: 'low',
        message: 'Mungon X-Frame-Options ose CSP frame-ancestors',
        whyItMatters: hasSensitiveForms
          ? 'Faqja ka formularë POST/me fjalëkalim; pa mbrojtje, mund të futet në iframe të huaj për clickjacking.'
          : 'Rrezik i ulët për faqe pa veprime të ndjeshme, por mbrojtja kushton pak.',
        fix: 'Shto "Content-Security-Policy: frame-ancestors \'self\'" ose "X-Frame-Options: SAMEORIGIN".',
        evidence: [headerEvidence('x-frame-options', 'X-Frame-Options: SAMEORIGIN ose CSP frame-ancestors')],
      });
    }
    m.check('frame-protection', 'Mbrojtje nga framing', 1, issues);
  }

  {
    const v = h['x-content-type-options'];
    const issues: IssueDraft[] = [];
    if (!v || v.toLowerCase().trim() !== 'nosniff') {
      issues.push({
        code: 'MISSING_X_CONTENT_TYPE_OPTIONS', scope: 'site', url: pageUrl, severity: 'low', impact: 'Security i ulët', impactLevel: 'low', effort: 'low',
        message: 'X-Content-Type-Options: nosniff mungon',
        whyItMatters: 'Parandalon browser-in të "hamendësojë" llojin e skedarit (MIME sniffing).',
        fix: 'Shto "X-Content-Type-Options: nosniff".',
        evidence: [headerEvidence('x-content-type-options', 'X-Content-Type-Options: nosniff')],
      });
    }
    m.check('x-content-type-options', 'X-Content-Type-Options', 1, issues);
  }

  {
    const rp = h['referrer-policy'];
    if (!rp) {
      m.info('referrer-policy', 'Referrer-Policy', ['Mungon Referrer-Policy; browser-at modernë përdorin "strict-origin-when-cross-origin" si parazgjedhje — s\'llogaritet si problem.']);
    } else if (/unsafe-url/i.test(rp)) {
      m.check('referrer-policy', 'Referrer-Policy', 0.5, [{
        code: 'UNSAFE_REFERRER_POLICY', scope: 'site', url: pageUrl, severity: 'low', impact: 'Privatësi i ulët', impactLevel: 'low', effort: 'low',
        message: 'Referrer-Policy: unsafe-url',
        whyItMatters: 'Dërgon URL-në e plotë (me query) te çdo sit i jashtëm.',
        fix: 'Përdor "strict-origin-when-cross-origin".',
        evidence: [headerEvidence('referrer-policy', 'strict-origin-when-cross-origin')],
      }]);
    } else {
      m.check('referrer-policy', 'Referrer-Policy', 0.5, [], [`Referrer-Policy: ${rp}`]);
    }
  }

  {
    const disclosures = (['server', 'x-powered-by', 'x-aspnet-version'] as const)
      // X-AspNet-Version përmban vetëm versionin ("4.0.30319"); të tjerët duhet të kenë formën produkt/version.
      .filter((k) => h[k] && (k === 'x-aspnet-version' ? /\d/.test(h[k]!) : VERSION_PATTERN.test(h[k]!)))
      .map((k) => `${k}: ${h[k]}`);
    m.check('version-disclosure', 'Zbulim versioni në header', 0.5, disclosures.length ? [{
      code: 'SERVER_VERSION_DISCLOSURE', scope: 'site', url: pageUrl, severity: 'low', impact: 'Security i ulët', impactLevel: 'low', effort: 'low',
      confidence: 0.8,
      message: 'Header-at zbulojnë versionin e softuerit të serverit',
      whyItMatters: 'Nuk është cenueshmëri vetvetiu, por e lehtëson identifikimin e versioneve të vjetra.',
      fix: 'Fshih versionin (p.sh. server_tokens off në nginx, expose_php=Off) dhe mbaj softuerin të përditësuar.',
      evidence: [{ type: 'http', url: pageUrl, detected: disclosures.join(' | '), expected: 'Pa numër versioni' }],
    }] : []);
  }

  m.limitations.push('Security: vetëm header-a, HTTPS, TLS lokal dhe mixed content në HTML statik. Pa exposure probing / pentest (jashtë MVP-1).');
  return m.build();
}

function runTlsCheck(ctx: AuditContext, m: ModuleBuilder, pageUrl: string, isHttps: boolean): void {
  if (!isHttps) m.notApplicable('tls-certificate', 'Certifikata TLS', 'Faqja s\'shërbehet me HTTPS');
  else if (ctx.tls.status !== 'ok') {
    m.skip('tls-certificate', 'Certifikata TLS', 4, ctx.tls.status === 'error' ? `TLS s'u lexua: ${ctx.tls.error}` : ctx.tls.reason);
  } else {
    const t = ctx.tls.value;
    const issues: IssueDraft[] = [];
    const ev: Evidence = {
      type: 'tls', url: pageUrl,
      detected: `authorized=${t.authorized}${t.authorizationError ? ` (${t.authorizationError})` : ''}; skadon ${t.validTo ?? '?'} (${t.daysRemaining ?? '?'} ditë); lëshues: ${t.issuer ?? '?'}; ${t.protocol ?? ''}`,
      expected: 'Certifikatë e vlefshme, > 30 ditë para skadimit',
    };
    if (!t.authorized || (t.daysRemaining !== undefined && t.daysRemaining < 0)) {
      issues.push({
        code: 'TLS_CERT_INVALID', scope: 'site', url: pageUrl, severity: 'critical', impact: 'Security/availability kritik', impactLevel: 'high', effort: 'low',
        message: `Certifikata TLS e pavlefshme${t.authorizationError ? `: ${t.authorizationError}` : ''}`,
        whyItMatters: 'Browser-at shfaqin paralajmërim të plotë; shumica e vizitorëve largohen.',
        fix: 'Rinovo/rikonfiguro certifikatën (zinxhirin e plotë, hostin e duhur) në server ose CDN.',
        evidence: [ev],
      });
    } else if (t.daysRemaining !== undefined && t.daysRemaining < 30) {
      issues.push({
        code: 'TLS_CERT_EXPIRING', scope: 'site', url: pageUrl, severity: t.daysRemaining < 14 ? 'high' : 'medium', impact: 'Availability', impactLevel: 'high', effort: 'low',
        message: `Certifikata skadon pas ${t.daysRemaining} ditësh`,
        whyItMatters: 'Nëse rinovimi automatik dështon, faqja bëhet e paaksesueshme me paralajmërim sigurie.',
        fix: 'Verifiko që rinovimi automatik (ACME/CDN) funksionon ose rinovoje manualisht.',
        evidence: [ev],
      });
    }
    m.check('tls-certificate', 'Certifikata TLS', 4, issues, issues.length ? undefined : [ev.detected]);
  }

}
