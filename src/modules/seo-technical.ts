import type { AuditContext } from '../core/context.js';
import type { AuditResult, IssueDraft } from '../core/schemas.js';
import { parseXRobotsTag } from '../parse/html.js';
import { isAllowed } from '../parse/robots.js';
import { ModuleBuilder } from './helpers.js';

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

export function runTechnicalSeo(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('seo-technical', 'seoTechnical');
  const main = ctx.main.status === 'ok' ? ctx.main.value : undefined;
  const html = ctx.html.status === 'ok' ? ctx.html.value : undefined;
  const pageUrl = main?.finalUrl ?? ctx.url;
  const noHtmlReason = ctx.html.status === 'ok' ? '' : ctx.html.status === 'skipped' ? ctx.html.reason : ctx.html.error;

  // --- Title ---
  if (!html) m.skip('title', '<title>', 3, noHtmlReason);
  else {
    const issues: IssueDraft[] = [];
    const [first] = html.titles;
    if (html.titles.length === 0 || !first) {
      issues.push({
        code: html.titles.length === 0 ? 'MISSING_TITLE' : 'EMPTY_TITLE',
        scope: 'page', url: pageUrl, severity: 'high', impact: 'SEO i lartë', impactLevel: 'high', effort: 'low',
        message: html.titles.length === 0 ? 'Mungon <title>' : '<title> është bosh',
        whyItMatters: 'Titulli është sinjali kryesor on-page dhe zakonisht teksti i klikueshëm në rezultatet e kërkimit.',
        fix: 'Shto një <title> unik, përshkrues (rreth 30–60 karaktere) që përmban emrin e biznesit dhe ofertën kryesore.',
        estimatedTime: '10–20 min',
        evidence: [{ type: 'dom', url: pageUrl, detected: html.titleSnippet ?? 'Nuk u gjet <title> në HTML', expected: '<title>Emri — oferta kryesore</title>' }],
      });
    } else {
      if (html.titles.length > 1) {
        issues.push({
          code: 'MULTIPLE_TITLES', scope: 'page', url: pageUrl, severity: 'medium', impact: 'SEO mesatar', impactLevel: 'medium', effort: 'low',
          message: `${html.titles.length} etiketa <title> në faqe`,
          whyItMatters: 'Me disa tituj, motori i kërkimit zgjedh vetë cilin të përdorë; zakonisht shenjë e template-ve të dyfishuara.',
          fix: 'Lër vetëm një <title> në <head>; kontrollo plugin-et SEO/theme që mund ta shtojnë dy herë.',
          evidence: [{ type: 'dom', url: pageUrl, detected: html.titles.map((t) => `"${t}"`).join(' | '), expected: 'Një <title>' }],
        });
      }
      if (first.length < TITLE_MIN || first.length > TITLE_MAX) {
        issues.push({
          code: 'TITLE_LENGTH', scope: 'page', url: pageUrl, severity: 'low', impact: 'SEO i ulët (CTR)', impactLevel: 'low', effort: 'low',
          confidence: 0.8,
          message: `Gjatësia e titullit ${first.length} karaktere (heuristikë ${TITLE_MIN}–${TITLE_MAX})`,
          whyItMatters: first.length > TITLE_MAX
            ? 'Titujt e gjatë priten në rezultatet e kërkimit (kufiri real është në piksel, jo karaktere).'
            : 'Titujt shumë të shkurtër rrallë e përshkruajnë mjaftueshëm faqen.',
          fix: 'Rishkruaje titullin rreth 30–60 karaktere me informacionin më të rëndësishëm në fillim.',
          evidence: [{ type: 'dom', url: pageUrl, detected: `"${first}" (${first.length} kar.)`, expected: `${TITLE_MIN}–${TITLE_MAX} karaktere` }],
        });
      }
    }
    m.check('title', '<title>', 3, issues);
  }

  // --- Meta description ---
  if (!html) m.skip('meta-description', 'Meta description', 2, noHtmlReason);
  else {
    const issues: IssueDraft[] = [];
    const [desc] = html.metaDescriptions;
    if (!desc) {
      issues.push({
        code: 'MISSING_META_DESCRIPTION', scope: 'page', url: pageUrl, severity: 'medium', impact: 'SEO mesatar (snippet/CTR)', impactLevel: 'medium', effort: 'low',
        message: html.metaDescriptions.length ? 'Meta description është bosh' : 'Mungon meta description',
        whyItMatters: 'Pa description, Google gjeneron vetë snippet nga teksti i faqes — shpesh më pak bindës. Nuk ndikon drejtpërdrejt në renditje.',
        fix: 'Shto <meta name="description" content="…"> (rreth 70–160 karaktere) që përmbledh ofertën dhe thirrjen për veprim.',
        estimatedTime: '10–20 min',
        evidence: [{ type: 'dom', url: pageUrl, detected: 'Nuk u gjet <meta name="description"> me përmbajtje', expected: '<meta name="description" content="…">' }],
      });
    } else {
      if (html.metaDescriptions.length > 1) {
        issues.push({
          code: 'MULTIPLE_META_DESCRIPTIONS', scope: 'page', url: pageUrl, severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'low',
          message: `${html.metaDescriptions.length} meta description`,
          whyItMatters: 'Sinjale të dyfishta; zakonisht plugin/theme që e shtojnë dy herë.',
          fix: 'Lër vetëm një meta description.',
          evidence: [{ type: 'dom', url: pageUrl, detected: html.metaDescriptions.map((d) => `"${d.slice(0, 80)}"`).join(' | '), expected: 'Një meta description' }],
        });
      }
      if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
        issues.push({
          code: 'META_DESCRIPTION_LENGTH', scope: 'page', url: pageUrl, severity: 'low', impact: 'SEO i ulët (CTR)', impactLevel: 'low', effort: 'low',
          confidence: 0.8,
          message: `Meta description ${desc.length} karaktere (heuristikë ${DESC_MIN}–${DESC_MAX})`,
          whyItMatters: 'Description shumë e gjatë pritet; shumë e shkurtër shpesh zëvendësohet nga Google.',
          fix: 'Përshtate në rreth 70–160 karaktere.',
          evidence: [{ type: 'dom', url: pageUrl, detected: `"${desc.slice(0, 200)}" (${desc.length} kar.)`, expected: `${DESC_MIN}–${DESC_MAX} karaktere` }],
        });
      }
    }
    m.check('meta-description', 'Meta description', 2, issues);
  }

  // --- H1 ---
  if (!html) m.skip('h1', 'H1', 2, noHtmlReason);
  else {
    const issues: IssueDraft[] = [];
    const nonEmpty = html.h1s.filter(Boolean);
    if (nonEmpty.length === 0) {
      issues.push({
        code: html.h1s.length === 0 ? 'MISSING_H1' : 'EMPTY_H1', scope: 'page', url: pageUrl, severity: 'medium', impact: 'SEO/Accessibility mesatar', impactLevel: 'medium', effort: 'low',
        // HTML-i statik: nëse H1 shtohet me JavaScript, s'shihet këtu.
        confidence: 0.85,
        message: html.h1s.length === 0 ? 'Nuk u gjet H1 në HTML-në e shërbyer' : 'H1 është bosh (p.sh. vetëm imazh pa tekst)',
        whyItMatters: 'H1 përmbledh temën e faqes për përdoruesit, lexuesit e ekranit dhe motorët e kërkimit.',
        fix: 'Shto një <h1> me tekst që përshkruan ofertën kryesore. Nëse H1 renderohet me JS, verifikoje në browser.',
        evidence: [{ type: 'dom', url: pageUrl, detected: html.h1Snippets[0] ?? 'Asnjë <h1> në HTML-në fillestare', expected: '<h1>Tema kryesore</h1>' }],
      });
    } else if (html.h1s.length > 1) {
      issues.push({
        code: 'MULTIPLE_H1', scope: 'page', url: pageUrl, severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'low',
        confidence: 0.6, // HTML5 i lejon; sinjal për shqyrtim, jo gabim
        message: `${html.h1s.length} H1 në faqe`,
        whyItMatters: 'Disa H1 nuk janë gabim, por shpesh tregojnë hierarki të paqartë titujsh.',
        fix: 'Shqyrto nëse një H1 kryesor + H2 për seksionet e bën strukturën më të qartë.',
        evidence: [{ type: 'dom', url: pageUrl, detected: html.h1s.slice(0, 5).map((h) => `"${h.slice(0, 60)}"`).join(' | '), expected: 'Zakonisht një H1 kryesor' }],
      });
    }
    m.check('h1', 'H1', 2, issues);
  }

  // --- Indexability (meta robots + X-Robots-Tag) ---
  if (!main) m.skip('indexability', 'Indeksueshmëria (noindex)', 4, 'Faqja hyrëse s\'u mor');
  // Header-at e një përgjigjeje 403/5xx s'thonë asgjë për indeksueshmërinë e faqes reale.
  else if (ctx.access.state !== 'ok') {
    m.skip('indexability', 'Indeksueshmëria (noindex)', 4, `${ctx.access.summary} Header-at/HTML e faqes reale s'u morën.`);
  } else {
    const issues: IssueDraft[] = [];
    const evidence: IssueDraft['evidence'] = [];
    for (const meta of html?.robotsMeta ?? []) {
      const directives = meta.content.split(',').map((d) => d.trim());
      if (directives.includes('noindex') || directives.includes('none')) {
        evidence.push({ type: 'dom', url: pageUrl, detected: meta.snippet, expected: 'Pa noindex në faqen hyrëse' });
      }
    }
    const xRobots = main.headers['x-robots-tag'];
    const xDirectives = parseXRobotsTag(xRobots);
    if (xDirectives.includes('noindex') || xDirectives.includes('none')) {
      evidence.push({ type: 'http', url: pageUrl, detected: `X-Robots-Tag: ${xRobots}`, expected: 'Pa noindex' });
    }
    if (evidence.length) {
      issues.push({
        code: 'HOMEPAGE_NOINDEX', scope: 'site', url: pageUrl, severity: 'critical', impact: 'SEO kritik — faqja hyrëse del nga indeksi', impactLevel: 'high', effort: 'low',
        message: 'Faqja hyrëse ka direktivë noindex',
        whyItMatters: 'Google e heq faqen nga rezultatet. Nëse kjo është staging/qëllim i vetëdijshëm, injoroje; në prodhim zakonisht është gabim.',
        fix: 'Hiq noindex nga meta robots / X-Robots-Tag (kontrollo "Discourage search engines" në WordPress ose konfigurimin e serverit/CDN).',
        estimatedTime: '5–15 min',
        evidence,
      });
    }
    m.check('indexability', 'Indeksueshmëria (noindex)', 4, issues, html ? undefined : ['Vetëm X-Robots-Tag u kontrollua (s\'ka HTML)']);
  }

  // --- robots.txt ---
  if (ctx.robots.status === 'error') {
    m.skip('robots-txt', 'robots.txt', 3, `robots.txt s'u lexua: ${ctx.robots.error}`);
  } else if (ctx.robots.status === 'skipped') {
    m.skip('robots-txt', 'robots.txt', 3, ctx.robots.reason);
  } else {
    const r = ctx.robots.value;
    if (r.httpStatus >= 500) {
      m.check('robots-txt', 'robots.txt', 3, [
        {
          code: 'ROBOTS_TXT_SERVER_ERROR', scope: 'site', url: r.url, severity: 'high', impact: 'SEO i lartë', impactLevel: 'high', effort: 'low',
          confidence: 0.9,
          message: `robots.txt kthen HTTP ${r.httpStatus}`,
          whyItMatters: 'Sipas RFC 9309, gabimet 5xx te robots.txt trajtohen si "ndalo gjithçka" nga Google për njëfarë kohe.',
          fix: 'Sigurohu që /robots.txt kthen 200 (ose 404 nëse s\'ke rregulla).',
          evidence: [{ type: 'http', url: r.url, detected: `HTTP ${r.httpStatus}`, expected: 'HTTP 200 ose 404' }],
        },
      ]);
    } else if (r.httpStatus === 401 || r.httpStatus === 403 || r.httpStatus === 429) {
      // Refuzim për këtë klient ≠ "robots.txt nuk ekziston": s'dimë çfarë shohin crawler-at.
      m.skip('robots-txt', 'robots.txt', 3, `robots.txt ktheu HTTP ${r.httpStatus} për klientin e auditimit; përmbajtja reale s'dihet`);
    } else if (!r.found) {
      m.info('robots-txt', 'robots.txt', [
        `robots.txt nuk ekziston (HTTP ${r.httpStatus}). Sipas RFC 9309 kjo do të thotë "lejo gjithçka" — nuk është problem.`,
      ]);
    } else if (r.parsed) {
      const path = new URL(pageUrl).pathname;
      const issues: IssueDraft[] = [];
      for (const agent of ['Googlebot', 'Bingbot']) {
        const d = isAllowed(r.parsed, agent, path);
        if (!d.allowed && d.rule) {
          issues.push({
            code: 'ROBOTS_BLOCKS_HOMEPAGE', scope: 'site', url: r.url, severity: 'critical', impact: 'SEO kritik', impactLevel: 'high', effort: 'low',
            message: `robots.txt ndalon faqen hyrëse për ${agent}`,
            whyItMatters: 'Crawler-i s\'e lexon faqen; përmbajtja e saj s\'mund të vlerësohet në kërkim.',
            fix: `Hiq ose ngushto rregullin "Disallow: ${d.rule.pattern}" për grupin "${d.matchedAgent}".`,
            evidence: [{ type: 'http', url: r.url, detected: `Rreshti ${d.rule.line}: Disallow: ${d.rule.pattern} (grupi user-agent: ${d.matchedAgent})`, expected: `Allow për ${path}` }],
          });
          break;
        }
      }
      const obs = r.parsed.sitemaps.length ? [`Sitemap të deklaruara: ${r.parsed.sitemaps.slice(0, 5).join(', ')} (validimi në MVP-2)`] : ['Asnjë direktivë Sitemap në robots.txt (validimi i sitemap në MVP-2)'];
      m.check('robots-txt', 'robots.txt', 3, issues, obs);
    }
  }

  // --- Canonical (mungesa = informacion; issue vetëm me prova konflikti) ---
  if (!html) m.skip('canonical', 'Canonical', 2, noHtmlReason);
  else runCanonical(ctx, m, pageUrl);

  // Lighthouse SEO si metrikë referuese (jo pjesë e pikëzimit tonë)
  const lhSeo = ctx.lighthouse.status === 'ok' ? ctx.lighthouse.value.categories.seo?.score : undefined;
  m.metric({
    id: 'lighthouse-seo',
    label: 'Lighthouse SEO (referencë, jashtë pikëzimit)',
    value: typeof lhSeo === 'number' ? Math.round(lhSeo * 100) : null,
    status: typeof lhSeo === 'number' ? 'measured' : 'unavailable',
    source: 'lighthouse',
    reason: typeof lhSeo === 'number' ? undefined : 'Lighthouse s\'u ekzekutua',
  });
  m.limitations.push('SEO teknik (faqja hyrëse): mbi HTML-në e shërbyer, jo pas JavaScript; faqet e tjera janë te seksioni site.');
  if (ctx.access.state !== 'ok') {
    // Pa HTML-në reale s'ka score SEO — as 100 "partial" nga robots.txt vetëm.
    return m.build({ score: null, reason: `HTML-ja reale nuk u mor: ${ctx.access.summary}` });
  }
  return m.build();
}

