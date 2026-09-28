import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditConfig } from '../core/config.js';
import { startGuardProxy } from '../net/guard-proxy.js';
import { assertUrlAllowed } from '../net/url-guard.js';

/** Pjesa e LHR që përdorin modulet (tipizim minimal, jo i plotë). */
export interface LhAuditRef {
  id: string;
  weight: number;
  group?: string;
}

export interface LhAudit {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
  numericValue?: number;
  numericUnit?: string;
  metricSavings?: Record<string, number>;
  details?: Record<string, unknown> & { type?: string; items?: unknown };
}

export interface LhCategory {
  id: string;
  title: string;
  score: number | null;
  auditRefs: LhAuditRef[];
}

export interface LighthouseData {
  lighthouseVersion: string;
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  mainDocumentUrl?: string;
  fetchTime: string;
  formFactor: string;
  screenEmulation?: unknown;
  throttlingMethod?: string;
  hostUserAgent?: string;
  networkUserAgent?: string;
  benchmarkIndex?: number;
  runWarnings: string[];
  categories: Record<string, LhCategory>;
  audits: Record<string, LhAudit>;
  /** Kërkesa të browser-it të bllokuara nga guard proxy. */
  blockedRequests: { url: string; reason: string }[];
}

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const TOTAL_TIMEOUT_MS = 150_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timeout pas ${ms / 1000}s`)), ms);
    }),
  ]);
}

/**
 * Lighthouse mobile (parazgjedhja e LH: emulim mobile + throttling i simuluar) mbi
 * faqen hyrëse. Chrome kalon përmes guard proxy që bllokon localhost/IP private.
 */
export async function runLighthouse(url: string, config: AuditConfig): Promise<LighthouseData> {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([import('lighthouse'), import('chrome-launcher')]);
  const proxy = await startGuardProxy(config.allowedPrivateHosts);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-auditor-chrome-'));
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | undefined;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: config.lighthouse.chromePath,
      userDataDir,
      chromeFlags: [
        '--headless=new',
        '--no-first-run',
        '--disable-extensions',
        `--proxy-server=http://127.0.0.1:${proxy.port}`,
        // Pa këtë, Chrome e anashkalon proxy-n për localhost/loopback.
        '--proxy-bypass-list=<-loopback>',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      ],
    });
    const result = await withTimeout(
      lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: CATEGORIES,
        formFactor: 'mobile',
        maxWaitForLoad: config.lighthouse.maxWaitForLoad,
      }),
      TOTAL_TIMEOUT_MS,
      'Lighthouse',
    );
    const lhr = result?.lhr;
    if (!lhr) throw new Error('Lighthouse nuk ktheu rezultat');
    if (lhr.runtimeError) {
      const blockedNote = proxy.blocked.length ? ` (bllokuar nga guard proxy: ${proxy.blocked[0]!.url})` : '';
      throw new Error(`Lighthouse runtimeError ${lhr.runtimeError.code}: ${lhr.runtimeError.message}${blockedNote}`);
    }
    // Kontroll pas navigimit: dokumenti kryesor s'duhet të ketë përfunduar në host të ndaluar.
    for (const u of [lhr.finalDisplayedUrl, lhr.mainDocumentUrl]) {
      if (u) assertUrlAllowed(new URL(u), config.allowedPrivateHosts);
    }
    return {
      lighthouseVersion: lhr.lighthouseVersion,
      requestedUrl: lhr.requestedUrl,
      finalDisplayedUrl: lhr.finalDisplayedUrl,
      mainDocumentUrl: lhr.mainDocumentUrl,
      fetchTime: lhr.fetchTime,
      formFactor: lhr.configSettings.formFactor,
      screenEmulation: lhr.configSettings.screenEmulation,
      throttlingMethod: lhr.configSettings.throttlingMethod,
      hostUserAgent: lhr.environment?.hostUserAgent,
      networkUserAgent: lhr.environment?.networkUserAgent,
      benchmarkIndex: lhr.environment?.benchmarkIndex,
      runWarnings: (lhr.runWarnings ?? []).map(String),
      categories: lhr.categories as unknown as Record<string, LhCategory>,
      audits: lhr.audits as unknown as Record<string, LhAudit>,
      blockedRequests: [...proxy.blocked],
    };
  } finally {
    try {
      await chrome?.kill();
    } catch {
      /* Windows: EPERM gjatë pastrimit të profilit — injorohet */
    }
    await proxy.close();
    await new Promise((r) => setTimeout(r, 500));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* profili i përkohshëm mbetet në %TEMP% nëse Chrome ende e mban të kyçur */
    }
  }
}
