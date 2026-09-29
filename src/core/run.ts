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
import { buildDetection } from '../detection/index.js';
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
  run.results = runModules(ctx, [...MVP1_MODULES, ...SITE_MODULES, ...(config.business.enabled ? BUSINESS_MODULES : [])]);

  setStatus('scoring');
  const homepage = run.results.filter((r) => r.section === 'homepage');
  run.issues = sortIssues(homepage.flatMap((r) => r.issues));
  run.siteIssues = sortIssues(run.results.filter((r) => r.section === 'site').flatMap((r) => r.issues));
  run.businessIssues = sortIssues(run.results.filter((r) => r.section === 'business').flatMap((r) => r.issues));
  run.categories = categoryScores(homepage);
  // Health Score mbetet ai i faqes hyrëse (MVP-1); crawl-i raportohet veç, pa pikë të përbashkëta.
  run.health = computeHealth(homepage, run.issues);

  run.completedAt = new Date().toISOString();
  setStatus('completed');
  return run;
}
