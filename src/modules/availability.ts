import type { AuditContext } from '../core/context.js';
import type { AuditResult, IssueDraft } from '../core/schemas.js';
import { ModuleBuilder } from './helpers.js';

const TTFB_OK_MS = 800;
const TTFB_SLOW_MS = 1800;

export function runAvailability(ctx: AuditContext): AuditResult {
  const m = new ModuleBuilder('availability', 'availability');
  const main = ctx.main;

  if (main.status !== 'ok') {
    const err = main.status === 'error' ? main : undefined;
    // Gabim rrjeti nga makina lokale mund të jetë edhe problem i rrjetit tonë → confidence < 0.9.
    const siteSide = err?.code === 'TLS' || err?.code === 'TOO_MANY_REDIRECTS' || err?.code === 'REDIRECT_LOOP';
    m.check('reachable', 'Faqja hyrëse arrihet', 4, [
      {
        code: 'SITE_UNREACHABLE',
        scope: 'site',
        url: ctx.url,
        severity: 'critical',
        impact: 'Availability kritik — vizitorët s\'e hapin faqen',
        impactLevel: 'high',
        effort: 'medium',
        confidence: siteSide ? 1 : 0.8,
        message: `Faqja hyrëse nuk u arrit (${err?.code ?? 'gabim'})`,
        whyItMatters: 'Nëse faqja hyrëse s\'përgjigjet, as vizitorët as motorët e kërkimit s\'e shohin përmbajtjen.',
        fix: siteSide
          ? 'Rregullo certifikatën TLS / ciklin e ridrejtimeve në server ose CDN.'
          : 'Verifiko nga një rrjet tjetër; nëse përsëritet, kontrollo DNS, serverin dhe firewall-in.',
        evidence: [
          {
            type: 'http',
            url: ctx.url,
            detected: err?.error ?? 'pa përgjigje',
            expected: 'Përgjigje HTTP 2xx brenda timeout-it',
            raw: err?.redirects?.length ? err.redirects.map((r) => `${r.status} ${r.url} → ${r.location}`).join('\n') : undefined,
          },
        ],
      },
    ]);
    m.skip('response-time', 'Koha e përgjigjes (TTFB)', 1, 'Faqja s\'u arrit');
    m.skip('redirect-chain', 'Zinxhiri i ridrejtimeve', 1, 'Faqja s\'u arrit');
    return m.build();
  }

  const res = main.value;
  const statusIssues: IssueDraft[] = [];
  if (res.status >= 400) {
    statusIssues.push({
      code: 'HOMEPAGE_HTTP_ERROR',
      scope: 'site',
      url: res.finalUrl,
      severity: 'critical',
      impact: 'Availability dhe SEO kritik',
      impactLevel: 'high',
      effort: 'medium',
      message: `Faqja hyrëse kthen HTTP ${res.status}`,
      whyItMatters: 'Një status 4xx/5xx te faqja hyrëse do të thotë që përmbajtja s\'shërbehet dhe s\'indeksohet.',
      fix: res.status >= 500 ? 'Kontrollo logs e serverit/aplikacionit për gabimin 5xx.' : 'Sigurohu që URL-ja hyrëse shërbehet me 200 (routing, rregulla WAF/bot-protection).',
      evidence: [{ type: 'http', url: res.finalUrl, detected: `HTTP ${res.status} ${res.statusText}`, expected: 'HTTP 200' }],
    });
  } else if (res.status >= 300) {
    statusIssues.push({
      code: 'REDIRECT_WITHOUT_LOCATION',
      scope: 'site',
      url: res.finalUrl,
      severity: 'high',
      impact: 'Availability i lartë',
      impactLevel: 'high',
      effort: 'low',
      message: `Ridrejtim ${res.status} pa header Location`,
      whyItMatters: 'Browser-at dhe crawler-at s\'dinë ku të shkojnë.',
      fix: 'Shto header-in Location me URL-në e synuar.',
      evidence: [{ type: 'http', url: res.finalUrl, detected: `HTTP ${res.status} pa Location`, expected: 'Location: <url>' }],
    });
  }
  m.check('http-status', 'Status HTTP i faqes hyrëse', 4, statusIssues);

  const ttfbIssues: IssueDraft[] = [];
  if (res.ttfbMs > TTFB_OK_MS) {
    ttfbIssues.push({
      code: 'SLOW_SERVER_RESPONSE',
      scope: 'page',
      url: res.finalUrl,
      severity: res.ttfbMs > TTFB_SLOW_MS ? 'medium' : 'low',
      impact: 'Performance/availability',
      impactLevel: 'medium',
      effort: 'medium',
      // Një matje e vetme nga lokacioni ynë — mund të ndikohet nga rrjeti lokal.
      confidence: 0.6,
      message: `TTFB i faqes hyrëse ${res.ttfbMs} ms (matje e vetme lokale)`,
      whyItMatters: 'Përgjigja e ngadaltë e serverit vonon çdo metrikë tjetër të ngarkimit.',
      fix: 'Verifiko me disa matje; nëse konfirmohet: cache në server/CDN, optimizim i query-ve, hosting më afër përdoruesve.',
      evidence: [{ type: 'metric', url: res.finalUrl, detected: `TTFB=${res.ttfbMs}ms, total=${res.totalMs}ms, HTTP/${res.httpVersion}`, expected: `TTFB < ${TTFB_OK_MS}ms` }],
    });
  }
  m.check('response-time', 'Koha e përgjigjes (TTFB)', 1, ttfbIssues);

  const redirectIssues: IssueDraft[] = [];
  if (res.redirects.length >= 2) {
    redirectIssues.push({
      code: 'REDIRECT_CHAIN',
      scope: 'site',
      url: ctx.url,
      severity: 'low',
      impact: 'Performance/SEO i ulët',
      impactLevel: 'low',
      effort: 'low',
      message: `${res.redirects.length} ridrejtime para faqes hyrëse`,
      whyItMatters: 'Çdo hop shton një round-trip; zinxhirët e gjatë ngadalësojnë ngarkimin e parë.',
      fix: `Ridrejto direkt ${ctx.url} → ${res.finalUrl} me një hop të vetëm 301.`,
      evidence: [
        {
          type: 'http',
          url: ctx.url,
          detected: res.redirects.map((r) => `${r.status} ${r.url} → ${r.location}`).join(' | '),
          expected: 'Maksimumi 1 ridrejtim',
        },
      ],
    });
  }
  m.check('redirect-chain', 'Zinxhiri i ridrejtimeve', 1, redirectIssues);

  m.metric({ id: 'http-status', label: 'HTTP status', value: res.status, status: 'measured', source: 'fetch' });
  m.metric({ id: 'ttfb', label: 'TTFB (lokal, 1 matje)', value: res.ttfbMs, unit: 'ms', status: 'measured', source: 'fetch' });
  m.metric({ id: 'total-time', label: 'Koha totale (me ridrejtime)', value: res.totalMs, unit: 'ms', status: 'measured', source: 'fetch' });
  m.metric({ id: 'redirects', label: 'Ridrejtime', value: res.redirects.length, status: 'measured', source: 'fetch' });
  m.metric({ id: 'html-bytes', label: 'Madhësia e HTML (e dekompresuar)', value: res.bodyBytes, unit: 'bytes', status: 'measured', source: 'fetch' });
  m.metric({ id: 'content-encoding', label: 'Content-Encoding', value: res.headers['content-encoding'] ?? 'asnjë', status: 'measured', source: 'fetch' });
  if (res.bodyTruncated) m.limitations.push(`HTML u shkurtua te ${ctx.config.maxResponseBytes} bytes; analiza bazohet në pjesën e marrë.`);
  return m.build();
}
