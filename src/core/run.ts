import crypto from 'node:crypto';
import type { AuditConfig } from './config.js';
import { collectContext, type AuditContext, type CollectHooks } from './context.js';
import type { AnyCategoryKey, AuditResult, CategoryKey, HealthResult, Issue } from './schemas.js';
import { runLinks } from '../modules/site/links.js';
import { runSitemap } from '../modules/site/sitemap.js';
import { runDuplicates } from '../modules/site/duplicates.js';
import { runOnPage } from '../modules/site/onpage.js';
import { runCaching } from '../modules/site/caching.js';
import { runI18n } from '../modules/site/i18n.js';
import { failedModule } from '../modules/helpers.js';
import { runConversion } from '../modules/business/conversion.js';
import { runPrivacy } from '../modules/business/privacy.js';
import { buildDetection, type DetectionData } from '../detection/index.js';
import { runContentQuality, runVisualIdentity } from '../modules/quality/quality.js';
import type { VisualData, VisualTarget } from '../visual/capture.js';
import { runAvailability } from '../modules/availability.js';
import { runTechnicalSeo } from '../modules/seo-technical.js';
import { runSecurity } from '../modules/security.js';
import { runAccessibility, runBestPractices, runPerformance } from '../modules/lighthouse-modules.js';
import { sortIssues } from '../intelligence/priority.js';
import { categoryScores, computeHealth, RULESET_VERSION, SCORING_VERSION } from '../scoring/scorer.js';

export type RunStatus = 'initializing' | 'crawling' | 'auditing' | 'scoring' | 'completed' | 'failed';

export interface AuditModule {
  name: string;
  category: AnyCategoryKey;
  run: (ctx: AuditContext) => AuditResult;
}

/** Modulet e MVP-1. Të gjitha varen vetëm nga AuditContext, ndaj ekzekutohen njëri pas tjetrit pa rrjet. */
export const MVP1_MODULES: AuditModule[] = [
  { name: 'availability', category: 'availability', run: runAvailability },
  { name: 'seo-technical', category: 'seoTechnical', run: runTechnicalSeo },
  { name: 'security', category: 'security', run: runSecurity },
  { name: 'performance', category: 'performance', run: runPerformance },
  { name: 'accessibility', category: 'accessibility', run: runAccessibility },
  { name: 'best-practices', category: 'bestPractices', run: runBestPractices },
];

/** Modulet e MVP-2: lexojnë crawl-in dhe sitemap-et nga AuditContext. */
export const SITE_MODULES: AuditModule[] = [
  { name: 'links', category: 'links', run: runLinks },
  { name: 'sitemap', category: 'sitemap', run: runSitemap },
  { name: 'duplicates', category: 'duplicates', run: runDuplicates },
  { name: 'onpage', category: 'contentSeo', run: runOnPage },
  { name: 'caching', category: 'caching', run: runCaching },
  { name: 'i18n', category: 'i18n', run: runI18n },
];

/** Modulet e MVP-3: lexojnë faqet e analizuara dhe detektimin; s'bëjnë kërkesa, s'dërgojnë forma. */
export const BUSINESS_MODULES: AuditModule[] = [
  { name: 'conversion', category: 'conversion', run: runConversion },
  { name: 'privacy', category: 'privacy', run: runPrivacy },
];

/** Cilësia e përmbajtjes dhe identiteti vizual: sinjale, jashtë Health Score-it. */
export const QUALITY_MODULES: AuditModule[] = [
  { name: 'content-quality', category: 'contentQuality', run: runContentQuality },
  { name: 'visual-identity', category: 'visualIdentity', run: runVisualIdentity },
];

/** Sa faqe e kanë radhën sipas llojit: faqja hyrëse, pastaj një faqe për çdo lloj kryesor. */
const VISUAL_TYPE_ORDER = ['contact', 'product', 'rooms', 'menu', 'booking', 'blog-post', 'about', 'shop', 'faq', 'gallery', 'blog-index'];

/**
 * Faqe përfaqësuese për renderim: faqja hyrëse + një për çdo lloj (në gjuhën e faqes hyrëse kur ka),
 * pa faqe ligjore/noindex; plotësohet me template të ndryshëm. Vetëm faqe që crawl-i i arriti (robots/rregullat).
 */
export function selectVisualTargets(ctx: AuditContext, detection: DetectionData | undefined, max: number): VisualTarget[] {
  if (ctx.main.status !== 'ok') return [];
  const out: VisualTarget[] = [{ url: ctx.main.value.finalUrl, pageType: 'home' }];
  const crawl = ctx.crawl.status === 'ok' ? ctx.crawl.value : undefined;
  if (!crawl || !detection) return out;
  const pageOf = new Map(crawl.pages.filter((p) => p.page && p.access === 'ok' && !p.sameAs && !p.external && !p.page.noindex).map((p) => [p.finalUrl ?? p.url, p]));
  const homeLang = crawl.pages.find((p) => p.source === 'homepage')?.page?.lang?.slice(0, 2);
  const cands = detection.pages.filter((c) => c.type !== 'home' && c.type !== 'legal' && pageOf.has(c.url));
  const sameLang = (u: string) => pageOf.get(u)?.page?.lang?.slice(0, 2) === homeLang;
  for (const type of VISUAL_TYPE_ORDER) {
    if (out.length >= max) break;
    const c = cands.filter((x) => x.type === type).sort((a, b) => Number(sameLang(b.url)) - Number(sameLang(a.url)) || b.confidence - a.confidence)[0];
    if (c) out.push({ url: c.url, pageType: c.type });
  }
  const templates = new Set(out.map((t) => pageOf.get(t.url)?.page?.templateKey));
  for (const c of cands) {
    if (out.length >= max) break;
    const tk = pageOf.get(c.url)?.page?.templateKey;
    if (out.some((t) => t.url === c.url) || templates.has(tk)) continue;
    templates.add(tk);
    out.push({ url: c.url, pageType: c.type });
  }
  return out.slice(0, max);
}

