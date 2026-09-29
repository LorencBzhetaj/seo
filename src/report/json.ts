import fs from 'node:fs';
import path from 'node:path';
import type { AuditRun } from '../core/run.js';
import type { AuditResult } from '../core/schemas.js';
import { buildBusinessSection } from './business.js';
import { buildSiteSection } from './site.js';

/**
 * 2: shtohet seksioni `site` (MVP-2). 3: shtohet seksioni `business` (MVP-3: detektim, conversion, privacy).
 * `health`/`categories`/`issues` mbeten të faqes hyrëse.
 */
export const REPORT_SCHEMA_VERSION = '3';

function toolVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/** Moduli pa dyfishuar issue-t: checks mbajnë vetëm kodet; lista e plotë është te `issues`. */
function compactModule(r: AuditResult) {
  return {
    ...r,
    issues: undefined,
    issueCount: r.issues.length,
    checks: r.checks.map((c) => ({ ...c, issues: undefined, issueCodes: c.issues.map((i) => i.code) })),
  };
}

export function buildReport(run: AuditRun) {
  const ctx = run.context;
  const lh = ctx?.lighthouse.status === 'ok' ? ctx.lighthouse.value : undefined;
  const main = ctx?.main.status === 'ok' ? ctx.main.value : undefined;
  const limitations = [
    ...(ctx && ctx.access.state !== 'ok' ? [ctx.access.summary] : []),
    ...(run.health?.limitations ?? []),
    ...run.results.flatMap((r) => r.limitations),
    "Health Score, categories dhe issues i përkasin faqes hyrëse (MVP-1); gjetjet për shumë faqe janë te `site` (crawl i kufizuar). Pa submit formularësh, exposure probing apo AI. Raporti s'vërteton pajtueshmëri ligjore, siguri apo aksesueshmëri të plotë.",
  ];
  // Statusi i faqes hyrëse; seksioni `site` ka statusin e vet.
  const partialModules = run.results.filter((r) => r.section === 'homepage' && (r.partial || r.status === 'skipped')).map((r) => r.module);
  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'website-auditor', version: toolVersion(), phase: 'MVP-3' },
    scoringVersion: run.scoringVersion,
    ruleSetVersion: run.ruleSetVersion,
    // lhrFile vendoset nga writeReport vetëm kur LHR-ja ruhet (--save-lhr).
    lighthouse: { lhrFile: undefined as string | undefined, ...(lh
      ? {
          version: lh.lighthouseVersion,
          formFactor: lh.formFactor,
          throttlingMethod: lh.throttlingMethod,
          screenEmulation: lh.screenEmulation,
          fetchTime: lh.fetchTime,
          hostUserAgent: lh.hostUserAgent,
          benchmarkIndex: lh.benchmarkIndex,
          finalDisplayedUrl: lh.finalDisplayedUrl,
          blockedRequests: lh.blockedRequests,
          // Përpjekje të dështuara para rezultatit (p.sh. NO_NAVSTART) — s'fshihen.
          failedAttempts: lh.failedAttempts ?? [],
        }
      : { status: ctx?.lighthouse.status, code: ctx?.lighthouse.status === 'error' ? ctx.lighthouse.code : undefined, reason: ctx?.lighthouse.status === 'error' ? ctx.lighthouse.error : ctx?.lighthouse.status === 'skipped' ? ctx.lighthouse.reason : undefined }) },
    runId: run.id,
    url: run.url,
    finalUrl: main?.finalUrl,
    /** A e mori auditi faqen reale; nëse jo, çfarë u përgjigj dhe pse rezultatet janë të pjesshme. */
    access: ctx?.access,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status === 'completed' && (run.health?.status === 'PARTIAL' || partialModules.length) ? 'partial' : run.status,
    partialModules,
    config: { ...run.config },
    health: run.health,
    categories: run.categories,
    topImprovements: run.issues.slice(0, 5).map((i) => ({
      code: i.code, severity: i.severity, effort: i.effort, priority: i.priority, message: i.message, fix: i.fix,
    })),
    issues: run.issues,
    /** MVP-2: crawl, sitemap dhe gjetjet për shumë faqe. */
    site: buildSiteSection(run),
    /** MVP-3: lloji i sitit/faqeve, CMS, conversion dhe sinjale privatësie (jashtë Health Score-it). */
    business: buildBusinessSection(run),
    modules: run.results.map(compactModule),
    limitations: [...new Set(limitations)],
  };
}

export type AuditReport = ReturnType<typeof buildReport>;

export function reportFileName(report: AuditReport): string {
  const host = new URL(report.finalUrl ?? report.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const stamp = report.startedAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `${host}-${stamp}.json`;
}

/** LHR-ja merr të njëjtin emër bazë si raporti: `gjecaj.al-20260928-180745.json` → `….lhr.json`. */
export function lhrFileName(report: AuditReport): string {
  return reportFileName(report).replace(/\.json$/, '.lhr.json');
}

/**
 * Shkruan raportin JSON dhe, kur jepet (vetëm me --save-lhr), LHR-në e plotë pranë tij.
 * Raporti e emërton LHR-në te `lighthouse.lhrFile`, që të dy skedarët të lidhen qartë.
 */
export function writeReport(
  report: AuditReport,
  outputDir: string,
  rawLhr?: unknown,
): { reportPath: string; lhrPath?: string; report: AuditReport } {
  fs.mkdirSync(outputDir, { recursive: true });
  let written = report;
  let lhrPath: string | undefined;
  if (rawLhr !== undefined) {
    const name = lhrFileName(report);
    lhrPath = path.join(outputDir, name);
    fs.writeFileSync(lhrPath, JSON.stringify(rawLhr), 'utf8');
    written = { ...report, lighthouse: { ...report.lighthouse, lhrFile: name } };
  }
  const reportPath = path.join(outputDir, reportFileName(written));
  fs.writeFileSync(reportPath, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
  return { reportPath, lhrPath, report: written };
}