function stripSlash(u: string): string {
  return u.replace(/\/$/, '');
}

function runCanonical(ctx: AuditContext, m: ModuleBuilder, pageUrl: string): void {
  const html = ctx.html.status === 'ok' ? ctx.html.value : undefined;
  if (!html) return;
  const canon = html.canonicals;
  if (canon.length === 0) {
    m.info('canonical', 'Canonical', [
      'Mungon <link rel="canonical">. Pa prova URL-sh të dyfishta nuk llogaritet si problem; dyfishimet vlerësohen te seksioni site (Dyfishime & canonical).',
    ]);
    return;
  }
  const issues: IssueDraft[] = [];
  const resolved = [...new Set(canon.map((c) => c.resolved).filter((u): u is string => !!u))];
  const evidenceAll = canon.map((c) => ({ type: 'dom' as const, url: pageUrl, detected: c.snippet }));

  if (canon.some((c) => !c.resolved)) {
    issues.push({
      code: 'INVALID_CANONICAL', scope: 'page', url: pageUrl, severity: 'medium', impact: 'SEO mesatar', impactLevel: 'medium', effort: 'low',
      message: 'Canonical bosh ose URL e pavlefshme',
      whyItMatters: 'Një canonical i pavlefshëm injorohet ose ngatërron crawler-in.',
      fix: `Vendos URL absolute, p.sh. <link rel="canonical" href="${pageUrl}">.`,
      evidence: evidenceAll,
    });
  }
  if (resolved.length > 1) {
    issues.push({
      code: 'CONFLICTING_CANONICALS', scope: 'page', url: pageUrl, severity: 'medium', impact: 'SEO mesatar', impactLevel: 'medium', effort: 'low',
      message: `${resolved.length} canonical të ndryshëm në të njëjtën faqe`,
      whyItMatters: 'Me sinjale kontradiktore, Google i injoron të gjithë dhe zgjedh vetë URL-në kanonike.',
      fix: 'Lër vetëm një canonical (shpesh dy plugin SEO ose theme + plugin e shtojnë secili).',
      evidence: evidenceAll,
    });
  }

  if (resolved.length === 1) {
    const target = resolved[0]!;
    const same = stripSlash(target) === stripSlash(pageUrl);
    if (!same) {
      const t = new URL(target);
      const p = new URL(pageUrl);
      const probe = ctx.canonicalTarget;
      if (probe.status === 'ok' && (probe.value.status >= 400 || probe.value.redirects.length > 0)) {
        const broken = probe.value.status >= 400;
        issues.push({
          code: broken ? 'CANONICAL_TARGET_BROKEN' : 'CANONICAL_TARGET_REDIRECTS', scope: 'page', url: pageUrl,
          severity: broken ? 'high' : 'medium', impact: broken ? 'SEO i lartë' : 'SEO mesatar', impactLevel: broken ? 'high' : 'medium', effort: 'low',
          message: broken ? `Canonical tregon URL që kthen HTTP ${probe.value.status}` : 'Canonical tregon URL që ridrejton',
          whyItMatters: 'Canonical duhet të tregojë një URL përfundimtare 200; përndryshe sinjali injorohet.',
          fix: `Vendos canonical te URL-ja përfundimtare (${probe.value.finalUrl}) ose te vetë faqja.`,
          evidence: [
            ...evidenceAll,
            {
              type: 'http', url: target,
              detected: `HTTP ${probe.value.status}${probe.value.redirects.length ? `; ridrejtime: ${probe.value.redirects.map((r) => `${r.status}→${r.location}`).join(', ')}` : ''}`,
              expected: 'HTTP 200 pa ridrejtim',
            },
          ],
        });
      } else if (t.protocol !== p.protocol || t.host !== p.host) {
        issues.push({
          code: t.host !== p.host ? 'CANONICAL_CROSS_HOST' : 'CANONICAL_PROTOCOL_MISMATCH', scope: 'page', url: pageUrl,
          severity: 'medium', impact: 'SEO mesatar', impactLevel: 'medium', effort: 'low',
          confidence: t.host !== p.host ? 0.6 : 0.9, // cross-domain mund të jetë qëllimisht
          message: `Canonical tregon ${t.origin}, faqja shërbehet në ${p.origin}`,
          whyItMatters: 'Konflikt mes URL-së së shërbyer dhe asaj kanonike (http/https ose www/pa-www). Mund të jetë qëllimisht, por shpesh mbetje migrimi.',
          fix: `Unifiko: ose canonical → ${pageUrl}, ose ridrejto 301 faqen te ${target}.`,
          evidence: evidenceAll,
        });
      } else {
        issues.push({
          code: 'CANONICAL_POINTS_ELSEWHERE', scope: 'page', url: pageUrl, severity: 'low', impact: 'SEO i ulët/mesatar', impactLevel: 'medium', effort: 'low',
          confidence: 0.6,
          message: `Canonical i faqes hyrëse tregon ${t.pathname}${t.search}`,
          whyItMatters: 'Faqja hyrëse që kanonikalizon te faqe tjetër zakonisht është gabim template-i; nëse është qëllimisht, injoroje.',
          fix: `Verifiko qëllimin; zakonisht canonical i faqes hyrëse duhet të jetë ${pageUrl}.`,
          evidence: evidenceAll,
        });
      }
      if (probe.status === 'error') m.limitations.push(`Target i canonical (${target}) s'u verifikua: ${probe.error}`);
    }
  }
  m.check('canonical', 'Canonical', 2, issues, issues.length ? undefined : [`Canonical: ${resolved[0]}`]);
}
