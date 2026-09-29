import type { AuditContext } from '../../core/context.js';
import type { AuditResult, Evidence, IssueDraft } from '../../core/schemas.js';
import { isUrlVariant, normalizeUrl } from '../../crawler/url-rules.js';
import { jaccard, removeBoilerplate, shingles, textHash, tokenize } from '../../intelligence/similarity.js';
import { ModuleBuilder } from '../helpers.js';
import { canonicalElsewhere } from './sitemap.js';
import { analyzedPages, crawlCoverage, crawlUnavailable, type AnalyzedPage } from './common.js';

/** Pragjet konservative për "përmbajtje shumë e ngjashme". */
const NEAR_DUP_JACCARD = 0.9;
const PROVEN_JACCARD = 0.98;
const MIN_WORDS = 80;
const MIN_DISTINCT_SHINGLES = 40;
const MAX_GROUP_ISSUES = 10;

const stripSlash = (u: string) => u.replace(/\/$/, '');
const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

function groupBy<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

function sharedTemplate(pages: AnalyzedPage[]): boolean {
  return pages.length >= 3 && new Set(pages.map((p) => p.page.templateKey)).size === 1;
}

/** Klasterë faqesh shumë të ngjashme (union-find mbi çiftet me Jaccard ≥ prag). */
function similarClusters(pages: AnalyzedPage[]) {
  const eligible = pages.filter((p) => p.page.wordCount >= MIN_WORDS);
  const raw = new Map(eligible.map((p) => [p.finalUrl, shingles(tokenize(p.page.mainText))]));
  const sets = removeBoilerplate(raw);
  const urls = [...sets.keys()].filter((u) => sets.get(u)!.size >= MIN_DISTINCT_SHINGLES);
  const parent = new Map(urls.map((u) => [u, u]));
  const find = (u: string): string => (parent.get(u) === u ? u : find(parent.get(u)!));
  const pairScores = new Map<string, number>();
  for (let i = 0; i < urls.length; i++) {
    for (let j = i + 1; j < urls.length; j++) {
      const s = jaccard(sets.get(urls[i]!)!, sets.get(urls[j]!)!);
      if (s >= NEAR_DUP_JACCARD) {
        parent.set(find(urls[i]!), find(urls[j]!));
        pairScores.set(`${urls[i]}|${urls[j]}`, s);
      }
    }
  }
  const clusters = groupBy(urls, (u) => find(u));
  const byUrl = new Map(pages.map((p) => [p.finalUrl, p]));
  return [...clusters.values()]
    .filter((c) => c.length >= 2)
    .map((c) => {
      const members = c.map((u) => byUrl.get(u)!);
      const scores = [...pairScores].filter(([k]) => c.some((u) => k.startsWith(`${u}|`))).map(([, v]) => v);
      const hashes = new Set(members.map((p) => textHash(p.page.mainText)));
      const titles = new Set(members.map((p) => normTitle(p.page.titles[0] ?? '')));
      const variants = members.every((p) => members.every((q) => p === q || isUrlVariant(p.finalUrl, q.finalUrl)));
      const minJ = Math.min(...scores);
      const exact = hashes.size === 1;
      const sameTitle = titles.size === 1;
      return {
        members,
        minJaccard: minJ,
        exact,
        sameTitle,
        variants,
        // Dyfishim i provuar: dy matje të pavarura (hash i tekstit + ngjashmëri pas heqjes së template-it) + një sinjal URL/titulli.
        proven: exact && minJ >= PROVEN_JACCARD && (variants || sameTitle),
        // Rrumbullakim: 0.5 + 0.2 + 0.1 + 0.1 në float = 0.8999…, që s'duhet të bjerë nën pragjet.
        confidence: Math.round(Math.min(0.9, 0.5 + (exact ? 0.2 : 0) + (sameTitle ? 0.1 : 0) + (variants ? 0.1 : 0)) * 100) / 100,
      };
    });
}

