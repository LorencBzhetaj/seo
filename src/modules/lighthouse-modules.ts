import type { AuditContext } from '../core/context.js';
import type { AuditResult, CategoryKey, Evidence, IssueDraft, Severity } from '../core/schemas.js';
import type { LhAudit, LighthouseData } from '../lighthouse/run-lighthouse.js';
import { ModuleBuilder } from './helpers.js';

// Pragjet "Good/Needs improvement/Poor" të Core Web Vitals (web.dev).
const LCP = { good: 2500, poor: 4000 };
const CLS = { good: 0.1, poor: 0.25 };
const TBT = { good: 200, poor: 600 };
const MAX_INSIGHT_ISSUES = 6;
const MAX_A11Y_ISSUES = 10;
/** Audite që përdoren tashmë si provë te LCP/CLS/TBT — s'dalin si issue të veçanta (pa dyfishim). */
const COVERED_BY_METRIC_CHECKS = new Set(['layout-shifts', 'cls-culprits-insight', 'bootup-time', 'mainthread-work-breakdown', 'lcp-breakdown-insight']);

type Item = Record<string, unknown>;

function stripMarkdown(s: string | undefined): string {
  return (s ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();
}

function kb(n: unknown): string | undefined {
  return typeof n === 'number' ? `${Math.round(n / 1024)} KB` : undefined;
}

function nodeOf(item: Item): { snippet?: string; selector?: string; nodeLabel?: string } | undefined {
  const n = (item.node ?? (item.type === 'node' ? item : undefined)) as Item | undefined;
  if (!n) return undefined;
  return { snippet: n.snippet as string | undefined, selector: n.selector as string | undefined, nodeLabel: n.nodeLabel as string | undefined };
}

export function summarizeItem(item: Item): string {
  const parts: string[] = [];
  const node = nodeOf(item);
  if (node?.snippet) parts.push(node.snippet.replace(/\s+/g, ' ').slice(0, 200));
  else if (node?.selector) parts.push(node.selector);
  if (typeof item.url === 'string') parts.push(item.url.slice(0, 200));
  if (typeof item.source === 'object' && item.source && typeof (item.source as Item).url === 'string') parts.push(String((item.source as Item).url).slice(0, 200));
  if (typeof item.description === 'string') parts.push(item.description.slice(0, 200));
  if (typeof item.groupLabel === 'string') parts.push(item.groupLabel);
  if (typeof item.label === 'string' && typeof item.duration === 'number') parts.push(`${item.label}=${Math.round(item.duration)}ms`);
  else if (typeof item.duration === 'number') parts.push(`${Math.round(item.duration)} ms`);
  const size = kb(item.totalBytes) ?? kb(item.transferSize);
  if (size) parts.push(`size=${size}`);
  const wasted = kb(item.wastedBytes);
  if (wasted) parts.push(`kursim≈${wasted}`);
  if (typeof item.wastedMs === 'number') parts.push(`${Math.round(item.wastedMs)} ms`);
  if (typeof item.total === 'number') parts.push(`CPU=${Math.round(item.total)} ms`);
  if (typeof item.score === 'number' && item.score < 1) parts.push(`shift=${item.score.toFixed(3)}`);
  return parts.join(' · ');
}

/** Rreshtat e tabelës, edhe kur details është 'list' me nën-tabela. */
export function tableItems(audit: LhAudit | undefined): Item[] {
  const d = audit?.details;
  if (!d) return [];
  if (d.type === 'list' && Array.isArray(d.items)) {
    return (d.items as Item[]).flatMap((sub) => (Array.isArray(sub.items) ? (sub.items as Item[]) : sub.type === 'node' ? [sub] : []));
  }
  return Array.isArray(d.items) ? (d.items as Item[]) : [];
}

function auditEvidence(audit: LhAudit, url: string, max = 3): Evidence[] {
  const d = audit.details;
  if (d?.type === 'checklist' && d.items && typeof d.items === 'object') {
    const failing = Object.values(d.items as Record<string, { label: string; value: boolean }>).filter((x) => !x.value).map((x) => x.label);
    if (failing.length) return [{ type: 'metric', url, detected: failing.join('; '), expected: audit.title }];
  }
  const items = tableItems(audit).map(summarizeItem).filter(Boolean);
  const total = items.length;
  const ev: Evidence[] = items.slice(0, max).map((s) => ({ type: 'metric', url, detected: s }));
  if (total > max) ev.push({ type: 'metric', url, detected: `… dhe ${total - max} elemente të tjera (shih Lighthouse "${audit.id}")` });
  if (ev.length === 0) ev.push({ type: 'metric', url, detected: `${audit.title}${audit.displayValue ? ` — ${audit.displayValue}` : ''}` });
  return ev;
}

function unavailable(ctx: AuditContext): string | undefined {
  if (ctx.lighthouse.status === 'ok') return undefined;
  return ctx.lighthouse.status === 'error' ? `Lighthouse dështoi: ${ctx.lighthouse.error}` : ctx.lighthouse.reason;
}

function lhScore(lh: LighthouseData, id: string): number | null {
  const s = lh.categories[id]?.score;
  return typeof s === 'number' ? Math.round(s * 100) : null;
}

function coverageChecks(m: ModuleBuilder, lh: LighthouseData, categoryId: string): AuditResult['coverage'] {
  const refs = lh.categories[categoryId]?.auditRefs ?? [];
  const weighted = refs.filter((r) => r.weight > 0 && lh.audits[r.id]?.scoreDisplayMode !== 'notApplicable');
  const scored = refs.filter((r) => typeof lh.audits[r.id]?.score === 'number' && r.weight > 0);
  const manual = refs.filter((r) => lh.audits[r.id]?.scoreDisplayMode === 'manual');
  m.metric({ id: `${categoryId}-audits`, label: 'Audite Lighthouse me peshë të vlerësuara', value: scored.length, status: 'measured', source: 'lighthouse' });
  if (manual.length) m.limitations.push(`${categoryId}: ${manual.length} kontrolle kërkojnë verifikim manual (${manual.slice(0, 4).map((r) => r.id).join(', ')}…)`);
  return { checked: scored.length, discovered: weighted.length, truncated: false };
}

function skippedLh(module: string, category: CategoryKey, reason: string): AuditResult {
  const m = new ModuleBuilder(module, category);
  m.skip('lighthouse', 'Lighthouse', 1, reason);
  return m.build();
}

// ------------------------------------------------------------------ LCP evidence

/** Toleranca kur krahasohet shuma e fazave me LCP-në (rrumbullakime). */
const BREAKDOWN_TOLERANCE_MS = 50;

function lhNode(audit: LhAudit | undefined): { lhId?: string; selector?: string; snippet?: string } | undefined {
  const d = audit?.details;
  const items = d?.type === 'list' && Array.isArray(d.items) ? (d.items as Item[]) : [];
  const n = items.find((i) => i.type === 'node') ?? tableItems(audit).find((i) => i.type === 'node');
  return n ? { lhId: n.lhId as string | undefined, selector: n.selector as string | undefined, snippet: n.snippet as string | undefined } : undefined;
}

/**
 * Evidence për LCP pa përzier matje:
 * - Me throttling "simulate" (parazgjedhja), `largest-contentful-paint` është vlerë e SIMULUAR (Lantern),
 *   ndërsa `lcp-breakdown-insight` llogaritet nga trace-i i VËZHGUAR pa throttling. Fazat mblidhen në
 *   `metrics.observedLargestContentfulPaint`, jo në LCP-në e raportuar.
 * - Ndarja shfaqet vetëm kur shuma e saj përputhet me LCP-në e së njëjtës matje, dhe etiketohet si e vëzhguar.
 * - Elementi raportohet si i njëjtë vetëm kur breakdown dhe lcp-discovery tregojnë të njëjtën nyje.
 */
export function lcpEvidence(lh: LighthouseData, url: string): { evidence: Evidence[]; breakdownMatches: boolean; simulated: boolean } {
  const A = lh.audits;
  const lcp = A['largest-contentful-paint']?.numericValue ?? NaN;
  const simulated = (lh.throttlingMethod ?? 'simulate') === 'simulate';
  const metricsItem = tableItems(A.metrics)[0];
  const observed = typeof metricsItem?.observedLargestContentfulPaint === 'number' ? metricsItem.observedLargestContentfulPaint : undefined;

  const bd = A['lcp-breakdown-insight'];
  const phases = tableItems(bd).filter((i) => typeof i.duration === 'number');
  const sum = phases.reduce((s, i) => s + (i.duration as number), 0);
  const phaseText = phases.map((i) => `${i.label ?? i.subpart}=${Math.round(i.duration as number)}ms`).join(', ');
  // Me simulate, fazat duhet të përputhen me LCP-në e vëzhguar; me devtools/provided, me LCP-në e raportuar.
  const reference = simulated ? observed : lcp;
  const breakdownMatches =
    phases.length > 0 && reference !== undefined && Math.abs(sum - reference) <= Math.max(BREAKDOWN_TOLERANCE_MS, reference * 0.02);

  const bdNode = lhNode(bd);
  const discNode = lhNode(A['lcp-discovery-insight']);
  const sameElement = !!bdNode?.lhId && bdNode.lhId === discNode?.lhId;
  const elementText = bdNode
    ? `${bdNode.selector ?? ''}${bdNode.snippet ? ` ${bdNode.snippet.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`.trim()
    : undefined;

  const measurement = simulated ? 'e simuluar nga Lighthouse (Slow 4G, CPU 4x)' : `e matur (throttling ${lh.throttlingMethod})`;
  const evidence: Evidence[] = [
    {
      type: 'metric', url,
      detected: `LCP=${Math.round(lcp)}ms, ${measurement}${simulated && observed !== undefined ? `; LCP i vëzhguar në të njëjtin ngarkim pa throttling=${Math.round(observed)}ms` : ''}`,
      expected: `LCP ≤ ${LCP.good}ms`,
    },
  ];
  if (elementText) {
    evidence.push({
      type: 'dom', url,
      detected: `Elementi LCP në trace: ${elementText}${sameElement ? ' (i njëjtë te lcp-breakdown dhe lcp-discovery)' : ' (s\'u konfirmua nga një burim i dytë)'}`,
    });
  }
  if (breakdownMatches) {
    evidence.push({
      type: 'metric', url,
      detected: simulated
        ? `Ndarja e LCP-së së VËZHGUAR (${Math.round(reference!)}ms, pa throttling): ${phaseText}; shuma=${Math.round(sum)}ms. Nuk është ndarje e ${Math.round(lcp)}ms të simuluar.`
        : `Ndarja e LCP: ${phaseText}; shuma=${Math.round(sum)}ms = LCP`,
    });
  } else if (phases.length > 0) {
    evidence.push({
      type: 'metric', url,
      detected: `Ndarja nga Lighthouse (shuma=${Math.round(sum)}ms) s'u përdor: s'përputhet me LCP-në ${simulated ? `e vëzhguar (${observed !== undefined ? `${Math.round(observed)}ms` : 'mungon në LHR'})` : `e matur (${Math.round(lcp)}ms)`}, ndaj s'dihet që i përket së njëjtës matje.`,
    });
  }
  return { evidence, breakdownMatches, simulated };
}

