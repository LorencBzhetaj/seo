import fs from 'node:fs';
import path from 'node:path';
import type { Severity } from '../core/schemas.js';
import { PROJECT_LABELS } from './project.js';
import type { SourceAuditResult } from './run.js';

/** Skema e raportit të skedarëve — e ndarë nga raporti i URL-së (reportSchemaVersion 3). */
export const SOURCE_REPORT_SCHEMA_VERSION = 'source-1';
export const SOURCE_RULESET_VERSION = '2026.09-source1';

function toolVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export function buildSourceReport(r: SourceAuditResult) {
  const count = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
  const byCode: Record<string, number> = {};
  for (const f of r.findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  return {
    reportSchemaVersion: SOURCE_REPORT_SCHEMA_VERSION,
    reportType: 'source-audit' as const,
    tool: { name: 'website-auditor', version: toolVersion(), phase: 'source-audit' },
    ruleSetVersion: SOURCE_RULESET_VERSION,
    runId: r.id,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    /** Dallimi nga auditi i URL-së: ky raport vjen nga skedarët, jo nga një faqe e publikuar. */
    scope: 'Audit i skedarëve (dosje lokale/repo) — i ndarë nga auditi i URL-së publike. Pa Health Score, pa Lighthouse, pa header-a HTTP: kodi s\'u ekzekutua.',
    source: r.source,
    project: { ...r.project, label: PROJECT_LABELS[r.project.type] },
    status: r.coverage.truncated || r.checks.some((c) => c.status === 'skipped') ? ('partial' as const) : ('completed' as const),
    coverage: r.coverage,
    checks: r.checks,
    summary: {
      critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low'),
      needsManualReview: r.findings.filter((f) => f.needsManualReview).length,
      byCode,
    },
    findings: r.findings,
    notFromFiles: r.project.notFromFiles,
    limitations: r.limitations,
  };
}

export type SourceReport = ReturnType<typeof buildSourceReport>;

export function sourceReportFileName(report: SourceReport): string {
  const name = report.source.name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'source';
  const stamp = report.startedAt.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `source-${report.source.kind}-${name}-${stamp}.json`;
}

export function writeSourceReport(report: SourceReport, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const p = path.join(outputDir, sourceReportFileName(report));
  fs.writeFileSync(p, JSON.stringify(report, null, 2), 'utf8');
  return p;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c(31);
const yellow = c(33);
const green = c(32);
const dim = c(2);
const bold = c(1);
const ICON: Record<Severity, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderSourceTerminal(report: SourceReport, reportPath?: string): string {
  const W = 64;
  const line = '─'.repeat(W);
  const out: string[] = [];
  const s = report.source;
  out.push(`┌${line}┐`);
  out.push(` SOURCE AUDIT — ${bold(s.kind === 'repo' ? s.repo!.url : s.folder!)}`);
  out.push(dim(' skedarë, jo URL publike · pa Health Score · pa Lighthouse · asgjë s\'u ekzekutua'));
  if (s.repo) out.push(` commit ${s.repo.commit.slice(0, 12)}${s.repo.branch ? ` (${s.repo.branch})` : ''}${s.repo.commitDate ? dim(` · ${s.repo.commitDate}`) : ''}`);
  const p = report.project;
  out.push(` Projekti: ${bold(p.label)} ${dim(`(confidence ${p.confidence.toFixed(2)})`)}${p.signals.length ? dim(` · ${trunc(p.signals.map((x) => x.signal).join('; '), 70)}`) : ''}`);
  const cov = report.coverage;
  const a = cov.accounting;
  const exts = Object.entries(a.statOnly.byExt).map(([e, n]) => `${n} ${e}`).join(', ');
  out.push(` ${a.filesSeen} skedarë: ${a.readAsText} lexuar si tekst · ${a.statOnly.count} asete binare (vetëm stat${exts ? `: ${exts}` : ''}) · ${a.unread.count} tekst i palexuar${report.status === 'partial' ? yellow(' (partial)') : ''}`);
  out.push(dim(` ${cov.htmlRead}/${cov.htmlFiles} HTML të lexuar · ${a.notListed} hyrje të anashkaluara para listimit (s'numërohen te skedarët)`));
  for (const [reason, x] of Object.entries(cov.skipped)) if (x) out.push(dim(`   ${x.count} ${x.meaning}${x.examples.length ? `: ${trunc(x.examples.join(', '), 70)}` : ''}`));
  out.push(`├${line}┤`);
  for (const ch of report.checks) {
    const st = ch.status === 'pass' ? green('ok     ') : ch.status === 'fail' ? red('fail   ') : ch.status === 'warning' ? yellow('warning') : ch.status === 'info' ? yellow('sinjale') : dim('skipped');
    out.push(` ${st} ${ch.label}`);
    if (ch.status === 'skipped' && ch.reason) out.push(dim(`         ${trunc(ch.reason, 100)}`));
  }
  out.push(`├${line}┤`);
  const sm = report.summary;
  out.push(` ${ICON.critical} ${sm.critical} Critical   ${ICON.high} ${sm.high} High   ${ICON.medium} ${sm.medium} Medium   ${ICON.low} ${sm.low} Low   ${dim(`verifikim manual: ${sm.needsManualReview}`)}`);
  out.push(` ${bold('GJETJET KRYESORE')}`);
  if (!report.findings.length) out.push(dim('  Asnjë gjetje nga kontrollet e kryera.'));
  report.findings.slice(0, 8).forEach((f, i) => {
    out.push(` ${i + 1}. ${ICON[f.severity]} ${bold(trunc(f.message, 60))}  ${dim(`[${f.code}${f.needsManualReview ? ', verifiko' : ''}]`)}`);
    out.push(`    ${dim('ku:')}    ${f.file}${f.line ? `:${f.line}` : ''}${f.related?.length ? dim(` (+${f.related.length} vende)`) : ''}`);
    out.push(`    ${dim('provë:')} ${trunc(f.evidence, 90)}`);
    out.push(`    ${dim('fix:')}   ${trunc(f.suggestion, 90)}`);
  });
  if (report.findings.length > 8) out.push(dim(`  … +${report.findings.length - 8} gjetje të tjera në raportin JSON`));
  out.push(`├${line}┤`);
  out.push(` ${bold("S'KONTROLLOHET NGA SKEDARËT")}`);
  for (const n of report.notFromFiles) out.push(dim(`  • ${n.check}: ${n.reason}`));
  out.push(`└${line}┘`);
  if (reportPath) out.push(`Raporti JSON: ${reportPath}`);
  return out.join('\n');
}
