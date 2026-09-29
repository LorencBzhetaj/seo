import type { AuditReport } from './json.js';
import { groupQualityIssues } from './quality.js';
import { QUALITY_CATEGORY_LABELS, type QualityCategoryKey } from '../core/schemas.js';
import { BUSINESS_CATEGORY_LABELS, CATEGORY_LABELS, SITE_CATEGORY_LABELS, type BusinessCategoryKey, type CategoryKey, type Issue, type Severity, type SiteCategoryKey } from '../core/schemas.js';

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
  // Dështimi i Lighthouse s'fshihet: as kur mungon rezultati, as kur erdhi pas riprovimit.
  const lhMeta = report.lighthouse as { status?: string; code?: string; reason?: string; failedAttempts?: { attempt: number; code?: string }[] };
  if (lhMeta.status === 'error') {
    out.push(` ${red(bold(`⚠ LIGHTHOUSE DËSHTOI${lhMeta.code ? ` (${lhMeta.code})` : ''}`))} — Performance, Accessibility, Best Practices pa rezultat`);
    out.push(yellow(`   ${truncate(lhMeta.reason ?? '', 110)}`));
    if (lhMeta.code && ['NO_NAVSTART', 'NO_TRACING_STARTED'].includes(lhMeta.code)) out.push(yellow("   Gabim i trace-it në Chrome (jo i faqes) — ekzekuto auditin sërish."));
  } else if (lhMeta.failedAttempts?.length) {
    out.push(yellow(` ⚠ Lighthouse: ${lhMeta.failedAttempts.map((f) => `përpjekja ${f.attempt} dështoi (${f.code ?? 'gabim'})`).join(', ')}; rezultati nga përpjekja ${lhMeta.failedAttempts.length + 1}`));
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
  out.push(...businessLines(report, line));
  out.push(...qualityLines(report, line));
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

/** Cilësia e përmbajtjes dhe identiteti vizual: sinjale pa score, me screenshot-et. */
function qualityLines(report: AuditReport, line: string): string[] {
  const q = report.quality;
  const out = [`├${line}┤`, ` ${bold('CILËSIA E PËRMBAJTJES & IDENTITETI VIZUAL')}  ${dim("sinjale, pa score, jashtë Health")}`];
  if (q.status === 'skipped' || !('statuses' in q) || !('disclaimer' in q)) {
    out.push(yellow(`  skipped: ${'reason' in q ? q.reason : ''}`));
    return out;
  }
  out.push(dim(` "AI slop" = emërtim për sinjale që kërkojnë shqyrtim njerëzor; s'provon autorësi AI.`));
  for (const [k, s] of Object.entries(q.statuses) as [QualityCategoryKey, { status: string; reason?: string; partial?: boolean }][]) {
    const note = s.status === 'info' ? yellow(`sinjale${s.partial ? ' (partial)' : ''}`) : dim(`${s.status}: ${truncate(s.reason ?? '', 60)}`);
    out.push(` ${QUALITY_CATEGORY_LABELS[k].padEnd(28)}  —  ${note}`);
  }
  const v = q.visual;
  if ('captures' in v && v.captures) {
    const ok = v.captures.filter((c) => c.status === 'ok');
    out.push(dim(` Pamje: ${ok.length}/${v.captures.length} (desktop + mobile) · screenshot-e: output/${v.screenshotsDir}/`));
    for (const c of v.captures.filter((x) => x.status === 'skipped').slice(0, 3)) out.push(yellow(`   skipped ${c.viewport} ${truncate(c.url, 40)}: ${truncate(c.reason ?? '', 50)}`));
  } else out.push(dim(` Pamje: ${v.status} — ${truncate(v.reason ?? '', 80)}`));
  out.push(` ${bold('TOP — SINJALE PËR SHQYRTIM')}`);
  out.push(...groupLines(groupQualityIssues(q.issues)));
  return out;
}

/** Sinjalet e cilësisë, me gjetjet e të njëjtit model në një rresht (URL-të dhe provat veç te JSON-i). */
function groupLines(groups: ReturnType<typeof groupQualityIssues>): string[] {
  const out: string[] = [];
  if (groups.length === 0) out.push(dim('  Asnjë sinjal nga kontrollet e kryera.'));
  groups.slice(0, 5).forEach((g, idx) => {
    const pages = g.pages.length > 1 ? `, ${g.pages.length} faqe` : '';
    out.push(` ${idx + 1}. ${SEV_ICON[g.severity]} ${bold(truncate(g.summary, g.count > 1 ? 110 : 54))}  ${dim(`[${g.code}, p=${g.priority}${pages}, verifiko]`)}`);
    if (g.count > 1) {
      out.push(`    ${dim('faqe:')}  ${truncate(g.pages.map(shortPath).join(' · '), 100)}`);
      out.push(`    ${dim('provë:')} ${g.count} gjetje me të njëjtin model; p.sh. ${truncate(g.example, 70)} ${dim('(të gjitha te JSON)')}`);
    } else out.push(`    ${dim('provë:')} ${truncate(g.example, 90)}`);
    out.push(`    ${dim('fix:')}   ${truncate(g.fix, 90)}`);
  });
  if (groups.length > 5) out.push(dim(`  … +${groups.length - 5} të tjera në raportin JSON`));
  return out;
}

function shortPath(u: string): string {
  try { return new URL(u).pathname; } catch { return u; }
}

/** Seksioni i MVP-3: detektimi, conversion dhe sinjalet e privatësisë, jashtë Health Score-it. */
function businessLines(report: AuditReport, line: string): string[] {
  const b = report.business;
  const out = [`├${line}┤`, ` ${bold('BIZNES & PRIVATËSI (MVP-3)')}  ${dim("s'hyn në Health Score")}`];
  if (b.status === 'skipped' || !('detection' in b)) {
    out.push(yellow(`  skipped: ${'reason' in b ? b.reason : ''}`));
    return out;
  }
  const d = b.detection;
  if ('site' in d && d.site && d.techStack && d.pageTypeCounts) {
    const pct = (n: number) => n.toFixed(2);
    const alt = d.site.alternatives.length ? dim(` · edhe: ${d.site.alternatives.map((a) => `${a.type} ${pct(a.confidence)}`).join(', ')}`) : '';
    out.push(` Lloji i sitit: ${bold(d.site.type)} ${dim(`(confidence ${pct(d.site.confidence)})`)}${alt}`);
    if (d.site.mixedWith) out.push(yellow(`   ${d.site.type} dhe ${d.site.mixedWith} kanë prova pothuajse të barabarta — siti duket i përzier`));
    if (d.site.signals.length) out.push(dim(`   sinjale: ${truncate(d.site.signals.map((s) => s.signal).join('; '), 100)}`));
    const t = d.techStack;
    const extra = [t.builder && `${t.builder.name}`, t.ecommerce && t.ecommerce.name, t.framework && t.framework.name, t.cdn && `CDN ${t.cdn.name}`].filter(Boolean).join(' · ');
    out.push(` CMS: ${bold(t.cms)}${t.cmsVersion ? ` ${t.cmsVersion}` : ''} ${dim(`(confidence ${pct(t.confidence)})`)}${extra ? dim(` · ${extra}`) : ''}`);
    out.push(dim(` Aftësi: ${d.site.capabilities.join(', ') || '—'} · gjuhë: ${d.site.languages.join(', ') || '—'} · faqe: ${Object.entries(d.pageTypeCounts).map(([k, n]) => `${n} ${k}`).join(', ')}`));
  }
  out.push(dim(` ${b.scopeNote}`));
  for (const [k, v] of Object.entries(b.categories) as [BusinessCategoryKey, number | null][]) {
    const mod = report.modules.find((m) => m.category === k);
    const cov = b.categoryCoverage[k];
    const note =
      mod?.status === 'info'
        ? yellow(` sinjale, pa score — jo verdikt ligjor${cov?.partial ? ' (partial)' : ''}`)
        : v === null
          ? dim(` skipped: ${truncate(mod?.reason ?? '', 40)}`)
          : cov?.partial
            ? yellow(` partial — ${cov.checked}/${cov.discovered} faqe`)
            : '';
    out.push(` ${BUSINESS_CATEGORY_LABELS[k].padEnd(28)} ${scoreColor(v)}${note}`);
    if (k === 'conversion' && v !== null) {
      out.push(yellow('   ↳ vetëm sinjale në HTML statik — jo provë se rrjedha e konvertimit funksionon'));
      out.push(dim(`     s'u testuan: ${b.scoreScope.conversion.notTested.slice(0, 4).join('; ')}`));
    }
  }
  const repeatedForms = b.forms.filter((f) => f.repeated);
  if (b.forms.length) out.push(dim(` Formularë: ${b.forms.length} komponentë${repeatedForms.length ? ` (${repeatedForms.map((f) => `1 ${f.purpose}${f.id ? ` #${f.id}` : ''} i përsëritur në ${f.pageCount} faqe`).slice(0, 2).join('; ')})` : ''}`));
  out.push(` ${bold('TOP — BIZNES & PRIVATËSI')}`);
  out.push(...issueLines(b.issues));
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
          : cov?.excludedByRule
            ? dim(` ${cov.checked}/${cov.discovered} URL; ${cov.excludedByRule} të përjashtuara me rregull (shih kufizimet)`)
            : '';
    out.push(` ${SITE_CATEGORY_LABELS[k].padEnd(28)} ${scoreColor(v)}${note}`);
  }
  out.push(` ${bold('TOP — GJETJE PËR SHUMË FAQE')}`);
  out.push(...issueLines(site.issues));
  return out;
}
