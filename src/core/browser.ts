import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Shfletuesi për Lighthouse dhe renderimin. S'paketohet brenda programit: përdoret një Chrome/Chromium i
 * instaluar, ose Microsoft Edge (Chromium, i parainstaluar në Windows 10/11). Radha:
 *   1. `lighthouse.chromePath` në config.json (ose --chrome-path);
 *   2. variabli CHROME_PATH;
 *   3. Chrome/Chromium i gjetur nga chrome-launcher (vendet standarde);
 *   4. Edge (vetëm Windows; vendet standarde).
 */
export interface BrowserInfo {
  path: string;
  /** Nga erdhi: config/env, Chrome i instaluar ose Edge. */
  source: 'config' | 'env' | 'chrome' | 'edge';
  name: string;
}

export interface BrowserLookup {
  browser?: BrowserInfo;
  /** Shtegu i konfiguruar që s'ekziston (për t'ia treguar përdoruesit). */
  invalidConfigured?: string;
  /** SEO_TOOL_BROWSER=none. */
  disabled?: boolean;
}

const exists = (p: string | undefined): p is string => {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const nameOf = (p: string): string => (/msedge/i.test(p) ? 'Microsoft Edge' : /chromium/i.test(p) ? 'Chromium' : 'Google Chrome');

/** Vendet standarde të Edge në Windows. */
export function edgeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const bases = [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter((b): b is string => !!b);
  return bases.map((b) => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
}

function chromeLauncherInstallations(): string[] {
  try {
    const require = createRequire(import.meta.url);
    const finder = require('chrome-launcher/dist/chrome-finder.js') as Record<string, () => string[]>;
    const fn = finder[process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'];
    return fn ? fn() : [];
  } catch {
    return [];
  }
}

export function findBrowser(configured?: string, opts: { env?: NodeJS.ProcessEnv; chromeInstallations?: () => string[] } = {}): BrowserLookup {
  const env = opts.env ?? process.env;
  // SEO_TOOL_BROWSER=none: pa shfletues me qëllim (p.sh. për të provuar sjelljen kur Chrome/Edge mungojnë).
  if (env.SEO_TOOL_BROWSER === 'none') return { disabled: true };
  if (configured) {
    if (exists(configured)) return { browser: { path: configured, source: 'config', name: nameOf(configured) } };
  }
  const invalidConfigured = configured || undefined;
  if (exists(env.CHROME_PATH)) return { browser: { path: env.CHROME_PATH, source: 'env', name: nameOf(env.CHROME_PATH) }, invalidConfigured };
  const chrome = (opts.chromeInstallations ?? chromeLauncherInstallations)().find(exists);
  if (chrome) return { browser: { path: chrome, source: 'chrome', name: nameOf(chrome) }, invalidConfigured };
  if (process.platform === 'win32' || opts.env) {
    const edge = edgeCandidates(env).find(exists);
    if (edge) return { browser: { path: edge, source: 'edge', name: 'Microsoft Edge' }, invalidConfigured };
  }
  return { invalidConfigured };
}

/** Arsyeja (për raportin dhe dashboard-in) kur s'ka shfletues. */
export function noBrowserReason(lookup: BrowserLookup): string {
  if (lookup.disabled) return 'Shfletuesi u çaktivizua (SEO_TOOL_BROWSER=none). Lighthouse dhe pamja vizuale u anashkaluan; kontrollet e tjera vazhduan.';
  return lookup.invalidConfigured
    ? `Shfletuesi i konfiguruar s'u gjet (${lookup.invalidConfigured}); s'u gjet as Chrome as Edge. Lighthouse dhe pamja vizuale u anashkaluan.`
    : "S'u gjet Chrome ose Edge në këtë kompjuter. Lighthouse dhe pamja vizuale u anashkaluan; kontrollet e tjera vazhduan.";
}