export function runDuplicates(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('duplicates', 'duplicates');
  const unavailable = crawlUnavailable(ctx);
  if (unavailable || ctx.crawl.status !== 'ok') {
    m.skip('duplicates', 'Dyfishime', 2, unavailable ?? 'Pa crawl');
    return m.build({ score: null, reason: unavailable });
  }
  const crawl = ctx.crawl.value;
  const pages = analyzedPages(crawl).filter((p) => p.access === 'ok' && !p.sameAs);
  if (pages.length < 2) {
    m.skip('duplicates', 'Dyfishime', 2, `Duhen ≥ 2 faqe HTML të analizuara; u analizuan ${pages.length}`);
    return m.build({ score: null, coverage: crawlCoverage(crawl, pages.length) });
  }
  // Faqet që deklarojnë vetë canonical tjetër ose noindex s'numërohen si dyfishime titujsh/përshkrimesh.
  const candidates = pages.filter((p) => !p.page.noindex && !canonicalElsewhere(p));

  const metaGroups = (code: string, label: string, severity: IssueDraft['severity'], pick: (p: AnalyzedPage) => string | undefined, fix: string): IssueDraft[] => {
    const groups = [...groupBy(candidates, (p) => {
      const v = pick(p);
      return v ? normTitle(v) : undefined;
    }).values()].filter((g) => g.length >= 2);
    const drafts: IssueDraft[] = groups.map((g) => ({
      code, scope: sharedTemplate(g) ? 'template' : 'page', url: g[0]!.finalUrl, affectedPages: g.map((p) => p.finalUrl),
      severity, impact: 'SEO (dallimi i faqeve në rezultate)', impactLevel: severity === 'medium' ? 'medium' : 'low', effort: 'low',
      message: `${g.length} faqe kanë të njëjtin ${label}: "${(pick(g[0]!) ?? '').slice(0, 60)}"${sharedTemplate(g) ? ' (i njëjti template)' : ''}`,
      whyItMatters: `Kur ${label} është i njëjtë, motorët e kërkimit dhe përdoruesit s'i dallojnë dot faqet.`,
      fix,
      evidence: g.slice(0, 5).map((p) => ({ type: 'dom' as const, url: p.finalUrl, detected: `${label}: "${(pick(p) ?? '').slice(0, 100)}"` })),
    }));
    if (drafts.length > MAX_GROUP_ISSUES) {
      const rest = drafts.splice(MAX_GROUP_ISSUES);
      drafts.push({ ...rest[0]!, scope: 'site', affectedPages: rest.flatMap((d) => d.affectedPages ?? []), message: `${rest.length} grupe të tjera me ${label} të njëjtë`, evidence: rest.slice(0, 5).map((d) => d.evidence[0]!) });
    }
    return drafts;
  };

  m.check('duplicate-titles', 'Tituj të dyfishtë', 2,
    metaGroups('DUPLICATE_TITLES', 'titull', 'medium', (p) => p.page.titles[0], 'Shkruaj titull unik për secilën faqe (tema e faqes + emri i sitit). Nëse titulli vjen nga template-i, përdor titullin e faqes/postimit.'));
  m.check('duplicate-descriptions', 'Meta description të dyfishta', 1,
    metaGroups('DUPLICATE_META_DESCRIPTIONS', 'meta description', 'low', (p) => p.page.metaDescriptions[0], 'Shkruaj përshkrim unik për faqet kryesore, ose hiqe atë të përbashkët që Google të gjenerojë snippet nga faqja.'));

  // --- Përmbajtje shumë e ngjashme: sinjale të kombinuara, jo përfundim nga një hash ---
  const clusters = similarClusters(candidates);
  const contentIssues: IssueDraft[] = clusters.map((c) => {
    const signals = [
      `Jaccard ≥ ${c.minJaccard.toFixed(2)} (shingle ${5}-fjalëshe, pa tekstin e përbashkët të template-it)`,
      `hash i tekstit: ${c.exact ? 'i njëjtë' : 'ndryshon'}`,
      `titull: ${c.sameTitle ? 'i njëjtë' : 'ndryshon'}`,
      `URL: ${c.variants ? 'variante të së njëjtës adresë' : 'të ndryshme'}`,
    ].join('; ');
    return {
      code: c.proven ? 'DUPLICATE_CONTENT_PROVEN' : 'SIMILAR_CONTENT_POSSIBLE',
      scope: 'page', url: c.members[0]!.finalUrl, affectedPages: c.members.map((p) => p.finalUrl),
      severity: c.proven ? 'medium' : 'low', impact: 'SEO (kanibalizim/dyfishim)', impactLevel: c.proven ? 'medium' : 'low', effort: 'medium',
      confidence: c.confidence,
      message: c.proven
        ? `${c.members.length} URL shërbejnë të njëjtën përmbajtje`
        : `${c.members.length} faqe me përmbajtje shumë të ngjashme — kërkon verifikim`,
      whyItMatters: c.proven
        ? 'E njëjta përmbajtje në disa URL e ndan sinjalin mes tyre; motori zgjedh vetë cilën të tregojë.'
        : 'Ngjashmëria e lartë mund të jetë e qëllimshme (p.sh. variante produkti); vetëm sinjalet s\'e provojnë dyfishimin.',
      fix: c.proven
        ? 'Zgjidh një URL kanonike: ridrejto 301 variantet ose vendos <link rel="canonical"> te të gjitha drejt saj.'
        : 'Krahaso faqet manualisht; nëse janë vërtet të njëjta, bashkoji ose përdor canonical; përndryshe shto përmbajtje dalluese.',
      evidence: [
        { type: 'crawl', url: c.members[0]!.finalUrl, detected: `Sinjale: ${signals}` },
        ...c.members.slice(0, 4).map((p) => ({ type: 'dom' as const, url: p.finalUrl, detected: `${p.page.wordCount} fjalë; titull "${(p.page.titles[0] ?? '').slice(0, 60)}"` })),
      ],
    };
  });
  m.check('similar-content', 'Përmbajtje shumë e ngjashme', 1, contentIssues, [
    `${candidates.filter((p) => p.page.wordCount >= MIN_WORDS).length} faqe me ≥ ${MIN_WORDS} fjalë u krahasuan; ${clusters.length} grup(e) mbi pragun ${NEAR_DUP_JACCARD}`,
  ]);

  // --- Canonical: vlerësim vetëm mbi dyfishime të provuara + target-e të kontrolluara ---
  const byKey = new Map<string, (typeof crawl.pages)[number]>();
  for (const p of crawl.pages) {
    byKey.set(stripSlash(p.url), p);
    if (p.finalUrl) byKey.set(stripSlash(normalizeUrl(p.finalUrl)), p);
  }
  const canonicalOf = (p: AnalyzedPage) => {
    const t = [...new Set(p.page.canonicals.map((c) => c.resolved).filter((u): u is string => !!u))];
    return t.length === 1 ? stripSlash(normalizeUrl(t[0]!)) : t.length === 0 ? 'mungon' : `konflikt (${t.length})`;
  };
  const canonicalIssues: IssueDraft[] = [];
  const obs: string[] = [];
  for (const c of clusters.filter((x) => x.proven)) {
    const values = c.members.map(canonicalOf);
    const consistent = new Set(values).size === 1 && values[0] !== 'mungon' && !values[0]!.startsWith('konflikt');
    if (consistent) {
      obs.push(`Dyfishim i provuar me canonical të qëndrueshëm → ${values[0]}`);
      continue;
    }
    canonicalIssues.push({
      code: 'DUPLICATES_WITHOUT_CONSISTENT_CANONICAL', scope: 'page', url: c.members[0]!.finalUrl, affectedPages: c.members.map((p) => p.finalUrl),
      severity: 'medium', impact: 'SEO (URL kanonike e paqartë)', impactLevel: 'medium', effort: 'low', confidence: c.confidence,
      message: `${c.members.length} URL me të njëjtën përmbajtje s'tregojnë të njëjtin canonical`,
      whyItMatters: 'Për URL të dyfishta të provuara, canonical i qëndrueshëm (ose 301) i tregon motorit cilën të indeksojë.',
      fix: 'Vendos te të gjitha të njëjtin <link rel="canonical"> drejt URL-së së preferuar, ose ridrejto 301 variantet.',
      evidence: c.members.slice(0, 5).map((p) => ({ type: 'dom' as const, url: p.finalUrl, detected: `canonical: ${canonicalOf(p)}` })),
    });
  }
  // Target-e canonical që crawl-i i kontrolloi realisht
  const pointing = pages.filter((p) => canonicalElsewhere(p));
  const badTarget = pointing
    .map((p) => ({ p, target: canonicalElsewhere(p)!, t: byKey.get(stripSlash(normalizeUrl(canonicalElsewhere(p)!))) }))
    .filter((x) => x.t && (x.t.access === 'http-error' || x.t.page?.noindex || (x.t.redirects.length > 0 && x.t.access === 'ok')));
  if (badTarget.length) {
    canonicalIssues.push({
      code: 'CANONICAL_TARGET_NOT_INDEXABLE', scope: 'site', url: badTarget[0]!.p.finalUrl, affectedPages: badTarget.map((x) => x.p.finalUrl),
      severity: 'medium', impact: 'SEO', impactLevel: 'medium', effort: 'low',
      message: `${badTarget.length} faqe kanë canonical drejt URL-sh që kthejnë gabim, ridrejtojnë ose kanë noindex`,
      whyItMatters: 'Canonical duhet të tregojë një URL 200 të indeksueshme; përndryshe sinjali injorohet.',
      fix: 'Drejtoje canonical-in te URL-ja përfundimtare 200 pa noindex.',
      evidence: badTarget.slice(0, 5).map((x): Evidence => ({
        type: 'crawl', url: x.p.finalUrl,
        detected: `canonical → ${x.target}: ${x.t!.access === 'http-error' ? `HTTP ${x.t!.status}` : x.t!.page?.noindex ? 'noindex' : `ridrejton te ${x.t!.finalUrl}`}`,
      })),
    });
  }
  const noCanonical = pages.filter((p) => p.page.canonicals.length === 0).length;
  if (noCanonical) obs.push(`${noCanonical} faqe pa canonical — s'llogaritet problem pa prova URL-sh të dyfishta.`);
  const unverifiedTargets = pointing.filter((p) => !byKey.has(stripSlash(normalizeUrl(canonicalElsewhere(p)!)))).length;
  if (unverifiedTargets) m.limitations.push(`Canonical: ${unverifiedTargets} target-e jashtë faqeve të kontrolluara s'u verifikuan.`);
  m.check('canonical', 'Canonical mbi dyfishime të provuara', 2, canonicalIssues, obs.length ? obs : undefined);

  m.limitations.push(`Dyfishimet: krahasim vetëm mes ${pages.length} faqeve të kontrolluara; faqet jashtë kufijve të crawl-it s'përfshihen.`);
  return m.build({ coverage: crawlCoverage(crawl, pages.length) });
}
