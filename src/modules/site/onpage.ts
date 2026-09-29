import type { AuditContext } from '../../core/context.js';
import type { AuditResult } from '../../core/schemas.js';
import { ModuleBuilder } from '../helpers.js';
import { analyzedPages, crawlCoverage, crawlUnavailable, groupByTemplate, type AnalyzedPage, type Occurrence } from './common.js';

const TITLE_MIN = 10;
const TITLE_MAX = 60;
/** Nën këtë numër fjalësh në përmbajtjen kryesore: sinjal "thin content" (i pasigurt). */
const THIN_WORDS = 100;

const occ = (p: AnalyzedPage, detected: string, expected?: string): Occurrence => ({ url: p.finalUrl, templateKey: p.page.templateKey, detected, expected });

/**
 * SEO on-page për faqet e crawl-it PËRVEÇ faqes hyrëse (ajo vlerësohet nga MVP-1).
 * Problemet e njëjta bashkohen sipas template-it.
 */
export function runOnPage(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('onpage', 'contentSeo');
  const unavailable = crawlUnavailable(ctx);
  if (unavailable || ctx.crawl.status !== 'ok') {
    m.skip('onpage', 'SEO on-page', 2, unavailable ?? 'Pa crawl');
    return m.build({ score: null, reason: unavailable });
  }
  const crawl = ctx.crawl.value;
  const all = analyzedPages(crawl).filter((p) => p.source !== 'homepage' && p.access === 'ok' && !p.sameAs);
  const noindex = all.filter((p) => p.page.noindex);
  const pages = all.filter((p) => !p.page.noindex);
  if (noindex.length) m.limitations.push(`On-page: ${noindex.length} faqe me noindex u përjashtuan (s'synojnë indeksim).`);
  if (pages.length === 0) {
    m.skip('onpage', 'SEO on-page', 2, `Asnjë faqe e indeksueshme përtej hyrëses u analizua (${all.length} gjithsej)`);
    return m.build({ score: null, coverage: crawlCoverage(crawl, 0) });
  }

  // --- Title ---
  const missingTitle = pages.filter((p) => !p.page.titles[0]);
  const badLength = pages.filter((p) => p.page.titles[0] && (p.page.titles[0].length < TITLE_MIN || p.page.titles[0].length > TITLE_MAX));
  m.check('title', '<title>', 3, [
    ...groupByTemplate(
      { code: 'MISSING_TITLE', severity: 'high', impact: 'SEO i lartë', impactLevel: 'high', effort: 'low',
        whyItMatters: 'Titulli është sinjali kryesor on-page dhe teksti i klikueshëm në rezultate.', fix: 'Shto <title> unik dhe përshkrues për çdo faqe (ose rregullo template-in që e gjeneron).' },
      (n) => `${n} faqe pa <title>`,
      missingTitle.map((p) => occ(p, 'Nuk u gjet <title>', '<title>Tema e faqes — Emri</title>')),
    ),
    ...groupByTemplate(
      { code: 'TITLE_LENGTH', severity: 'low', impact: 'SEO i ulët (CTR)', impactLevel: 'low', effort: 'low', confidence: 0.8,
        whyItMatters: 'Titujt shumë të gjatë priten në rezultate; shumë të shkurtrit rrallë e përshkruajnë faqen.', fix: `Përshtate titullin rreth ${TITLE_MIN}–${TITLE_MAX} karaktere (kufiri real është në piksel).` },
      (n) => `${n} faqe me titull jashtë ${TITLE_MIN}–${TITLE_MAX} karaktereve`,
      badLength.map((p) => occ(p, `"${p.page.titles[0]!.slice(0, 90)}" (${p.page.titles[0]!.length} kar.)`)),
    ),
  ]);

  // --- Meta description ---
  const noDesc = pages.filter((p) => !p.page.metaDescriptions[0]);
  m.check('meta-description', 'Meta description', 2, groupByTemplate(
    { code: 'MISSING_META_DESCRIPTION', severity: 'medium', impact: 'SEO (snippet/CTR)', impactLevel: 'medium', effort: 'low',
      whyItMatters: 'Pa description, Google gjeneron vetë snippet — shpesh më pak bindës. S\'ndikon drejtpërdrejt në renditje.', fix: 'Shto meta description unike (≈ 70–160 karaktere) në faqet kryesore; plugin-et SEO e lejojnë për template.' },
    (n) => `${n} faqe pa meta description`,
    noDesc.map((p) => occ(p, 'Nuk u gjet <meta name="description">')),
  ));

  // --- H1 / hierarkia ---
  const noH1 = pages.filter((p) => p.page.h1s.filter(Boolean).length === 0);
  const multiH1 = pages.filter((p) => p.page.h1s.length > 1);
  const skips = pages
    .map((p) => {
      const lv = p.page.headings.map((h) => h.level);
      const i = lv.findIndex((l, idx) => idx > 0 && l - lv[idx - 1]! > 1);
      return i > 0 ? { p, from: lv[i - 1]!, to: lv[i]!, text: p.page.headings[i]!.text } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  m.check('headings', 'H1 dhe hierarkia e titujve', 2, [
    ...groupByTemplate(
      { code: 'MISSING_H1', severity: 'medium', impact: 'SEO/Accessibility', impactLevel: 'medium', effort: 'low', confidence: 0.85,
        whyItMatters: 'H1 përmbledh temën e faqes për përdoruesit, lexuesit e ekranit dhe motorët.', fix: 'Shto një <h1> me temën e faqes; nëse renderohet me JS, verifikoje në browser.' },
      (n) => `${n} faqe pa H1 në HTML-në e shërbyer`,
      noH1.filter((p) => p.page.iframes.length === 0).map((p) => occ(p, 'Asnjë <h1> me tekst në HTML-në fillestare')),
    ),
    // Përmbajtja kryesore në iframe: kontrolli vlen vetëm për HTML-në e faqes prind.
    ...groupByTemplate(
      { code: 'MISSING_H1', severity: 'medium', impact: 'SEO/Accessibility', impactLevel: 'medium', effort: 'low', confidence: 0.6,
        whyItMatters: 'Faqja prind s\'ka H1. Përmbajtja kryesore duket brenda një iframe, që nuk analizohet dhe zakonisht s\'i atribuohet faqes prind nga motorët e kërkimit.',
        fix: 'Verifiko në browser. Nëse faqja duhet të renditet vetë, shto në faqen prind H1 dhe tekst përshkrues (jo vetëm iframe).' },
      (n) => `${n} faqe pa H1 në HTML-në prind — përmbajtja kryesore është në iframe`,
      noH1.filter((p) => p.page.iframes.length > 0).map((p) => occ(p, `Asnjë <h1> në HTML-në e faqes prind; iframe: ${p.page.iframes[0]} (përmbajtja e iframe-it s'u kontrollua)`)),
    ),
    ...groupByTemplate(
      { code: 'MULTIPLE_H1', severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'low', confidence: 0.6,
        whyItMatters: 'Disa H1 s\'janë gabim (HTML5), por shpesh tregojnë hierarki të paqartë.', fix: 'Shqyrto nëse një H1 + H2 për seksionet e bën strukturën më të qartë.' },
      (n) => `${n} faqe me më shumë se një H1`,
      multiH1.map((p) => occ(p, p.page.h1s.slice(0, 3).map((h) => `"${h.slice(0, 40)}"`).join(' | '))),
    ),
    ...groupByTemplate(
      { code: 'HEADING_LEVEL_SKIP', severity: 'low', impact: 'Accessibility/SEO i ulët', impactLevel: 'low', effort: 'low', confidence: 0.7,
        whyItMatters: 'Kërcimet në nivele (p.sh. H2 → H4) e bëjnë strukturën më të vështirë për lexuesit e ekranit.', fix: 'Përdor nivelet me radhë; stilin e madhësisë jepe me CSS, jo me nivelin e titullit.' },
      (n) => `${n} faqe me kërcim në nivelet e titujve`,
      skips.map((x) => occ(x.p, `H${x.from} → H${x.to} ("${x.text.slice(0, 50)}")`, `H${x.from} → H${x.from + 1}`)),
    ),
  ]);

  // --- Imazhe pa alt (alt="" është i vlefshëm për imazhe dekorative) ---
  const withMissingAlt = pages.filter((p) => p.page.images.missingAlt.length > 0);
  m.check('image-alt', 'Imazhe pa atributin alt', 1, groupByTemplate(
    { code: 'IMAGES_MISSING_ALT', severity: 'low', impact: 'Accessibility/SEO imazhesh', impactLevel: 'low', effort: 'low',
      whyItMatters: 'Pa alt, lexuesit e ekranit s\'e përshkruajnë imazhin dhe motorët humbasin kontekstin. (alt="" pranohet për imazhe dekorative.)', fix: 'Shto alt përshkrues për imazhet me përmbajtje dhe alt="" për ato dekorative.' },
    (n) => `${n} faqe me imazhe pa atributin alt`,
    withMissingAlt.map((p) => occ(p, `${p.page.images.missingAlt.length}/${p.page.images.total} imazhe pa alt, p.sh. ${p.page.images.missingAlt[0]!.snippet.slice(0, 120)}`)),
  ));

  // --- Thin content: sinjal i pasigurt ---
  const thin = pages.filter((p) => p.page.wordCount < THIN_WORDS);
  m.check('content-length', 'Gjatësia e përmbajtjes', 0.5, groupByTemplate(
    { code: 'THIN_CONTENT_POSSIBLE', severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'medium', confidence: 0.5,
      whyItMatters: 'Faqet me pak tekst mund të vlerësohen si pak të dobishme; për faqe kontakti/galerie kjo shpesh është normale.', fix: 'Verifiko manualisht: shto përmbajtje të dobishme ku ka kuptim, ose përdor noindex për faqe pa vlerë kërkimi.' },
    (n) => `${n} faqe me < ${THIN_WORDS} fjalë në përmbajtjen kryesore — kërkon verifikim`,
    thin.map((p) => occ(p, `${p.page.wordCount} fjalë (pa menu/header/footer)${p.page.iframes.length ? `; numërimi vlen vetëm për HTML-në e faqes prind — përmbajtja kryesore duket në iframe (${p.page.iframes[0]}), e pakontrolluar` : ''}`)),
  ));

  // --- lang ---
  const noLang = pages.filter((p) => !p.page.lang);
  m.check('html-lang', 'Atributi lang', 0.5, groupByTemplate(
    { code: 'MISSING_HTML_LANG', severity: 'low', impact: 'Accessibility/i18n', impactLevel: 'low', effort: 'low',
      whyItMatters: 'Lexuesit e ekranit përdorin lang për shqiptimin; motorët e përdorin si sinjal gjuhe.', fix: 'Shto <html lang="sq"> (ose gjuhën e faqes) në template.' },
    (n) => `${n} faqe pa <html lang>`,
    noLang.map((p) => occ(p, '<html> pa atribut lang', '<html lang="sq">')),
  ));

  m.limitations.push('On-page: HTML-ja e shërbyer (jo pas JavaScript); faqja hyrëse vlerësohet veç nga MVP-1.');
  return m.build({ coverage: crawlCoverage(crawl, pages.length) });
}
