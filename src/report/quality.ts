import type { AuditRun } from '../core/run.js';
import type { Issue } from '../core/schemas.js';
import { QUALITY_CATEGORY_LABELS, type QualityCategoryKey } from '../core/schemas.js';
import { QUALITY_DISCLAIMER } from '../modules/quality/quality.js';
import { VIEWPORTS } from '../visual/capture.js';

export interface QualityIssueGroup {
  code: string;
  severity: Issue['severity'];
  confidence: number;
  priority: number;
  /** Sa gjetje (një për faqe) ndajnë të njëjtin model. */
  count: number;
  pages: string[];
  summary: string;
  fix: string;
  /** Prova e gjetjes së parë (shembull); provat e plota mbeten te issues[]. */
  example: string;
}

const GROUP_SUMMARY: Record<string, (names: string[]) => string> = {
  LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT: (names) => `Linke me emër të përgjithshëm (${names.join(', ')}) brenda kartave me titull — mund të jenë të paqarta kur lexohen veçmas`,
};

/**
 * Grupon gjetjet me të njëjtin model: i njëjti kod, severity, confidence dhe e njëjta formë prove
 * (p.sh. "emri i aksesueshëm: "…" (burimi: teksti i dukshëm…)"), që ndryshojnë vetëm te faqja dhe emri.
 * Vetëm për përmbledhje (terminal); issues[] në JSON mbeten veç, me URL dhe prova për secilën faqe.
 */
export function groupQualityIssues(issues: Issue[]): QualityIssueGroup[] {
  const shape = (i: Issue) => (i.evidence[0]?.detected.split(' · ')[0] ?? '').replace(/"[^"]*"/g, '"…"');
  const groups = new Map<string, Issue[]>();
  for (const i of issues) {
    const key = `${i.code}\u0000${i.severity}\u0000${i.confidence}\u0000${shape(i)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0]!;
    const names = [...new Set(list.map((i) => i.evidence[0]?.detected.match(/"([^"]*)"/)?.[1]).filter((n): n is string => !!n))];
    const summarize = GROUP_SUMMARY[first.code];
    return {
      code: first.code,
      severity: first.severity,
      confidence: first.confidence,
      priority: Math.max(...list.map((i) => i.priority)),
      count: list.length,
      pages: [...new Set(list.flatMap((i) => i.affectedPages))],
      summary: list.length > 1 && summarize ? summarize(names.map((n) => `"${n}"`)) : first.message,
      fix: first.fix,
      example: first.evidence[0]?.detected ?? '',
    };
  });
}

/**
 * Seksioni "quality": cilësia e përmbajtjes dhe identiteti vizual. Pa score (sinjale), jashtë
 * Health Score-it. Për pamjen: çdo pamje e renderuar me screenshot-in dhe matjet kryesore.
 */
export function buildQualitySection(run: AuditRun) {
  const results = run.results.filter((r) => r.section === 'quality');
  const statuses = Object.fromEntries(
    (Object.keys(QUALITY_CATEGORY_LABELS) as QualityCategoryKey[]).map((k) => {
      const r = results.find((x) => x.category === k);
      return [k, r ? { status: r.status, partial: r.partial, reason: r.reason, coverage: r.coverage } : { status: 'skipped', reason: 'Moduli s\'u ekzekutua' }];
    }),
  );
  if (!run.config.quality.enabled) return { status: 'skipped' as const, reason: 'Cilësia u çaktivizua (--no-quality)', statuses, issues: [] };
  const v = run.context?.visual;
  return {
    status: results.some((r) => r.partial || r.status === 'skipped') ? ('partial' as const) : ('completed' as const),
    disclaimer: QUALITY_DISCLAIMER,
    /** Pa score me qëllim: vetëm statusi (info/skipped) dhe mbulimi. */
    statuses,
    visual:
      v?.status === 'ok'
        ? {
            screenshotsDir: v.value.screenshotsDir,
            limits: v.value.limits,
            blockedRequests: v.value.blockedRequests.length,
            browserVersion: v.value.browserVersion,
            captures: v.value.captures.map((c) => ({
              url: c.url,
              pageType: c.pageType,
              viewport: c.viewport,
              status: c.status,
              reason: c.reason,
              screenshot: c.screenshot,
              // Metadatat e kapjes, për krahasimin mes auditeve (raportet e vjetra s'i kanë).
              finalUrl: c.finalUrl,
              viewportSize: c.viewportSize,
              measuredViewport: c.measuredViewport,
              clip: c.clip,
              screenshotSize: c.screenshotSize,
              capturedAt: c.capturedAt,
              summary: c.probe && {
                documentHeight: c.probe.documentHeight,
                horizontalOverflowPx: Math.max(0, c.probe.scrollWidth - VIEWPORTS[c.viewport].width),
                sections: c.probe.sections.map((s) => s.kind).join(' → '),
                cardGroupsInMain: c.probe.cardGroups.filter((g) => g.region === 'main').map((g) => ({ selector: g.selector, count: g.count, size: `${g.width}×${g.height}`, icon: g.hasIcon, heading: g.hasHeading, image: g.hasImage })),
                largeGradientsInMain: c.probe.gradients.filter((g) => !g.textClip && g.region === 'main').length,
                textGradients: c.probe.gradients.filter((g) => g.textClip).length,
                imagesInMain: c.probe.images.filter((i) => i.region === 'main').length,
                fonts: c.probe.fonts,
              },
            })),
          }
        : { status: v?.status ?? 'skipped', reason: v?.status === 'error' ? v.error : v?.status === 'skipped' ? v.reason : 'Renderimi s\'u kërkua' },
    /** Gjetje me të njëjtin model, të grupuara (numri i faqeve); provat e plota janë te issues. */
    groups: groupQualityIssues(run.qualityIssues).map(({ example: _e, fix: _f, ...g }) => g),
    topSignals: run.qualityIssues.slice(0, 5).map((i) => ({ code: i.code, severity: i.severity, confidence: i.confidence, message: i.message, url: i.url })),
    issues: run.qualityIssues,
  };
}
