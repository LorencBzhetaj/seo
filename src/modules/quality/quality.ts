import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import { businessPages, detectionFor } from '../../detection/index.js';
import { textPageFrom } from '../../quality/pages.js';
import { NOT_AUTHORSHIP, type QualitySignal } from '../../quality/signals.js';
import { analyzeText } from '../../quality/text.js';
import { analyzeVisual } from '../../quality/visual.js';
import { ModuleBuilder } from '../helpers.js';
import { businessCoverage, businessUnavailable, scopeLimitation } from '../business/common.js';

export const QUALITY_DISCLAIMER = `Cilësia e përmbajtjes dhe identiteti vizual: sinjale për shqyrtim njerëzor, pa score dhe jashtë Health Score-it derisa të kalibrohen. "AI slop" është vetëm emërtim i thjeshtë — ${NOT_AUTHORSHIP}`;

/** QualitySignal → IssueDraft (me URL, prova dhe screenshot-e si evidence). */
export function toIssue(s: QualitySignal): IssueDraft {
  const pages = [s.target, ...s.related];
  return {
    code: s.code,
    scope: s.related.length ? 'site' : 'page',
    url: s.target,
    affectedPages: pages,
    severity: s.severity,
    impact: s.kind === 'accessibility' ? 'Aksesueshmëria (lexues ekrani)' : 'Përshtypja e vizitorit',
    impactLevel: s.severity === 'low' ? 'low' : 'medium',
    effort: 'medium',
    confidence: s.confidence,
    message: s.message,
    whyItMatters: s.whyItMatters,
    fix: s.suggestion,
    evidence: [
      // Matjet vijnë nga DOM-i (i shërbyer ose i renderuar); screenshot-et janë evidence më vete.
      { type: 'dom', url: s.target, detected: s.evidence.join(' · ') },
      ...(s.screenshots ?? []).map((p) => ({ type: 'screenshot' as const, url: s.target, detected: `screenshot: ${p}`, raw: p })),
    ],
  };
}

/** Teksti: blloqe të përsëritura, fraza të përgjithshme, titull ↔ përmbajtje, CTA/linke pa kontekst. */
export function runContentQuality(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('content-quality', 'contentQuality');
  const unavailable = businessUnavailable(ctx);
  const pages = unavailable ? [] : businessPages(ctx);
  if (unavailable || !pages.length) {
    m.skip('content-quality', 'Cilësia e përmbajtjes', 1, unavailable ?? 'Pa HTML të analizueshëm');
    return m.build({ score: null, reason: unavailable ?? 'Pa HTML të analizueshëm' });
  }
  const types = new Map((detectionFor(ctx)?.pages ?? []).map((p) => [p.url, p.type]));
  // Faqet ligjore (privacy/terms) kanë tekst standard me qëllim: s'krahasohen.
  const text = analyzeText(pages.filter((p) => types.get(p.url) !== 'legal').map((p) => textPageFrom(p.url, p.page)));
  const bySection = (codes: string[]) => text.signals.filter((s) => codes.includes(s.code)).map(toIssue);
  m.info('repeated-text', 'Tekst i përsëritur mes faqeve (pa header/footer)', text.observations.filter((o) => !o.includes('grupe CTA')),bySection(['REPEATED_CONTENT_BLOCK']));
  m.info('generic-copy', 'Fraza të përgjithshme pa detaje konkrete', [`${pages.length} faqe të kontrolluara (≥ 80 fjalë, pa iframe)`], bySection(['GENERIC_COPY']));
  m.info('title-content', 'Titulli ↔ përmbajtja', ['Emri i markës (segmenti i përbashkët i titujve) përjashtohet para krahasimit'], bySection(['TITLE_CONTENT_MISMATCH']));
  m.info('cta-context', 'CTA/linke të përsëritura pa kontekst', ['Vetëm në përmbajtje; menu dhe footer përjashtohen', "CTA të lidhura me produkte/plane/karta ose destinacione të ndryshme s'raportohen", ...text.observations.filter((o) => o.includes('grupe CTA'))], bySection(['GENERIC_LINK_TEXT_REPEATED', 'CTA_REPEATED_ON_PAGE']));
  m.info('link-names', 'Aksesueshmëri: emri i linkeve kur lexohet veçmas (vërejtje, jo "AI slop")', ['Linke me kontekst kartë/titull, por me emër të aksesueshëm të përsëritur', "Emri llogaritet me algoritëm të thjeshtuar; s'është vlerësim përputhshmërie me WCAG"], bySection(['LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT']));
  m.limitations.push(QUALITY_DISCLAIMER, 'Cilësia e përmbajtjes: HTML i shërbyer (pa JavaScript); faqet ligjore dhe me noindex përjashtohen; versionet shqip/anglisht s\'krahasohen me njëra-tjetrën.');
  const scope = scopeLimitation(ctx, 'Cilësia e përmbajtjes');
  if (scope) m.limitations.push(scope);
  return m.build({ score: null, informational: true, reason: 'Pa score me qëllim: sinjale për shqyrtim njerëzor', coverage: businessCoverage(ctx, pages) });
}

