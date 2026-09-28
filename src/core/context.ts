import type { AuditConfig } from './config.js';
import { FetchError, HostThrottle, safeFetch, type FetchOptions, type FetchResult } from '../net/safe-fetch.js';
import { inspectTls, type TlsInfo } from '../net/tls-info.js';
import { assertUrlAllowed, BlockedUrlError, normalizeInputUrl } from '../net/url-guard.js';
import { isAllowed, parseRobots, type ParsedRobots } from '../parse/robots.js';
import { parseHtml, type ParsedHtml } from '../parse/html.js';
import type { LighthouseData } from '../lighthouse/run-lighthouse.js';

/** Rezultat i një mbledhjeje të dhënash: ok, gabim (me kod), ose e anashkaluar me arsye. */
export type Probe<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; error: string; code?: string; redirects?: FetchResult['redirects'] }
  | { status: 'skipped'; reason: string };

export interface RobotsData {
  url: string;
  httpStatus: number;
  found: boolean;
  parsed?: ParsedRobots;
}

/** Audit Context (§3): të dhëna të mbledhura një herë, të lexuara nga të gjitha modulet. */
export interface AuditContext {
  url: string;
  config: AuditConfig;
  robots: Probe<RobotsData>;
  main: Probe<FetchResult>;
  html: Probe<ParsedHtml>;
  httpVariant: Probe<FetchResult>;
  tls: Probe<TlsInfo>;
  canonicalTarget: Probe<FetchResult>;
  lighthouse: Probe<LighthouseData>;
}

export class RobotsBlockedError extends Error {
  constructor(message: string, readonly robotsUrl: string, readonly line?: number) {
    super(message);
    this.name = 'RobotsBlockedError';
  }
}

export function fetchOptions(config: AuditConfig, throttle?: HostThrottle): FetchOptions {
  return {
    timeout: config.timeout,
    maxResponseBytes: config.maxResponseBytes,
    maxRedirects: config.maxRedirects,
    userAgent: config.userAgent,
    allowedPrivateHosts: config.allowedPrivateHosts,
    throttle,
  };
}

function errorProbe(err: unknown): Probe<never> {
  if (err instanceof FetchError) return { status: 'error', error: err.message, code: err.code, redirects: err.redirects };
  const e = err as Error & { code?: string };
  return { status: 'error', error: e?.message ?? String(err), code: e?.code };
}

async function probe<T>(fn: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { status: 'ok', value: await fn() };
  } catch (err) {
    return errorProbe(err);
  }
}

export function isHtml(res: FetchResult): boolean {
  const ct = res.headers['content-type'] ?? '';
  return /text\/html|application\/xhtml\+xml/i.test(ct) || (!ct && /<html[\s>]/i.test(res.body.slice(0, 2000)));
}

export interface CollectHooks {
  onStep?: (step: string) => void;
  runLighthouse?: (url: string, config: AuditConfig) => Promise<LighthouseData>;
}

/**
 * Ndërton kontekstin për MVP-1: robots.txt → faqja hyrëse → variant http → TLS →
 * target i canonical (vetëm kur ndryshon) → Lighthouse mobile. Pa crawl.
 */
