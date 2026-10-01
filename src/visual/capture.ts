import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAborting, once, registerCleanup } from '../core/cleanup.js';
import type { AuditConfig } from '../core/config.js';
import { startGuardProxy } from '../net/guard-proxy.js';
import { assertUrlAllowed } from '../net/url-guard.js';
import { PROBE_SCRIPT, type ProbeResult } from './probe.js';

export type Viewport = 'desktop' | 'mobile';

export const VIEWPORTS: Record<Viewport, { width: number; height: number; isMobile: boolean; hasTouch: boolean; deviceScaleFactor: number; userAgent?: string }> = {
  desktop: { width: 1366, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: {
    width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
};

export interface VisualTarget {
  url: string;
  pageType?: string;
}

export interface VisualCapture {
  url: string;
  pageType?: string;
  viewport: Viewport;
  status: 'ok' | 'skipped';
  reason?: string;
  finalUrl?: string;
  /** Path relativ ndaj dosjes së raporteve (p.sh. visual/gjecaj.al-…/1-home-desktop.jpg). */
  screenshot?: string;
  probe?: ProbeResult;
}

export interface VisualData {
  captures: VisualCapture[];
  /** Dosja e screenshot-eve, relative ndaj dosjes së raporteve. */
  screenshotsDir: string;
  limits: { maxPages: number; navigationTimeoutMs: number; delayMs: number; maxScreenshotHeight: number };
  blockedRequests: { url: string; reason: string }[];
}

const NAV_TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_HEIGHT = 3000;
const SCROLL_LIMIT_PX = 3000;

const slug = (u: string) => {
  try {
    const p = new URL(u).pathname.replace(/^\/|\/$/g, '') || 'home';
    return p.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 50) || 'faqe';
  } catch {
    return 'faqe';
  }
};

/**
 * Renderon një numër të kufizuar faqesh (desktop + mobile) në Chrome headless përmes guard proxy-t
 * (i njëjti SSRF guard si Lighthouse), me vonesë mes navigimeve. Mat modelet vizuale me PROBE_SCRIPT
 * dhe ruan screenshot-e lokalisht (output/ është jashtë Git). Një faqe që s'renderohet → skipped me arsye.
 */
export async function captureVisual(targets: VisualTarget[], config: AuditConfig, outputDir: string, runLabel: string): Promise<VisualData> {
  const [{ default: puppeteer }, chromeLauncher] = await Promise.all([import('puppeteer-core'), import('chrome-launcher')]);
  const maxPages = Math.min(config.quality.maxVisualPages, 8);
  const list = targets.slice(0, maxPages);
  const relDir = path.posix.join('visual', runLabel);
  const absDir = path.join(outputDir, 'visual', runLabel);
  fs.mkdirSync(absDir, { recursive: true });
  const delayMs = Math.max(config.requestDelay, 500);
  const data: VisualData = { captures: [], screenshotsDir: relDir, limits: { maxPages, navigationTimeoutMs: NAV_TIMEOUT_MS, delayMs, maxScreenshotHeight: MAX_SCREENSHOT_HEIGHT }, blockedRequests: [] };

  const proxy = await startGuardProxy(config.allowedPrivateHosts);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'website-auditor-visual-'));
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | undefined;
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  // Liron Chrome-in, proxy-n dhe profilin e përkohshëm: në fund normalisht, ose menjëherë nëse auditi ndërpritet.
  const release = once(async () => {
    try {
      await browser?.disconnect();
    } catch {
      /* injoro */
    }
    try {
      await chrome?.kill();
    } catch {
      /* Windows: EPERM gjatë pastrimit */
    }
    await proxy.close();
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* profili mbetet në %TEMP%; e fshin auditi i radhës pas 24 orësh */
    }
  });
  const unregister = registerCleanup(release);
  try {
    chrome = await chromeLauncher.launch({
      chromePath: config.lighthouse.chromePath,
      userDataDir,
      // Ctrl+C e trajton motori (runCleanups): liron Chrome-in dhe fshin profilin para daljes.
      handleSIGINT: false,
      chromeFlags: ['--headless=new', '--no-first-run', '--disable-extensions', `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--hide-scrollbars', '--mute-audio'],
    });
    if (isAborting()) {
      await release();
      throw new Error('Auditi u ndërpre');
    }
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
    const page = await browser.newPage();
    let lastNav = 0;
    for (const [i, t] of list.entries()) {
      for (const vp of ['desktop', 'mobile'] as Viewport[]) {
        const base: VisualCapture = { url: t.url, pageType: t.pageType, viewport: vp, status: 'skipped' };
        try {
          assertUrlAllowed(new URL(t.url), config.allowedPrivateHosts);
          const v = VIEWPORTS[vp];
          await page.setViewport({ width: v.width, height: v.height, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
          await page.setUserAgent(v.userAgent ?? (await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
          const wait = lastNav + delayMs - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          lastNav = Date.now();
          const res = await page.goto(t.url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
          await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => undefined);
          const finalUrl = page.url();
          assertUrlAllowed(new URL(finalUrl), config.allowedPrivateHosts);
          if (new URL(finalUrl).hostname.replace(/^www\./, '') !== new URL(t.url).hostname.replace(/^www\./, '')) {
            data.captures.push({ ...base, reason: `Ridrejtoi te një host tjetër (${finalUrl}) — s'u analizua` });
            continue;
          }
          const status = res?.status() ?? 0;
          if (status >= 400) {
            data.captures.push({ ...base, finalUrl, reason: `HTTP ${status} në browser — pamja s'u analizua` });
            continue;
          }
          // Lëvizje graduale deri në 3000 px për imazhet "lazy", pastaj kthim lart
          await page.evaluate(`(async () => { const step = Math.round(innerHeight * 0.8); for (let y = 0; y < Math.min(document.body.scrollHeight, ${SCROLL_LIMIT_PX}); y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); })()`);
          await page.waitForNetworkIdle({ idleTime: 300, timeout: 2000 }).catch(() => undefined);
          const probe = (await page.evaluate(PROBE_SCRIPT)) as ProbeResult;
          const file = `${i + 1}-${slug(t.url)}-${vp}.jpg`;
          const height = Math.min(probe.documentHeight, MAX_SCREENSHOT_HEIGHT);
          await page.screenshot({ path: path.join(absDir, file) as `${string}.jpeg`, type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: VIEWPORTS[vp].width, height }, captureBeyondViewport: true });
          data.captures.push({ ...base, status: 'ok', finalUrl, screenshot: path.posix.join(relDir, file), probe });
        } catch (err) {
          data.captures.push({ ...base, reason: `S'u renderua: ${(err as Error).message.split('\n')[0]!.slice(0, 160)}` });
        }
      }
    }
    data.blockedRequests = [...proxy.blocked];
    return data;
  } finally {
    unregister();
    await release();
  }
}
