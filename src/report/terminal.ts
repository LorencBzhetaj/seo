import type { AuditReport } from './json.js';
import { CATEGORY_LABELS, SITE_CATEGORY_LABELS, type CategoryKey, type Issue, type Severity, type SiteCategoryKey } from '../core/schemas.js';

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
  out.push(` WEBSITE AUDIT — ${bold(host)}  ${dim(`(faqja hyrëse: MVP-1, mobile · site: crawl)`)}`);
  const access = report.access;
  if (access && access.state !== 'ok' && access.state !== 'unreachable') {
    out.push('');
    out.push(` ${red(bold(access.state === 'blocked' ? `⚠ AUDITI U BLLOKUA PËR KËTË KLIENT — HTTP ${access.httpStatus}` : `⚠ FAQJA HYRËSE KTHEU HTTP ${access.httpStatus}`))}`);
    const via = [access.provider, access.requestId ? `Ray/ID ${access.requestId}` : '', access.ipVersion ? `IPv${access.ipVersion}` : ''].filter(Boolean).join(' · ');
    if (via) out.push(`   ${via}${access.bodySnippet ? ` · "${truncate(access.bodySnippet, 40)}"` : ''}`);
    out.push(yellow("   HTML-ja dhe header-at e faqes reale s'u morën: SEO dhe header-at e sigurisë s'janë vlerësuar."));
    if (access.state === 'blocked') out.push(yellow("   Kjo s'provon që faqja s'hapet për vizitorët — verifiko në browser dhe te log-et e WAF/CDN."));
  }
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
  out.push(` ${bold('TOP IMPROVEMENTS — FAQJA HYRËSE')}`);
  out.push(...issueLines(report.issues));
  out.push(...siteLines(report, line));
  out.push(`├${line}┤`);
  out.push(` ${bold('KUFIZIME')}`);
  for (const l of report.limitations.slice(0, 6)) out.push(dim(`  • ${truncate(l, 110)}`));
  if (report.limitations.length > 6) out.push(dim(`  … +${report.limitations.length - 6} në JSON`));
  out.push(`└${line}┘`);
  if (reportPath) out.push(`Raporti JSON: ${reportPath}`);
  return out.join('\n');
}

function issueLines(issues: Issue[]): string[] {
  const out: string[] = [];
  if (issues.length === 0) out.push(dim('  Asnjë issue nga kontrollet e kryera.'));
  issues.slice(0, 5).forEach((i, idx) => {
    const pages = i.affectedPages.length > 1 ? `, ${i.affectedPages.length} faqe` : '';
    out.push(` ${idx + 1}. ${SEV_ICON[i.severity]} ${bold(truncate(i.message, 54))}  ${dim(`[${i.code}, p=${i.priority}${pages}${i.needsManualReview ? ', verifiko' : ''}]`)}`);
    const ev = i.evidence[0];
    if (ev) out.push(`    ${dim('provë:')} ${truncate(ev.detected, 90)}`);
    out.push(`    ${dim('fix:')}   ${truncate(i.fix, 90)}`);
  });
  if (issues.length > 5) out.push(dim(`  … +${issues.length - 5} issue të tjera në raportin JSON`));
  return out;
}

/** Seksioni i crawl-it (MVP-2), i ndarë qartë nga faqja hyrëse. */
function siteLines(report: AuditReport, line: string): string[] {
  const site = report.site;
  const out = [`├${line}┤`, ` ${bold('SITE — CRAWL I KUFIZUAR (MVP-2)')}  ${dim("s'hyn në Health Score-in e faqes hyrëse")}`];
  if (site.status === 'skipped' || !('crawl' in site) || !site.crawl) {
    out.push(yellow(`  skipped: ${'reason' in site ? site.reason : ''}`));
    return out;
  }
  const c = site.crawl;
  const l = c.limits;
  out.push(` ${c.pagesRequested} faqe të kërkuara (${c.pagesAnalyzed} HTML të analizuara) · ${c.urlsDiscovered} URL të brendshme të zbuluara${site.status === 'partial' ? yellow(' (partial)') : ''}`);
  out.push(dim(` kufij: maks ${l.maxPages} faqe · thellësi ${l.maxDepth} · concurrency ${l.concurrency} · ${l.requestDelayMs} ms/host · ${(c.durationMs / 1000).toFixed(1)}s`));
  if (c.notCheckedTotal) {
    const reasons = Object.values(c.notCheckedByReason).map((r) => `${r.count} ${r.meaning}`).join('; ');
    out.push(dim(` pa kontroll: ${c.notCheckedTotal} — ${truncate(reasons, 100)}`));
  }
  if (c.stopReason) out.push(yellow(` ${c.stopReason}`));
  out.push(yellow(` ${site.scopeNote}`));
  for (const [k, v] of Object.entries(site.categories) as [SiteCategoryKey, number | null][]) {
    const mod = report.modules.find((m) => m.category === k);
    const cov = site.categoryCoverage[k];
    const note =
      v === null
        ? dim(` ${mod?.status === 'not_applicable' ? 'n/a' : 'skipped'}: ${truncate(mod?.reason ?? 'ende pa implementuar', 40)}`)
        : cov?.partial
          ? yellow(` partial — vetëm ${cov.checked}/${cov.discovered} URL, jo për gjithë sitin`)
          : '';
    out.push(` ${SITE_CATEGORY_LABELS[k].padEnd(28)} ${scoreColor(v)}${note}`);
  }
  out.push(` ${bold('TOP — GJETJE PËR SHUMË FAQE')}`);
  out.push(...issueLines(site.issues));
  return out;
}