export async function collectContext(input: string, config: AuditConfig, hooks: CollectHooks = {}): Promise<AuditContext> {
  const url = normalizeInputUrl(input);
  assertUrlAllowed(url, config.allowedPrivateHosts);
  const throttle = new HostThrottle(config.requestDelay);
  const opts = fetchOptions(config, throttle);
  const step = hooks.onStep ?? (() => {});

  // 1. robots.txt — edhe si sinjal SEO, edhe si "leje" për tool-in (§7).
  step('robots.txt');
  const robotsUrl = new URL('/robots.txt', url).href;
  const robots = await probe<RobotsData>(async () => {
    const res = await safeFetch(robotsUrl, { ...opts, maxResponseBytes: 512 * 1024 });
    const found = res.status >= 200 && res.status < 300;
    return { url: res.finalUrl, httpStatus: res.status, found, parsed: found ? parseRobots(res.body) : undefined };
  });
  if (config.respectRobots && robots.status === 'ok' && robots.value.parsed) {
    const decision = isAllowed(robots.value.parsed, config.userAgent, url.pathname + url.search);
    if (!decision.allowed) {
      throw new RobotsBlockedError(
        `robots.txt ndalon ${url.pathname} për user-agent "${decision.matchedAgent}" (rreshti ${decision.rule?.line}: Disallow: ${decision.rule?.pattern})`,
        robotsUrl,
        decision.rule?.line,
      );
    }
  }

  // 2. Faqja hyrëse
  step('faqja hyrëse');
  const main = await probe(() => safeFetch(url, opts));
  if (main.status === 'error' && main.code === 'BLOCKED') {
    // Host ose ridrejtim drejt adrese lokale/private: auditi ndalet, s'raportohet si "site down".
    throw new BlockedUrlError(main.error, url.href);
  }
  let html: Probe<ParsedHtml>;
  if (main.status !== 'ok') html = { status: 'skipped', reason: `Faqja hyrëse s'u mor: ${main.status === 'error' ? main.error : ''}` };
  else if (!isHtml(main.value)) html = { status: 'skipped', reason: `Përgjigja s'është HTML (content-type: ${main.value.headers['content-type'] ?? 'mungon'})` };
  else html = await probe(async () => parseHtml(main.value.body, main.value.finalUrl));

  const finalUrl = main.status === 'ok' ? new URL(main.value.finalUrl) : url;

  // 3. Varianti http:// (a ridrejton te https?)
  let httpVariant: Probe<FetchResult>;
  if (finalUrl.protocol !== 'https:') {
    httpVariant = { status: 'skipped', reason: 'Faqja nuk shërbehet me HTTPS' };
  } else {
    step('varianti http://');
    const httpUrl = new URL(finalUrl.href);
    httpUrl.protocol = 'http:';
    httpUrl.port = '';
    httpVariant = await probe(() => safeFetch(httpUrl, { ...opts, maxResponseBytes: 256 * 1024 }));
  }

  // 4. Certifikata TLS (lokalisht)
  let tls: Probe<TlsInfo>;
  if (finalUrl.protocol !== 'https:') tls = { status: 'skipped', reason: 'Faqja nuk shërbehet me HTTPS' };
  else {
    step('certifikata TLS');
    tls = await probe(() => inspectTls(finalUrl, config.timeout, config.allowedPrivateHosts));
  }

  // 5. Target i canonical — vetëm kur tregon URL tjetër (1 kërkesë, jo crawl)
  let canonicalTarget: Probe<FetchResult> = { status: 'skipped', reason: 'Canonical mungon ose tregon vetë faqen' };
  if (html.status === 'ok' && main.status === 'ok') {
    const targets = [...new Set(html.value.canonicals.map((c) => c.resolved).filter((u): u is string => !!u))];
    const target = targets.length === 1 ? targets[0]! : undefined;
    if (target && target !== main.value.finalUrl) {
      step('target i canonical');
      canonicalTarget = await probe(() => safeFetch(target, { ...opts, maxResponseBytes: 256 * 1024 }));
    }
  }

  // 6. Lighthouse mobile për faqen hyrëse
  let lighthouse: Probe<LighthouseData>;
  if (!config.lighthouse.enabled) lighthouse = { status: 'skipped', reason: 'Lighthouse u çaktivizua (--no-lighthouse)' };
  else if (main.status !== 'ok') lighthouse = { status: 'skipped', reason: 'Faqja hyrëse s\'u arrit; Lighthouse s\'u ekzekutua' };
  else if (!hooks.runLighthouse) lighthouse = { status: 'skipped', reason: 'Runner i Lighthouse mungon' };
  else {
    step('Lighthouse (mobile)');
    lighthouse = await probe(() => hooks.runLighthouse!(url.href, config));
  }

  return { url: url.href, config, robots, main, html, httpVariant, tls, canonicalTarget, lighthouse };
}
