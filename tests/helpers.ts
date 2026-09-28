import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import type { AuditContext, Probe, RobotsData } from '../src/core/context.js';
import type { FetchResult } from '../src/net/safe-fetch.js';
import { parseHtml } from '../src/parse/html.js';
import { parseRobots } from '../src/parse/robots.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import type { TlsInfo } from '../src/net/tls-info.js';

export const fixture = (name: string) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');

export function fetchResult(over: Partial<FetchResult> = {}): FetchResult {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html></html>',
    bodyTruncated: false,
    bodyBytes: 13,
    redirects: [],
    ttfbMs: 120,
    totalMs: 150,
    httpVersion: '1.1',
    ...over,
  };
}

export interface CtxOptions {
  html?: string;
  url?: string;
  headers?: Record<string, string>;
  main?: Probe<FetchResult>;
  robotsTxt?: string | null;
  robotsStatus?: number;
  httpVariant?: Probe<FetchResult>;
  tls?: Probe<TlsInfo>;
  canonicalTarget?: Probe<FetchResult>;
  lighthouse?: Probe<LighthouseData>;
}

/** Ndërton AuditContext pa rrjet, për të testuar modulet mbi fixtures. */
export function makeCtx(o: CtxOptions = {}): AuditContext {
  const url = o.url ?? 'https://example.com/';
  const body = o.html ?? fixture('good.html');
  const main: Probe<FetchResult> =
    o.main ?? { status: 'ok', value: fetchResult({ finalUrl: url, requestedUrl: url, body, headers: { 'content-type': 'text/html', ...(o.headers ?? {}) } }) };
  const html = main.status === 'ok' ? { status: 'ok' as const, value: parseHtml(main.value.body, main.value.finalUrl) } : { status: 'skipped' as const, reason: 'Faqja hyrëse s\'u mor' };
  const robotsStatus = o.robotsStatus ?? (o.robotsTxt === null ? 404 : 200);
  const robots: Probe<RobotsData> = {
    status: 'ok',
    value: {
      url: new URL('/robots.txt', url).href,
      httpStatus: robotsStatus,
      found: robotsStatus === 200,
      parsed: robotsStatus === 200 ? parseRobots(o.robotsTxt ?? 'User-agent: *\nDisallow: /admin\n') : undefined,
    },
  };
  return {
    url,
    config: { ...DEFAULT_CONFIG },
    robots,
    main,
    html,
    httpVariant: o.httpVariant ?? { status: 'ok', value: fetchResult({ requestedUrl: 'http://example.com/', finalUrl: url, redirects: [{ url: 'http://example.com/', status: 301, location: url }] }) },
    tls: o.tls ?? { status: 'ok', value: { host: 'example.com', authorized: true, daysRemaining: 80, validTo: '2026-12-17T00:00:00.000Z', issuer: 'Test CA' } },
    canonicalTarget: o.canonicalTarget ?? { status: 'skipped', reason: 'n/a' },
    lighthouse: o.lighthouse ?? { status: 'skipped', reason: 'Lighthouse u çaktivizua (test)' },
  };
}

export function lighthouseFixture(): LighthouseData {
  return JSON.parse(fixture('lighthouse-webdev.json')) as LighthouseData;
}
