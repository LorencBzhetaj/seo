import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import { normalizeUrl } from '../../crawler/url-rules.js';
import { ModuleBuilder } from '../helpers.js';
import { analyzedPages, crawlCoverage, crawlUnavailable, type AnalyzedPage } from './common.js';

/** BCP 47 i thjeshtuar siç e pranon Google për hreflang: gjuhë[-Shkrim][-Rajon] ose x-default. */
const HREFLANG_CODE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

const key = (u: string) => normalizeUrl(u).replace(/\/$/, '');
const primary = (lang: string) => lang.toLowerCase().split('-')[0]!;

function evidence(list: { p: AnalyzedPage; detected: string; expected?: string }[]) {
  return list.slice(0, 5).map((x) => ({ type: 'dom' as const, url: x.p.finalUrl, detected: x.detected, expected: x.expected }));
}

/**
 * i18n aplikohet vetëm kur siti ka hreflang ose faqe në gjuhë të ndryshme.
 * Kontrollet bëhen vetëm mbi faqet e kontrolluara nga crawl-i; target-et jashtë tyre s'verifikohen.
 */
export function runI18n(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('i18n', 'i18n');
  const unavailable = crawlUnavailable(ctx);
  if (unavailable || ctx.crawl.status !== 'ok') {
    m.skip('i18n', 'i18n', 1, unavailable ?? 'Pa crawl');
    return m.build({ score: null, reason: unavailable });
  }
  const crawl = ctx.crawl.value;
  const pages = analyzedPages(crawl).filter((p) => p.access === 'ok' && !p.sameAs);
  const withHreflang = pages.filter((p) => p.page.hreflang.length > 0);
  const langs = new Set(pages.map((p) => p.page.lang && primary(p.page.lang)).filter((l): l is string => !!l));

  if (withHreflang.length === 0) {
    if (langs.size <= 1) {
      m.notApplicable('i18n', 'i18n', `Siti duket njëgjuhësh (lang: ${[...langs].join(', ') || 'mungon'}; pa hreflang) në ${pages.length} faqet e kontrolluara`);
      return m.build({ score: null, reason: 'Nuk aplikohet: pa hreflang dhe një gjuhë e vetme' });
    }
    const byLang = [...langs].map((l) => ({ l, p: pages.find((p) => p.page.lang && primary(p.page.lang) === l)! }));
    m.check('hreflang-present', 'hreflang për variantet gjuhësore', 1, [{
      code: 'MULTILINGUAL_WITHOUT_HREFLANG', scope: 'site', url: byLang[0]!.p.finalUrl, affectedPages: byLang.map((x) => x.p.finalUrl),
      severity: 'low', impact: 'SEO ndërkombëtar', impactLevel: 'medium', effort: 'medium', confidence: 0.6,
      message: `Faqe në ${langs.size} gjuhë (${[...langs].join(', ')}) pa hreflang`,
      whyItMatters: 'Nëse faqet janë përkthime të njëra-tjetrës, hreflang i ndihmon motorët të shfaqin versionin e duhur për çdo gjuhë.',
      fix: 'Nëse janë përkthime, lidhi me <link rel="alternate" hreflang="…"> reciprok; nëse jo, s\'duhet asgjë.',
      evidence: evidence(byLang.map((x) => ({ p: x.p, detected: `<html lang="${x.p.page.lang}">` }))),
    }]);
    return m.build({ coverage: crawlCoverage(crawl, pages.length) });
  }

  const byKey = new Map<string, AnalyzedPage>(pages.map((p) => [key(p.finalUrl), p]));
  const allByKey = new Map(crawl.pages.map((p) => [key(p.url), p]));

  const invalid: { p: AnalyzedPage; detected: string; expected?: string }[] = [];
  const noSelf: { p: AnalyzedPage; detected: string; expected?: string }[] = [];
  const notReciprocal: { p: AnalyzedPage; detected: string; expected?: string }[] = [];
  const badTarget: { p: AnalyzedPage; detected: string; expected?: string }[] = [];
  const langMismatch: { p: AnalyzedPage; detected: string; expected?: string }[] = [];
  let unverified = 0;

  for (const p of withHreflang) {
    const self = key(p.finalUrl);
    for (const h of p.page.hreflang) {
      if (!HREFLANG_CODE.test(h.lang)) invalid.push({ p, detected: h.snippet, expected: 'p.sh. hreflang="sq", "en-GB" ose "x-default"' });
    }
    if (!p.page.hreflang.some((h) => h.resolved && key(h.resolved) === self)) {
      noSelf.push({ p, detected: `${p.page.hreflang.length} hreflang, asnjë drejt vetë faqes`, expected: `<link rel="alternate" hreflang="${p.page.lang ?? '…'}" href="${p.finalUrl}">` });
    }
    for (const h of p.page.hreflang) {
      if (!h.resolved || h.lang.toLowerCase() === 'x-default' || key(h.resolved) === self) continue;
      const t = byKey.get(key(h.resolved));
      const raw = allByKey.get(key(h.resolved));
      if (!t) {
        if (raw && (raw.access === 'http-error' || raw.redirects.length > 0)) {
          badTarget.push({ p, detected: `${h.snippet} → ${raw.access === 'http-error' ? `HTTP ${raw.status}` : `ridrejton te ${raw.finalUrl}`}`, expected: 'Target 200 pa ridrejtim' });
        } else unverified++;
        continue;
      }
      if (!t.page.hreflang.some((b) => b.resolved && key(b.resolved) === self)) {
        notReciprocal.push({ p, detected: `${h.snippet} — ${t.finalUrl} s'lidh mbrapsht te ${p.finalUrl}`, expected: 'hreflang reciprok në të dyja faqet' });
      }
      if (t.page.lang && primary(t.page.lang) !== primary(h.lang)) {
        langMismatch.push({ p: t, detected: `Shpallur si hreflang="${h.lang}" nga ${p.finalUrl}, por <html lang="${t.page.lang}">` });
      }
    }
  }

  const issue = (code: string, list: typeof invalid, sev: IssueDraft['severity'], message: string, why: string, fix: string, confidence = 1): IssueDraft[] =>
    list.length
      ? [{ code, scope: 'site', url: list[0]!.p.finalUrl, affectedPages: [...new Set(list.map((x) => x.p.finalUrl))], severity: sev,
          impact: 'SEO ndërkombëtar', impactLevel: sev === 'medium' ? 'medium' : 'low', effort: 'low', confidence,
          message: `${new Set(list.map((x) => x.p.finalUrl)).size} faqe: ${message}`, whyItMatters: why, fix, evidence: evidence(list) }]
      : [];

  m.check('hreflang-codes', 'Kodet hreflang', 1, issue('HREFLANG_INVALID_CODE', invalid, 'medium', 'kode hreflang të pavlefshme',
    'Google i injoron anotimet me kod gjuhe/rajoni të pavlefshëm.', 'Përdor ISO 639-1 për gjuhën dhe ISO 3166-1 alpha-2 për rajonin (p.sh. "en-GB", jo "en-UK").'));
  m.check('hreflang-reciprocal', 'hreflang reciprok', 2, [
    ...issue('HREFLANG_NOT_RECIPROCAL', notReciprocal, 'medium', 'hreflang pa lidhje kthyese',
      'Pa lidhje kthyese, Google mund t\'i injorojë anotimet hreflang.', 'Çdo variant duhet të listojë të gjithë variantet e tjera, edhe veten.'),
    ...issue('HREFLANG_TARGET_NOT_OK', badTarget, 'medium', 'hreflang drejt URL-sh që kthejnë gabim ose ridrejtojnë',
      'hreflang duhet të tregojë URL përfundimtare 200.', 'Përditëso href-in te URL-ja përfundimtare.'),
  ]);
  m.check('hreflang-self', 'hreflang drejt vetes', 0.5, issue('HREFLANG_NO_SELF_REFERENCE', noSelf, 'low', 'pa hreflang drejt vetes',
    'Google rekomandon që grupi hreflang të përfshijë edhe vetë faqen.', 'Shto hreflang edhe për URL-në e vetë faqes.'));
  m.check('hreflang-lang', 'hreflang ↔ html lang', 0.5, issue('HREFLANG_LANG_MISMATCH', langMismatch, 'low', 'gjuha e shpallur në hreflang ≠ <html lang>',
    'Sinjale kontradiktore gjuhe; mund të jetë gabim template-i ose përkthim i paplotë.', 'Unifiko lang-un e template-it me gjuhën reale të faqes.', 0.7));

  if (!withHreflang.some((p) => p.page.hreflang.some((h) => h.lang.toLowerCase() === 'x-default'))) {
    m.info('x-default', 'x-default', ['Asnjë hreflang="x-default" — opsional; rekomandohet kur ka faqe zgjedhjeje gjuhe ose version parazgjedhje.']);
  }
  if (unverified) m.limitations.push(`i18n: ${unverified} target-e hreflang jashtë faqeve të kontrolluara s'u verifikuan.`);
  return m.build({ coverage: crawlCoverage(crawl, withHreflang.length) });
}