/** Pamja: faqet e renderuara (desktop + mobile), vetëm me prova të mjaftueshme. */
export function runVisualIdentity(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('visual-identity', 'visualIdentity');
  const v = ctx.visual;
  if (!v || v.status !== 'ok') {
    const reason = !v ? 'Renderimi vizual s\'u krye' : v.status === 'error' ? `Renderimi dështoi: ${v.error}` : v.reason;
    m.skip('visual', 'Identiteti vizual (faqe të renderuara)', 1, reason);
    return m.build({ score: null, reason });
  }
  const a = analyzeVisual(v.value.captures);
  const ok = v.value.captures.filter((c) => c.status === 'ok').length;
  if (!ok) {
    m.skip('visual', 'Identiteti vizual (faqe të renderuara)', 1, `Asnjë pamje s'u renderua: ${v.value.captures.map((c) => c.reason).filter(Boolean).slice(0, 2).join('; ')}`);
    return m.build({ score: null, reason: 'Asnjë pamje s\'u renderua' });
  }
  const pick = (codes: string[]) => a.signals.filter((s) => codes.includes(s.code)).map(toIssue);
  m.info('rendering', 'Renderimi (desktop 1366×900 + mobile 390×844)', [...a.observations, `Screenshot-e: ${v.value.screenshotsDir}/ (lokale, jashtë Git)`]);
  m.info('mobile-layout', 'Mobile: tejkalim horizontal', [], pick(['MOBILE_HORIZONTAL_OVERFLOW']));
  m.info('imagery', 'Imazhe placeholder/stock, hero i përsëritur', [], pick(['PLACEHOLDER_IMAGE', 'STOCK_OR_DEMO_IMAGERY', 'REPEATED_HERO_IMAGE']));
  m.info('patterns', 'Karta, gradientë dhe struktura e seksioneve', ['Një gradient, një grup kartash ose një shabllon i zakonshëm më vete s\'raportohen'], pick(['UNIFORM_ICON_CARDS', 'GRADIENT_HEAVY', 'IDENTICAL_SECTION_LAYOUT']));
  const skipped = v.value.captures.filter((c) => c.status === 'skipped');
  if (skipped.length) m.skip('visual-partial', 'Pamje që s\'u renderuan', 0.1, `${skipped.length} pamje skipped: ${skipped.slice(0, 2).map((c) => `${c.viewport} ${c.url} (${c.reason})`).join('; ')}`);
  m.limitations.push(
    QUALITY_DISCLAIMER,
    `Identiteti vizual: vetëm ${new Set(v.value.captures.map((c) => c.url)).size} faqe përfaqësuese, desktop + mobile, deri në ${v.value.limits.maxScreenshotHeight}px; faqet e tjera s'u renderuan.`,
    'Identiteti vizual: matje nga DOM-i i renderuar (struktura, stilet, imazhet); s\'ka gjykim estetik automatik dhe s\'përdoret AI/vision.',
  );
  return m.build({ score: null, informational: true, reason: 'Pa score me qëllim: sinjale për shqyrtim njerëzor', coverage: { checked: ok, discovered: v.value.captures.length, truncated: skipped.length > 0 } });
}
