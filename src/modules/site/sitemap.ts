import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import type { CrawledPage } from '../../crawler/crawler.js';
import { normalizeUrl } from '../../crawler/url-rules.js';
import { ModuleBuilder } from '../helpers.js';
import { crawlUnavailable } from './common.js';

const stripSlash = (u: string) => u.replace(/\/$/, '');

/** Canonical i vetëm që tregon URL tjetër nga ajo e shërbyer (null kur mungon/tregon vetveten/konflikt). */
export function canonicalElsewhere(p: CrawledPage): string | null {
  const targets = [...new Set((p.page?.canonicals ?? []).map((c) => c.resolved).filter((u): u is string => !!u))];
  if (targets.length !== 1 || !p.finalUrl) return null;
  return stripSlash(normalizeUrl(targets[0]!)) === stripSlash(normalizeUrl(p.finalUrl)) ? null : targets[0]!;
}

export function runSitemap(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('sitemap', 'sitemap');
  const unavailable = crawlUnavailable(ctx) ?? (ctx.sitemaps.status !== 'ok' ? (ctx.sitemaps.status === 'error' ? ctx.sitemaps.error : ctx.sitemaps.reason) : undefined);
  if (unavailable || ctx.sitemaps.status !== 'ok' || ctx.crawl.status !== 'ok') {
    m.skip('sitemap', 'Sitemap', 2, unavailable ?? 'Pa të dhëna');
    return m.build({ score: null, reason: unavailable });
  }
  const sm = ctx.sitemaps.value;
  const crawl = ctx.crawl.value;

  if (sm.discoveredVia === 'none') {
    m.info('sitemap-found', 'Sitemap', [
      `Nuk u gjet sitemap: robots.txt s'deklaron asnjë dhe ${sm.triedDefaults.map((u) => new URL(u).pathname).join(', ')} s'kthyen XML. Për site të vogla me linke të mira s'është domosdoshmëri.`,
    ]);
    return m.build({ score: null, reason: 'Nuk u gjet sitemap; s\'ka çfarë të vlerësohet' });
  }

  // --- Skedarët ---
  const broken = sm.files.filter((f) => f.kind === 'invalid' || f.kind === 'unavailable');
  const fileIssues: IssueDraft[] = broken.map((f) => ({
    code: f.kind === 'invalid' ? 'SITEMAP_INVALID' : 'SITEMAP_UNAVAILABLE',
    scope: 'site', url: f.url, severity: 'medium', impact: 'SEO (zbulimi i faqeve)', impactLevel: 'medium', effort: 'low',
    confidence: f.status !== undefined && f.status >= 500 ? 0.8 : 1,
    message: f.kind === 'invalid' ? `Sitemap i pavlefshëm: ${f.url}` : `Sitemap i deklaruar s'lexohet: ${f.url}`,
    whyItMatters: 'Motorët e kërkimit s\'mund t\'i përdorin URL-të e një sitemap-i që s\'lexohet ose s\'është XML i vlefshëm.',
    fix: f.kind === 'invalid' ? 'Kontrollo gjeneruesin e sitemap-it (plugin SEO); duhet të kthejë XML <urlset> ose <sitemapindex>.' : 'Rregullo URL-në në robots.txt ose sigurohu që sitemap-i shërbehet me 200.',
    evidence: [{ type: 'http', url: f.url, detected: `${f.status !== undefined ? `HTTP ${f.status}` : 'pa përgjigje'}${f.error ? `; ${f.error}` : ''} (burimi: ${f.source})`, expected: 'HTTP 200, XML i vlefshëm' }],
  }));
  m.check('sitemap-files', 'Skedarët e sitemap-it', 2, fileIssues, [
    `${sm.files.length} skedar(ë), ${sm.urls.length} URL, gjetur ${sm.discoveredVia === 'robots' ? 'nga robots.txt' : 'në vendndodhje standarde'}`,
  ]);

  const entries = sm.urls;
  m.metric({ id: 'sitemap-urls', label: 'URL në sitemap', value: entries.length, status: 'measured', source: 'sitemap' });
  if (entries.length === 0) {
    m.limitations.push('Sitemap-i s\'ka URL për të krahasuar me crawl-in.');
    return m.build();
  }

  // --- lastmod ---
  const withLastmod = entries.filter((e) => e.lastmod);
  const invalidLastmod = entries.filter((e) => e.lastmod && !e.lastmodValid);
  const future = entries.filter((e) => e.lastmodValid && Date.parse(e.lastmod!) > Date.now() + 86_400_000);
  m.metric({ id: 'lastmod-coverage', label: '% e URL-ve me <lastmod>', value: Math.round((withLastmod.length / entries.length) * 100), unit: '%', status: 'measured', source: 'sitemap' });
  const lastmodIssues: IssueDraft[] = [];
  if (invalidLastmod.length || future.length) {
    const bad = [...invalidLastmod, ...future];
    lastmodIssues.push({
      code: 'SITEMAP_INVALID_LASTMOD', scope: 'site', url: bad[0]!.sitemap, affectedPages: bad.map((e) => e.loc),
      severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'low',
      message: `${invalidLastmod.length} <lastmod> të pavlefshme dhe ${future.length} në të ardhmen`,
      whyItMatters: 'Google e injoron lastmod-in kur s\'është i besueshëm, ndaj humbet sinjali i përditësimit.',
      fix: 'Përdor formatin W3C Datetime (p.sh. 2026-09-01 ose 2026-09-01T10:00:00+02:00) dhe datën reale të ndryshimit.',
      evidence: bad.slice(0, 5).map((e) => ({ type: 'crawl' as const, url: e.sitemap, detected: `<loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod>`, expected: 'Datë W3C, jo në të ardhmen' })),
    });
  }
  m.check('lastmod', '<lastmod>', 0.5, lastmodIssues);

  const foreign = entries.filter((e) => !e.internal);
  if (foreign.length) {
    m.check('sitemap-host', 'URL të host-it tjetër', 0.5, [{
      code: 'SITEMAP_FOREIGN_URLS', scope: 'site', url: foreign[0]!.sitemap, affectedPages: foreign.map((e) => e.loc),
      severity: 'low', impact: 'SEO i ulët', impactLevel: 'low', effort: 'low',
      message: `${foreign.length} URL në sitemap i përkasin një host-i tjetër`,
      whyItMatters: 'Sitemap-i duhet të listojë URL të të njëjtit host (ose të verifikuara në Search Console).',
      fix: 'Hiq URL-të e huaja ose përdor host-in kanonik (me/pa www, https).',
      evidence: foreign.slice(0, 5).map((e) => ({ type: 'crawl' as const, url: e.sitemap, detected: e.loc })),
    }]);
  }

  // --- Krahasimi me crawl-in: vetëm URL që u kontrolluan realisht ---
  const byKey = new Map<string, CrawledPage>();
  for (const p of crawl.pages) {
    byKey.set(p.url, p);
    if (p.finalUrl && p.redirects.length === 0) byKey.set(normalizeUrl(p.finalUrl), p);
  }
  const internal = entries.filter((e) => e.internal);
  const checked = internal.map((e) => ({ e, p: byKey.get(e.key) })).filter((x): x is { e: typeof x.e; p: CrawledPage } => !!x.p);
  const robotsBlocked = internal.filter((e) => crawl.notChecked.some((n) => n.url === e.key && n.reason === 'robots'));
  m.metric({ id: 'sitemap-urls-checked', label: 'URL të sitemap-it të kontrolluara nga crawl-i', value: checked.length, status: 'measured', source: 'crawl' });

  const statusIssues: IssueDraft[] = [];
  const add = (code: string, list: typeof checked, sev: IssueDraft['severity'], message: string, why: string, fix: string, detected: (p: CrawledPage) => string, confidence = 1) => {
    if (!list.length) return;
    statusIssues.push({
      code, scope: 'site', url: list[0]!.p.url, affectedPages: list.map((x) => x.e.loc), severity: sev,
      impact: 'SEO (sinjal i gabuar në sitemap)', impactLevel: sev === 'medium' ? 'medium' : 'low', effort: 'low', confidence,
      message: `${list.length} URL në sitemap ${message}`, whyItMatters: why, fix,
      evidence: list.slice(0, 5).map((x) => ({ type: 'crawl' as const, url: x.e.loc, detected: `${detected(x.p)} (sitemap: ${x.e.sitemap})` })),
    });
  };
  add('SITEMAP_URL_ERROR', checked.filter((x) => x.p.access === 'http-error'), 'medium', 'kthejnë gabim',
    'Sitemap-i duhet të përmbajë vetëm faqe që ekzistojnë (200); URL-të 4xx/5xx harxhojnë crawl budget dhe dobësojnë besimin te sitemap-i.',
    'Hiq URL-të që s\'ekzistojnë ose rregulloji; kontrollo nëse plugin-i e rigjeneron sitemap-in.', (p) => `HTTP ${p.status}`);
  add('SITEMAP_URL_REDIRECTS', checked.filter((x) => x.p.access === 'ok' && x.p.redirects.length > 0), 'low', 'ridrejtojnë',
    'Sitemap-i duhet të listojë URL-në përfundimtare, jo atë që ridrejton.', 'Zëvendëso URL-të me destinacionin përfundimtar.',
    (p) => `${p.redirects.map((r) => r.status).join('→')} → ${p.finalUrl}`);
  add('SITEMAP_URL_NOINDEX', checked.filter((x) => x.p.page?.noindex), 'medium', 'kanë noindex',
    'Sinjal kontradiktor: sitemap-i thotë "indekso", faqja thotë "mos indekso".', 'Ose hiq noindex, ose hiq URL-në nga sitemap-i.', () => 'noindex (meta robots ose X-Robots-Tag)');
  add('SITEMAP_URL_CANONICALIZED', checked.filter((x) => x.p.access === 'ok' && canonicalElsewhere(x.p)), 'low', 'kanë canonical drejt një URL-je tjetër',
    'Sitemap-i duhet të përmbajë URL-të kanonike.', 'Listo në sitemap URL-në që tregon canonical-i.', (p) => `canonical → ${canonicalElsewhere(p)}`, 0.9);
  if (robotsBlocked.length) {
    statusIssues.push({
      code: 'SITEMAP_URL_BLOCKED_BY_ROBOTS', scope: 'site', url: robotsBlocked[0]!.loc, affectedPages: robotsBlocked.map((e) => e.loc),
      severity: 'medium', impact: 'SEO (sinjal kontradiktor)', impactLevel: 'medium', effort: 'low',
      message: `${robotsBlocked.length} URL në sitemap janë të ndaluara nga robots.txt`,
      whyItMatters: 'Crawler-at s\'mund t\'i lexojnë faqet që sitemap-i u kërkon të indeksojnë.',
      fix: 'Ose hiq rregullin Disallow, ose hiq URL-të nga sitemap-i.',
      evidence: robotsBlocked.slice(0, 5).map((e) => ({ type: 'crawl' as const, url: e.loc, detected: `Disallow në robots.txt (sitemap: ${e.sitemap})` })),
    });
  }
  const blocked = checked.filter((x) => x.p.access === 'blocked' || x.p.error);
  m.check('sitemap-url-status', 'Statusi i URL-ve të sitemap-it', 2, statusIssues, blocked.length ? [`${blocked.length} URL të sitemap-it s'u verifikuan (401/403/429 ose gabim rrjeti)`] : undefined);

  // --- Mbulimi: faqe të crawl-it jashtë sitemap-it; URL sitemap-i pa link ---
  const sitemapKeys = new Set(internal.map((e) => stripSlash(e.key)));
  const indexable = crawl.pages.filter((p) => p.page && p.access === 'ok' && !p.page.noindex && !canonicalElsewhere(p) && !p.sameAs);
  const missing = indexable.filter((p) => !sitemapKeys.has(stripSlash(normalizeUrl(p.finalUrl!))) && !sitemapKeys.has(stripSlash(p.url)));
  const coverageIssues: IssueDraft[] = [];
  if (missing.length) {
    coverageIssues.push({
      code: 'PAGES_MISSING_FROM_SITEMAP', scope: 'site', url: missing[0]!.finalUrl, affectedPages: missing.map((p) => p.finalUrl!),
      severity: 'low', impact: 'SEO i ulët (zbulimi)', impactLevel: 'low', effort: 'low', confidence: 0.7,
      message: `${missing.length} faqe të indeksueshme të gjetura me linke mungojnë në sitemap`,
      whyItMatters: 'Sitemap-i ndihmon zbulimin; faqet e rëndësishme që mungojnë mund të zbulohen më ngadalë. Mund të jenë të përjashtuara me qëllim.',
      fix: 'Kontrollo cilësimet e sitemap-it (p.sh. tipe postimesh/taksonomi të përjashtuara) dhe shto faqet që duhen indeksuar.',
      evidence: missing.slice(0, 5).map((p) => ({ type: 'crawl' as const, url: p.finalUrl!, detected: `200, e indeksueshme, s'është në ${sm.files.length} sitemap(-e)` })),
    });
  }
  const viaSitemapOnly = crawl.pages.filter((p) => p.source === 'sitemap' && p.access === 'ok');
  const linkCrawlComplete = !crawl.truncated && !(crawl.notCheckedCounts['max-depth'] ?? 0);
  if (viaSitemapOnly.length && linkCrawlComplete) {
    coverageIssues.push({
      code: 'SITEMAP_URLS_WITHOUT_INTERNAL_LINKS', scope: 'site', url: viaSitemapOnly[0]!.url, affectedPages: viaSitemapOnly.map((p) => p.url),
      severity: 'low', impact: 'SEO i ulët (linkim i brendshëm)', impactLevel: 'low', effort: 'medium', confidence: 0.6,
      message: `${viaSitemapOnly.length} URL nga sitemap-i s'u gjetën me linke të brendshme (crawl i plotë brenda kufijve)`,
      whyItMatters: 'Faqet pa linke të brendshme ("orphan") marrin pak sinjal; mund të jenë faqe të vjetra ose të harruara.',
      fix: 'Lidhi nga faqe relevante ose hiqi nga sitemap-i nëse s\'duhen më.',
      evidence: viaSitemapOnly.slice(0, 5).map((p) => ({ type: 'crawl' as const, url: p.url, detected: 'Në sitemap, HTTP 200, asnjë link i brendshëm në faqet e kontrolluara' })),
    });
  }
  m.check('sitemap-coverage', 'Mbulimi sitemap ↔ crawl', 1, coverageIssues,
    viaSitemapOnly.length && !linkCrawlComplete
      ? [`${viaSitemapOnly.length} URL nga sitemap-i s'u gjetën me linke brenda kufijve të crawl-it — s'mund të quhen "orphan" pa crawl të plotë.`]
      : undefined);

  const unchecked = internal.length - checked.length - robotsBlocked.length;
  if (unchecked > 0) m.limitations.push(`Sitemap: ${unchecked} nga ${internal.length} URL s'u kontrolluan (kufiri i faqeve/kohës).`);
  if (sm.truncated) m.limitations.push('Sitemap: u arrit kufiri i skedarëve ose i URL-ve; pjesa tjetër s\'u lexua.');
  return m.build({ coverage: { checked: checked.length, discovered: internal.length, truncated: unchecked > 0 || sm.truncated } });
}
