import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAborting, once, registerCleanup } from '../core/cleanup.js';
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
  /** LHR i plotë, vetëm kur lighthouse.saveLhr është aktiv. S'futet në raportin JSON. */
  rawLhr?: unknown;
  /**
   * Klasifikimi i palëve të treta nga Lighthouse (third-party-web): emri, kategoria (analytics, ad,
   * tag-manager, cdn…) dhe origin-et. Përdoret nga moduli privacy (MVP-3). Mund të mungojë në LHR të vjetra.
   */
  entities?: LhEntity[];
  /** Përpjekjet e dështuara para kësaj (bosh kur e para pati sukses) — raportohen, s'fshihen. */
  failedAttempts: LighthouseAttempt[];
}

export interface LhEntity {
  name: string;
  category?: string;
  isFirstParty?: boolean;
  origins: string[];
}

export interface LighthouseAttempt {
  attempt: number;
  code?: string;
  message: string;
}

/**
 * Gabime të regjistrimit të trace-it në Chrome, jo të faqes: p.sh. NO_NAVSTART = trace-i s'ka
 * eventin navigationStart të frame-it kryesor, ndonëse faqja u ngarkua. Lighthouse vetë këshillon
 * "run Lighthouse again". Vetëm këto riprovohen; gabimet e faqes (p.sh. 4xx, NO_FCP) jo.
 */
export const RETRYABLE_LH_ERRORS: ReadonlySet<string> = new Set(['NO_NAVSTART', 'NO_TRACING_STARTED']);
const MAX_ATTEMPTS = 2;

export class LighthouseRunError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly attempts: LighthouseAttempt[]) {
    super(message);
  }
}

/** Ekzekuton `once` dhe e përsërit vetëm për gabime kalimtare të trace-it; çdo dështim regjistrohet. */
export async function runWithRetry<T>(once: (attempt: number) => Promise<T>, maxAttempts = MAX_ATTEMPTS): Promise<{ value: T; failedAttempts: LighthouseAttempt[] }> {
  const failed: LighthouseAttempt[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await once(attempt), failedAttempts: failed };
    } catch (err) {
      const e = err as Error & { code?: string };
      failed.push({ attempt, code: e.code, message: e.message });
      if (!e.code || !RETRYABLE_LH_ERRORS.has(e.code) || attempt >= maxAttempts) {
        const note = failed.length > 1 ? ` (${failed.length} përpjekje, të gjitha dështuan: ${failed.map((f) => f.code ?? 'gabim').join(', ')})` : '';
        throw new LighthouseRunError(`${e.message}${note}`, e.code, failed);
      }
    }
  }
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
  const { value, failedAttempts } = await runWithRetry(() => runLighthouseOnce(url, config));
  return { ...value, failedAttempts };
}

async function runLighthouseOnce(url: string, config: AuditConfig): Promise<Omit<LighthouseData, 'failedAttempts'>> {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([import('lighthouse'), import('chrome-launcher')]);
  const proxy = await startGuardProxy(config.allowedPrivateHosts);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-auditor-chrome-'));
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | undefined;
  // Liron Chrome-in, proxy-n dhe profilin e përkohshëm: në fund normalisht, ose menjëherë nëse auditi ndërpritet.
  const release = once(async () => {
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
      /* profili mbetet në %TEMP% nëse Chrome ende e mban të kyçur; e fshin auditi i radhës pas 24 orësh */
    }
  });
  const unregister = registerCleanup(release);
  try {
    chrome = await chromeLauncher.launch({
      chromePath: config.lighthouse.chromePath,
      userDataDir,
      // Ctrl+C e trajton motori (runCleanups): liron Chrome-in dhe fshin profilin para daljes.
      handleSIGINT: false,
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
    // Ndërprerja erdhi ndërsa Chrome po nisej: lirohet menjëherë, pa nisur Lighthouse.
    if (isAborting()) {
      await release();
      throw new Error('Auditi u ndërpre');
    }
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
      throw Object.assign(new Error(`Lighthouse runtimeError ${lhr.runtimeError.code}: ${lhr.runtimeError.message}${blockedNote}`), { code: lhr.runtimeError.code });
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
      entities: ((lhr as { entities?: LhEntity[] }).entities ?? []).map((e) => ({ name: e.name, category: e.category, isFirstParty: e.isFirstParty, origins: e.origins ?? [] })),
      rawLhr: config.lighthouse.saveLhr ? lhr : undefined,
    };
  } finally {
    unregister();
    await release();
  }
}
