import fs from 'node:fs';
import path from 'node:path';
import type { AuditRun } from '../core/run.js';
import type { AuditResult } from '../core/schemas.js';

export const REPORT_SCHEMA_VERSION = '1';

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
    'Ky raport mbulon vetëm faqen hyrëse (MVP-1): pa crawl, pa formularë, pa exposure probing, pa AI. Nuk vërteton pajtueshmëri ligjore, siguri apo aksesueshmëri të plotë.',
  ];
  const partialModules = run.results.filter((r) => r.partial || r.status === 'skipped').map((r) => r.module);
  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'website-auditor', version: toolVersion(), phase: 'MVP-1' },
    scoringVersion: run.scoringVersion,
    ruleSetVersion: run.ruleSetVersion,
    lighthouse: lh
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
        }
      : { status: ctx?.lighthouse.status, reason: ctx?.lighthouse.status === 'error' ? ctx.lighthouse.error : ctx?.lighthouse.status === 'skipped' ? ctx.lighthouse.reason : undefined },
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

export function writeReport(report: AuditReport, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, reportFileName(report));
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}