// ------------------------------------------------------------------ Performance

export function runPerformance(ctx: AuditContext): AuditResult {
  const reason = unavailable(ctx);
  if (reason) {
    const r = skippedLh('performance', 'performance', reason);
    r.metrics.push(inpMetric());
    return r;
  }
  const lh = (ctx.lighthouse as { value: LighthouseData }).value;
  const m = new ModuleBuilder('performance', 'performance');
  const url = lh.finalDisplayedUrl ?? ctx.url;
  const A = lh.audits;

  const metric = (id: string, auditId: string, label: string, unit: string) => {
    const a = A[auditId];
    const v = a?.numericValue;
    m.metric({
      id, label, unit,
      value: typeof v === 'number' ? (unit === '' ? Number(v.toFixed(3)) : Math.round(v)) : null,
      status: typeof v === 'number' ? 'measured' : 'unavailable',
      source: 'lighthouse (lab, mobile)',
      reason: typeof v === 'number' ? undefined : 'Audit-i s\'ktheu vlerë',
    });
    return typeof v === 'number' ? v : undefined;
  };
  const lcp = metric('lcp', 'largest-contentful-paint', 'LCP', 'ms');
  const cls = metric('cls', 'cumulative-layout-shift', 'CLS', '');
  const tbt = metric('tbt', 'total-blocking-time', 'TBT', 'ms');
  metric('fcp', 'first-contentful-paint', 'FCP', 'ms');
  metric('speed-index', 'speed-index', 'Speed Index', 'ms');
  metric('server-response-time', 'server-response-time', 'TTFB (Lighthouse)', 'ms');
  const observedLcp = tableItems(A.metrics)[0]?.observedLargestContentfulPaint;
  m.metric({
    id: 'lcp-observed', label: 'LCP i vëzhguar (ngarkim pa throttling)', unit: 'ms',
    value: typeof observedLcp === 'number' ? Math.round(observedLcp) : null,
    status: typeof observedLcp === 'number' ? 'measured' : 'unavailable',
    source: 'lighthouse (trace i vëzhguar)',
    reason: typeof observedLcp === 'number' ? undefined : 'LHR s\'ka metrics.observedLargestContentfulPaint',
  });
  m.metric(inpMetric());

  // LCP
  if (lcp === undefined) m.skip('lcp', 'LCP', 3, 'Lighthouse s\'ktheu LCP');
  else {
    const issues: IssueDraft[] = [];
    if (lcp > LCP.good) {
      const { evidence, breakdownMatches, simulated } = lcpEvidence(lh, url);
      issues.push({
        code: lcp > LCP.poor ? 'LCP_POOR' : 'LCP_NEEDS_IMPROVEMENT', scope: 'page', url,
        severity: lcp > LCP.poor ? 'high' : 'medium', impact: 'Performance', impactLevel: lcp > LCP.poor ? 'high' : 'medium', effort: 'medium',
        confidence: 0.9, // lab, një ekzekutim
        message: `LCP ${(lcp / 1000).toFixed(1)}s në mobile (lab${simulated ? ', e simuluar' : ''})`,
        whyItMatters: 'LCP mat sa shpejt shfaqet përmbajtja kryesore; vlera e lartë lidhet me braktisje më të madhe.',
        fix: simulated
          ? `Vlera ${(lcp / 1000).toFixed(1)}s është vlerësim i Lighthouse për rrjet të ngadaltë mobile (Slow 4G, CPU 4x) mbi ngarkimin e regjistruar; ${breakdownMatches ? 'ndarja në evidence i përket ngarkimit të vëzhguar pa throttling dhe tregon vetëm ku shkoi koha atje, jo shkakun e vlerës së simuluar' : 'Lighthouse s\'jep ndarje për vlerën e simuluar'}. Hapi i parë: verifiko me DevTools → Performance (Slow 4G + CPU 4x) ose me disa ekzekutime, pastaj optimizo elementin LCP (madhësia/formati, fetchpriority="high", pa lazy-load) dhe burimet që bllokojnë render-in.`
          : 'Optimizo fazën më të gjatë në ndarjen e LCP (evidence): TTFB → cache/server; load delay/duration → zbulim i hershëm dhe madhësi e burimit; render delay → CSS/JS bllokues.',
        evidence,
      });
    }
    m.check('lcp', 'LCP', 3, issues);
  }

  // CLS
  if (cls === undefined) m.skip('cls', 'CLS', 2, 'Lighthouse s\'ktheu CLS');
  else {
    const issues: IssueDraft[] = [];
    if (cls > CLS.good) {
      const culprits = [...tableItems(A['cls-culprits-insight']), ...tableItems(A['layout-shifts'])];
      issues.push({
        code: cls > CLS.poor ? 'CLS_POOR' : 'CLS_NEEDS_IMPROVEMENT', scope: 'page', url,
        severity: cls > CLS.poor ? 'high' : 'medium', impact: 'Performance/UX', impactLevel: cls > CLS.poor ? 'high' : 'medium', effort: 'medium',
        confidence: 0.9,
        message: `CLS ${cls.toFixed(3)} (lab)`,
        whyItMatters: 'Zhvendosjet e layout-it gjatë ngarkimit shkaktojnë klikime të gabuara dhe përvojë të paqëndrueshme.',
        fix: 'Rezervo hapësirë për imazhe/embed/reklama (width/height ose aspect-ratio), shmang futjen e përmbajtjes mbi atë ekzistuese, përdor font-display me fallback të ngjashëm.',
        evidence: [
          { type: 'metric', url, detected: `CLS=${cls.toFixed(3)}`, expected: `CLS ≤ ${CLS.good}` },
          ...culprits.slice(0, 3).map((i) => ({ type: 'metric' as const, url, detected: summarizeItem(i) })).filter((e) => e.detected),
        ],
      });
    }
    m.check('cls', 'CLS', 2, issues);
  }

  // TBT (proxy laboratorik për interaktivitetin — jo INP)
  if (tbt === undefined) m.skip('tbt', 'TBT', 2, 'Lighthouse s\'ktheu TBT');
  else {
    const issues: IssueDraft[] = [];
    if (tbt > TBT.good) {
      const scripts = tableItems(A['bootup-time']).slice(0, 3);
      issues.push({
        code: tbt > TBT.poor ? 'TBT_POOR' : 'TBT_NEEDS_IMPROVEMENT', scope: 'page', url,
        severity: tbt > TBT.poor ? 'high' : 'medium', impact: 'Performance (interaktivitet)', impactLevel: tbt > TBT.poor ? 'high' : 'medium', effort: 'high',
        confidence: 0.85,
        message: `TBT ${Math.round(tbt)} ms (lab, mobile)`,
        whyItMatters: 'Thread-i kryesor i zënë nga JavaScript vonon reagimin ndaj klikimeve. (TBT është proxy laboratorik; INP real kërkon të dhëna fushore.)',
        fix: 'Redukto/ndaj JS (code-splitting), vono script-et jo-kritike dhe të palëve të treta, shmang task-et e gjata.',
        evidence: [
          { type: 'metric', url, detected: `TBT=${Math.round(tbt)}ms`, expected: `TBT ≤ ${TBT.good}ms` },
          ...scripts.map((i) => ({ type: 'metric' as const, url, detected: summarizeItem(i) })),
        ],
      });
    }
    m.check('tbt', 'TBT', 2, issues);
  }

  // Insights me kursim të vlerësuar → shkaqe konkrete (jo pjesë e pikëzimit; score vjen nga Lighthouse)
  const perfRefs = lh.categories.performance?.auditRefs ?? [];
  const insights = perfRefs
    .map((r) => A[r.id])
    .filter((a): a is LhAudit => !!a && !COVERED_BY_METRIC_CHECKS.has(a.id) && a.scoreDisplayMode === 'metricSavings' && typeof a.score === 'number' && a.score < 0.9)
    .map((a) => ({ a, ms: Math.max(a.metricSavings?.LCP ?? 0, a.metricSavings?.FCP ?? 0), cls: a.metricSavings?.CLS ?? 0, tbt: a.metricSavings?.TBT ?? 0 }))
    .filter((x) => x.ms >= 150 || x.cls >= 0.05 || x.tbt >= 100)
    .sort((x, y) => y.ms + y.tbt - (x.ms + x.tbt))
    .slice(0, MAX_INSIGHT_ISSUES);
  const insightIssues: IssueDraft[] = insights.map(({ a, ms, cls: c, tbt: t }) => {
    const severity: Severity = ms >= 1000 || t >= 500 || c >= 0.1 ? 'medium' : 'low';
    const savings = [ms ? `LCP/FCP ≈${Math.round(ms)}ms` : '', t ? `TBT ≈${Math.round(t)}ms` : '', c ? `CLS ≈${c.toFixed(2)}` : ''].filter(Boolean).join(', ');
    return {
      code: `LH_${a.id.replace(/-insight$/, '').replace(/-/g, '_').toUpperCase()}`,
      scope: 'page', url, severity, impact: 'Performance', impactLevel: severity === 'medium' ? 'medium' : 'low', effort: 'medium',
      confidence: 0.8, // kursimet janë vlerësime të Lighthouse
      message: `${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''}`,
      whyItMatters: `Kursim i vlerësuar nga Lighthouse: ${savings}.`,
      fix: stripMarkdown(a.description).slice(0, 400),
      evidence: auditEvidence(a, url),
    };
  });
  if (insightIssues.length) m.info('lh-insights', 'Diagnoza Lighthouse (shkaqe)', [`${insightIssues.length} diagnoza me kursim të vlerësuar`], insightIssues);

  m.limitations.push(
    `Performance: rezultat laboratorik Lighthouse ${lh.lighthouseVersion} (mobile, throttling ${lh.throttlingMethod ?? 'simulate'}), vetëm faqja hyrëse, një ekzekutim — nuk përfaqëson gjithë sitin dhe ndryshon mes ekzekutimeve.`,
    'INP: unavailable — s\'ka të dhëna fushore (CrUX) të konfiguruara; INP s\'matet në laborator.',
  );
  if (lh.runWarnings.length) m.limitations.push(...lh.runWarnings.map((w) => `Lighthouse warning: ${w}`));
  for (const f of lh.failedAttempts ?? []) {
    m.limitations.push(`Lighthouse: përpjekja ${f.attempt} dështoi (${f.code ?? 'gabim'}) — gabim i regjistrimit të trace-it në Chrome, jo i faqes; rezultati është nga përpjekja ${lh.failedAttempts.length + 1}.`);
  }
  if (lh.blockedRequests.length) {
    m.limitations.push(`${lh.blockedRequests.length} kërkesa të browser-it drejt adresave lokale/private u bllokuan (p.sh. ${lh.blockedRequests[0]!.url}).`);
  }
  const coverage = coverageChecks(m, lh, 'performance');
  return m.build({ score: lhScore(lh, 'performance'), coverage });
}

