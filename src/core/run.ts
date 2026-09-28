import crypto from 'node:crypto';
import type { AuditConfig } from './config.js';
import { collectContext, type AuditContext, type CollectHooks } from './context.js';
import type { AuditResult, CategoryKey, HealthResult, Issue } from './schemas.js';
import { failedModule } from '../modules/helpers.js';
import { runAvailability } from '../modules/availability.js';
import { runTechnicalSeo } from '../modules/seo-technical.js';
import { runSecurity } from '../modules/security.js';
import { runAccessibility, runBestPractices, runPerformance } from '../modules/lighthouse-modules.js';
import { sortIssues } from '../intelligence/priority.js';
import { categoryScores, computeHealth, RULESET_VERSION, SCORING_VERSION } from '../scoring/scorer.js';

export type RunStatus = 'initializing' | 'crawling' | 'auditing' | 'scoring' | 'completed' | 'failed';

export interface AuditModule {
  name: string;
  category: CategoryKey;
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

export interface AuditRun {
  id: string;
  url: string;
  startedAt: string;
  completedAt?: string;
  status: RunStatus;
  config: AuditConfig;
  context?: AuditContext;
  results: AuditResult[];
  issues: Issue[];
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
    categories: {} as AuditRun['categories'],
    scoringVersion: SCORING_VERSION,
    ruleSetVersion: RULESET_VERSION,
  };
  const setStatus = (s: RunStatus) => {
    run.status = s;
    hooks.onStatus?.(s);
  };

  setStatus('initializing');
  // MVP-1: "crawling" = vetëm mbledhja e të dhënave të faqes hyrëse, pa crawl.
  setStatus('crawling');
  const ctx = await collectContext(input, config, hooks);
  run.context = ctx;
  run.url = ctx.url;

  setStatus('auditing');
  run.results = runModules(ctx);

  setStatus('scoring');
  run.issues = sortIssues(run.results.flatMap((r) => r.issues));
  run.categories = categoryScores(run.results);
  run.health = computeHealth(run.results, run.issues);

  run.completedAt = new Date().toISOString();
  setStatus('completed');
  return run;
}
