import type { AuditContext } from '../../core/context.js';
import type { AuditResult, IssueDraft } from '../../core/schemas.js';
import type { CrawledPage, LinkEdge } from '../../crawler/crawler.js';
import { ModuleBuilder } from '../helpers.js';
import { crawlCoverage, crawlUnavailable, notCheckedSummary } from './common.js';

/** Sa burime tregohen si provë për një link të prishur. */
const MAX_SOURCES = 3;
/** Nëse i njëjti target lidhet nga kaq faqe, ka shumë gjasa të jetë në menu/footer (template). */
const TEMPLATE_LINK_THRESHOLD = 3;
const MAX_SEPARATE_BROKEN = 10;

function sourcesText(inbound: LinkEdge[]): string {
  const shown = inbound.slice(0, MAX_SOURCES).map((e) => `${e.from}${e.text ? ` ("${e.text}")` : ''}`);
  const more = inbound.length > MAX_SOURCES ? ` … +${inbound.length - MAX_SOURCES}` : '';
  return shown.length ? `lidhet nga: ${shown.join(', ')}${more}` : 'pa link hyrës (nga sitemap)';
}

export function runLinks(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('links', 'links');
  const unavailable = crawlUnavailable(ctx);
  if (unavailable || ctx.crawl.status !== 'ok') {
    m.skip('broken-links', 'Linke të brendshme të prishura', 3, unavailable ?? 'Pa crawl');
    return m.build({ score: null, reason: unavailable });
  }
  const crawl = ctx.crawl.value;
  const inbound = new Map<string, LinkEdge[]>();
  for (const e of crawl.edges) inbound.set(e.to, [...(inbound.get(e.to) ?? []), e]);

  // Vetëm faqe të arritura me link (jo faqja hyrëse; ato nga sitemap-i i vlerëson moduli Sitemap).
  const targets = crawl.pages.filter((p) => p.source === 'link');
  const linked = (p: CrawledPage) => inbound.get(p.url) ?? [];

  m.metric({ id: 'pages-fetched', label: 'Faqe të kërkuara (me faqen hyrëse)', value: crawl.pages.length, status: 'measured', source: 'crawl' });
  m.metric({ id: 'internal-link-targets-checked', label: 'Target-e linkesh të brendshme të kontrolluara', value: targets.length, status: 'measured', source: 'crawl' });
  m.metric({ id: 'internal-links', label: 'Linke të brendshme të gjetura', value: crawl.edges.length, status: 'measured', source: 'crawl' });
  m.metric({ id: 'external-links', label: 'Linke të jashtme (s\'kontrollohen)', value: crawl.externalLinks.count, status: 'measured', source: 'crawl' });
  m.limitations.push(
    `Linke: ${targets.length} target-e të brendshme u kontrolluan; pa kontroll: ${notCheckedSummary(crawl)}.`,
    'Linket e jashtme dhe skedarët (PDF, imazhe, CSS/JS) nuk kontrollohen në këtë hap.',
  );
  if (crawl.stopReason) m.limitations.push(`Crawl-i u ndal: ${crawl.stopReason}.`);

  if (targets.length === 0) {
    m.skip('broken-links', 'Linke të brendshme të prishura', 3, `Crawl-i s'kontrolloi asnjë faqe përtej hyrëses (pa kontroll: ${notCheckedSummary(crawl)})`);
    return m.build({ score: null, coverage: crawlCoverage(crawl, 0) });
  }

  // --- Linke të prishura (404/410/5xx dhe 4xx të tjera, pa 401/403/429) ---
  const broken = targets.filter((p) => p.status !== undefined && p.access === 'http-error');
  const drafts: IssueDraft[] = broken.map((p) => {
    const inb = linked(p);
    const server = (p.status ?? 0) >= 500;
    const template = inb.length >= TEMPLATE_LINK_THRESHOLD;
    return {
      code: server ? 'INTERNAL_LINK_SERVER_ERROR' : 'BROKEN_INTERNAL_LINK',
      scope: template ? 'template' : 'page',
      url: p.url,
      affectedPages: [...new Set(inb.map((e) => e.from))],
      severity: server ? 'high' : 'medium',
      impact: 'SEO dhe përvojë përdoruesi',
      impactLevel: template ? 'high' : 'medium',
      effort: 'low',
      confidence: server ? 0.8 : 1, // 5xx mund të jetë kalimtar (një matje)
      message: `Link i brendshëm te ${p.url} kthen HTTP ${p.status}${template ? ` — nga ${inb.length} faqe (ka gjasa menu/footer)` : ''}`,
      whyItMatters: 'Vizitorët dhe crawler-at përfundojnë në faqe gabimi; autoriteti i linkut humbet.',
      fix: server
        ? 'Kontrollo log-et e serverit për këtë URL; nëse faqja s\'ekziston më, përditëso ose hiq linket.'
        : `Përditëso linket te URL-ja e saktë ose shto ridrejtim 301 nëse faqja u zhvendos${template ? ' (rregullo një herë në menu/footer të template-it)' : ''}.`,
      evidence: [{ type: 'crawl', url: p.url, detected: `HTTP ${p.status}${p.redirects.length ? ` pas ${p.redirects.length} ridrejtimesh` : ''}; ${sourcesText(inb)}`, expected: 'HTTP 200' }],
    };
  });
  if (drafts.length > MAX_SEPARATE_BROKEN) {
    const rest = drafts.splice(MAX_SEPARATE_BROKEN);
    drafts.push({
      ...rest[0]!,
      scope: 'site',
      affectedPages: rest.map((d) => d.url!),
      message: `${rest.length} linke të tjera të brendshme të prishura`,
      evidence: rest.slice(0, 5).flatMap((d) => d.evidence),
    });
  }
  m.check('broken-links', 'Linke të brendshme të prishura', 3, drafts);

  // --- Target-e të bllokuara / të paarritshme: të paverifikuara, jo "të prishura" ---
  const blocked = targets.filter((p) => p.access === 'blocked');
  const failed = targets.filter((p) => p.error);
  const unverified: IssueDraft[] = [];
  if (blocked.length) {
    unverified.push({
      code: 'LINKED_PAGE_ACCESS_DENIED', scope: 'site', url: blocked[0]!.url, affectedPages: blocked.map((p) => p.url),
      severity: 'low', impact: 'I pasigurt: bllokim për klientin e auditimit', impactLevel: 'medium', effort: 'low', confidence: 0.4,
      message: `${blocked.length} faqe të brendshme kthyen 401/403/429 për crawler-in — kërkon verifikim`,
      whyItMatters: 'Mund të jetë mbrojtje (WAF/rate limit) ndaj crawler-it, jo faqe e prishur për vizitorët.',
      fix: 'Hap URL-të në browser; nëse hapen, s\'është problem i linkut. Nëse jo, kontrollo rregullat e WAF/serverit.',
      evidence: blocked.slice(0, 5).map((p) => ({ type: 'crawl' as const, url: p.url, detected: `HTTP ${p.status}; ${sourcesText(linked(p))}` })),
    });
  }
  if (failed.length) {
    unverified.push({
      code: 'LINK_TARGET_UNREACHABLE', scope: 'site', url: failed[0]!.url, affectedPages: failed.map((p) => p.url),
      severity: 'low', impact: 'I pasigurt', impactLevel: 'medium', effort: 'low', confidence: 0.5,
      message: `${failed.length} faqe të brendshme s'u arritën (timeout/rrjet/ridrejtim i palejuar)`,
      whyItMatters: 'Një gabim i vetëm rrjeti s\'provon që faqja është e prishur; verifikoje.',
      fix: 'Riprovo URL-të; nëse gabimi përsëritet, kontrollo serverin ose ridrejtimet.',
      evidence: failed.slice(0, 5).map((p) => ({ type: 'crawl' as const, url: p.url, detected: `${p.error!.code}: ${p.error!.message}; ${sourcesText(linked(p))}` })),
    });
  }
  if (unverified.length) m.info('unverified-targets', 'Target-e të paverifikuara', [`${blocked.length} të bllokuara, ${failed.length} të paarritshme`], unverified);

  // --- Linke të brendshme që kalojnë nga ridrejtime ---
  const redirected = targets.filter((p) => p.redirects.length > 0 && !p.external && p.access === 'ok');
  const redirectIssues: IssueDraft[] = redirected.length
    ? [{
        code: 'INTERNAL_LINKS_VIA_REDIRECT', scope: 'site', url: redirected[0]!.url, affectedPages: redirected.map((p) => p.url),
        severity: 'low', impact: 'SEO/performance i ulët', impactLevel: 'low', effort: 'low',
        message: `${redirected.length} linke të brendshme tregojnë URL që ridrejtojnë`,
        whyItMatters: 'Çdo ridrejtim shton një round-trip dhe e bën strukturën e linkeve më pak të qartë.',
        fix: 'Përditëso linket që të tregojnë direkt URL-në përfundimtare.',
        evidence: redirected.slice(0, 5).map((p) => ({
          type: 'crawl' as const, url: p.url,
          detected: `${p.redirects.map((r) => `${r.status} → ${r.location}`).join(' → ')}; ${sourcesText(linked(p))}`,
          expected: `Link direkt te ${p.finalUrl}`,
        })),
      }]
    : [];
  const external = targets.filter((p) => p.external);
  m.check('link-redirects', 'Linke përmes ridrejtimeve', 1, redirectIssues, external.length ? [`${external.length} linke të brendshme ridrejtojnë jashtë sitit`] : undefined);

  return m.build({ coverage: crawlCoverage(crawl, targets.length) });
}