function inpMetric() {
  return {
    id: 'inp', label: 'INP', value: null, unit: 'ms', status: 'unavailable' as const, source: 'field data (CrUX)',
    reason: 'S\'ka të dhëna reale (CrUX) të konfiguruara; INP nuk matet në laborator',
  };
}

// ---------------------------------------------------------------- Accessibility

export function runAccessibility(ctx: AuditContext): AuditResult {
  const reason = unavailable(ctx);
  if (reason) return skippedLh('accessibility', 'accessibility', reason);
  const lh = (ctx.lighthouse as { value: LighthouseData }).value;
  const m = new ModuleBuilder('accessibility', 'accessibility');
  const url = lh.finalDisplayedUrl ?? ctx.url;
  const refs = (lh.categories.accessibility?.auditRefs ?? []).filter((r) => r.weight > 0 && lh.audits[r.id]?.score === 0);
  const issues: IssueDraft[] = refs
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_A11Y_ISSUES)
    .map((r) => {
      const a = lh.audits[r.id]!;
      const count = tableItems(a).length;
      const high = r.weight >= 7;
      return {
        code: `A11Y_${r.id.replace(/-/g, '_').toUpperCase()}`,
        scope: 'page', url, severity: high ? 'medium' : 'low', impact: 'Accessibility', impactLevel: high ? 'medium' : 'low', effort: 'low',
        message: `${a.title}${count ? ` (${count} elemente)` : ''}`,
        whyItMatters: 'Pengon përdoruesit me lexues ekrani, tastierë ose shikim të kufizuar.',
        fix: stripMarkdown(a.description).slice(0, 400),
        evidence: auditEvidence(a, url),
      } satisfies IssueDraft;
    });
  if (issues.length) m.info('lh-a11y', 'Dështime automatike të aksesueshmërisë', [`${refs.length} audite dështuan`], issues);
  m.limitations.push('Accessibility: vetëm kontrolle automatike (axe/Lighthouse). Navigimi me tastierë dhe lexues ekrani kërkojnë verifikim manual.');
  const coverage = coverageChecks(m, lh, 'accessibility');
  return m.build({ score: lhScore(lh, 'accessibility'), coverage });
}