export interface AuditRun {
  id: string;
  url: string;
  startedAt: string;
  completedAt?: string;
  status: RunStatus;
  config: AuditConfig;
  context?: AuditContext;
  results: AuditResult[];
  /** Issue-t e faqes hyrëse (MVP-1). */
  issues: Issue[];
  /** Issue-t nga crawl-i (MVP-2), të ndara nga ato të faqes hyrëse. */
  siteIssues: Issue[];
  /** Issue-t e MVP-3 (conversion/privacy), jashtë Health Score-it. */
  businessIssues: Issue[];
  /** Sinjalet e cilësisë së përmbajtjes/pamjes, jashtë Health Score-it. */
  qualityIssues: Issue[];
  categories: Record<CategoryKey, number | null>;
  health?: HealthResult;
  scoringVersion: string;
  ruleSetVersion: string;
  error?: string;
}

/** Gabimi i një moduli kthehet në rezultat "skipped" me arsye; modulet e tjera vazhdojnë. */
export function runModules(ctx: AuditContext, modules: AuditModule[] = MVP1_MODULES): AuditResult[] {
  return modules.map((mod) => {
    try {
      return mod.run(ctx);
    } catch (err) {
      return failedModule(mod.name, mod.category, `Gabim i brendshëm i modulit: ${(err as Error).message}`);
    }
  });
}

export interface RunHooks extends CollectHooks {
  onStatus?: (status: RunStatus) => void;
  /** Renderimi i faqeve (browser). I injektuar nga CLI-ja, që motori të mbetet i ndarë nga Chrome. */
  captureVisual?: (targets: VisualTarget[], config: AuditConfig) => Promise<VisualData>;
}

export async function executeAudit(input: string, config: AuditConfig, hooks: RunHooks = {}): Promise<AuditRun> {
  const run: AuditRun = {
    id: crypto.randomUUID(),
    url: input,
    startedAt: new Date().toISOString(),
    status: 'initializing',
    config,
    results: [],
    issues: [],
    siteIssues: [],
    businessIssues: [],
    qualityIssues: [],
    categories: {} as AuditRun['categories'],
    scoringVersion: SCORING_VERSION,
    ruleSetVersion: RULESET_VERSION,
  };
  const setStatus = (s: RunStatus) => {
    run.status = s;
    hooks.onStatus?.(s);
  };

  setStatus('initializing');
  // "crawling" = mbledhja e të dhënave: faqja hyrëse (MVP-1), pastaj sitemap + crawl i kufizuar (MVP-2).
  setStatus('crawling');
  const ctx = await collectContext(input, config, hooks);
  run.context = ctx;
  run.url = ctx.url;

  setStatus('auditing');
  // Detektimi (§2 J) para moduleve: lloji i sitit aktivizon kontrolle shtesë te conversion.
  if (config.business.enabled) {
    try {
      ctx.detection = buildDetection(ctx);
    } catch {
      ctx.detection = undefined; // modulet e raportojnë si skipped; s'ndalet auditi
    }
  }
  // Identiteti vizual: renderim i kufizuar i faqeve përfaqësuese (vetëm kur faqja reale u mor)
  if (config.quality.enabled) {
    if (!config.quality.visual) ctx.visual = { status: 'skipped', reason: 'Renderimi vizual u çaktivizua (--no-visual)' };
    else if (config.lighthouse.unavailableReason) ctx.visual = { status: 'skipped', reason: config.lighthouse.unavailableReason };
    else if (ctx.access.state !== 'ok') ctx.visual = { status: 'skipped', reason: `Faqja reale s'u mor (${ctx.access.summary})` };
    else if (!hooks.captureVisual) ctx.visual = { status: 'skipped', reason: 'Runner-i i renderimit mungon' };
    else {
      const targets = selectVisualTargets(ctx, ctx.detection ?? buildDetection(ctx), config.quality.maxVisualPages);
      hooks.onStep?.(`renderim vizual: ${targets.length} faqe × desktop/mobile`);
      try {
        ctx.visual = { status: 'ok', value: await hooks.captureVisual(targets, config) };
      } catch (err) {
        ctx.visual = { status: 'error', error: (err as Error).message };
      }
    }
  }
  run.results = runModules(ctx, [...MVP1_MODULES, ...SITE_MODULES, ...(config.business.enabled ? BUSINESS_MODULES : []), ...(config.quality.enabled ? QUALITY_MODULES : [])]);

  setStatus('scoring');
  const homepage = run.results.filter((r) => r.section === 'homepage');
  run.issues = sortIssues(homepage.flatMap((r) => r.issues));
  run.siteIssues = sortIssues(run.results.filter((r) => r.section === 'site').flatMap((r) => r.issues));
  run.businessIssues = sortIssues(run.results.filter((r) => r.section === 'business').flatMap((r) => r.issues));
  run.qualityIssues = sortIssues(run.results.filter((r) => r.section === 'quality').flatMap((r) => r.issues));
  run.categories = categoryScores(homepage);
  // Health Score mbetet ai i faqes hyrëse (MVP-1); crawl-i raportohet veç, pa pikë të përbashkëta.
  run.health = computeHealth(homepage, run.issues);

  run.completedAt = new Date().toISOString();
  setStatus('completed');
  return run;
}
