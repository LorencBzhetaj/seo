import type { AuditReport } from './json.js';
import { CATEGORY_LABELS, type CategoryKey, type Severity } from '../core/schemas.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c(31);
const yellow = c(33);
const green = c(32);
const dim = c(2);
const bold = c(1);

const SEV_ICON: Record<Severity, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

function scoreColor(score: number | null): string {
  if (score === null) return dim('  — ');
  const s = String(score).padStart(3);
  return score >= 90 ? green(s) : score >= 50 ? yellow(s) : red(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function renderTerminal(report: AuditReport, reportPath?: string): string {
  const out: string[] = [];
  const W = 64;
  const line = '─'.repeat(W);
  const h = report.health;
  const host = new URL(report.finalUrl ?? report.url).host;

  out.push(`┌${line}┐`);
  out.push(` WEBSITE AUDIT — ${bold(host)}  ${dim(`(MVP-1, faqja hyrëse, mobile)`)}`);
  out.push('');
  if (h?.score !== null && h?.score !== undefined) {
    out.push(`    ${bold(`${h.score} / 100`)}  — ${h.status}`);
    for (const m of h.modifiers) out.push(`    ${yellow('↓')} ${m.code}: ${m.before} → ${m.after} (${m.reason})`);
  } else {
    out.push(`    ${yellow(bold('PARTIAL'))} — Health Score nuk u gjenerua`);
  }
  out.push(`├${line}┤`);
  for (const [k, v] of Object.entries(report.categories) as [CategoryKey, number | null][]) {
    const mod = report.modules.find((m) => m.category === k);
    const note = v === null ? dim(` skipped: ${truncate(mod?.reason ?? '', 38)}`) : mod?.partial ? yellow(' (partial)') : '';
    out.push(` ${CATEGORY_LABELS[k].padEnd(28)} ${scoreColor(v)}${note}`);
  }
  out.push(`├${line}┤`);
  if (h) {
    out.push(` ${SEV_ICON.critical} ${h.critical} Critical   ${SEV_ICON.high} ${h.high} High   ${SEV_ICON.medium} ${h.medium} Medium   ${SEV_ICON.low} ${h.low} Low`);
    out.push(dim(` Mbulimi: ${h.coverage.checked}/${h.coverage.discovered} kontrolle · për verifikim manual: ${h.needsManualReview}`));
  }
  const perf = report.modules.find((m) => m.module === 'performance');
  if (perf) {
    const pick = (id: string) => perf.metrics.find((m) => m.id === id);
    const fmt = (id: string, label: string) => {
      const m = pick(id);
      if (!m || m.value === null) return `${label} ${dim('n/a')}`;
      if (m.unit !== 'ms') return `${label} ${m.value}`;
      return id === 'tbt' ? `${label} ${m.value}ms` : `${label} ${(Number(m.value) / 1000).toFixed(1)}s`;
    };
    out.push(` ${fmt('lcp', 'LCP')} · ${fmt('cls', 'CLS')} · ${fmt('tbt', 'TBT')} · INP ${dim('unavailable (pa field data)')}`);
  }
  out.push(`├${line}┤`);
  out.push(` ${bold('TOP IMPROVEMENTS')}`);
  if (report.issues.length === 0) out.push(dim('  Asnjë issue nga kontrollet e kryera.'));
  report.issues.slice(0, 5).forEach((i, idx) => {
    out.push(` ${idx + 1}. ${SEV_ICON[i.severity]} ${bold(truncate(i.message, 54))}  ${dim(`[${i.code}, p=${i.priority}${i.needsManualReview ? ', verifiko' : ''}]`)}`);
    const ev = i.evidence[0];
    if (ev) out.push(`    ${dim('provë:')} ${truncate(ev.detected, 90)}`);
    out.push(`    ${dim('fix:')}   ${truncate(i.fix, 90)}`);
  });
  if (report.issues.length > 5) out.push(dim(`  … +${report.issues.length - 5} issue të tjera në raportin JSON`));
  out.push(`├${line}┤`);
  out.push(` ${bold('KUFIZIME')}`);
  for (const l of report.limitations.slice(0, 6)) out.push(dim(`  • ${truncate(l, 110)}`));
  if (report.limitations.length > 6) out.push(dim(`  … +${report.limitations.length - 6} në JSON`));
  out.push(`└${line}┘`);
  if (reportPath) out.push(`Raporti JSON: ${reportPath}`);
  return out.join('\n');
}