// ---------------------------------------------------------------- Best Practices

export function runBestPractices(ctx: AuditContext): AuditResult {
  const reason = unavailable(ctx);
  if (reason) return skippedLh('best-practices', 'bestPractices', reason);
  const lh = (ctx.lighthouse as { value: LighthouseData }).value;
  const m = new ModuleBuilder('best-practices', 'bestPractices');
  const url = lh.finalDisplayedUrl ?? ctx.url;
  const refs = (lh.categories['best-practices']?.auditRefs ?? []).filter((r) => {
    const a = lh.audits[r.id];
    return r.weight > 0 && typeof a?.score === 'number' && a.score < 0.9;
  });
  const issues: IssueDraft[] = refs.map((r) => {
    const a = lh.audits[r.id]!;
    return {
      code: `BP_${r.id.replace(/-/g, '_').toUpperCase()}`,
      scope: 'page', url, severity: 'low', impact: 'Best practices', impactLevel: 'low', effort: 'low',
      message: `${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''}`,
      whyItMatters: 'Sinjal cilësie/sigurie nga Lighthouse (p.sh. gabime në console, API të vjetruara).',
      fix: stripMarkdown(a.description).slice(0, 400),
      evidence: auditEvidence(a, url),
    };
  });
  if (issues.length) m.info('lh-bp', 'Best practices që dështuan', [`${refs.length} audite`], issues);
  const coverage = coverageChecks(m, lh, 'best-practices');
  return m.build({ score: lhScore(lh, 'best-practices'), coverage });
}
