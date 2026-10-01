#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { findBrowser, noBrowserReason } from './core/browser.js';
import { isAborting, registerCleanup, runCleanups, sweepOrphanShots, sweepStaleTemp } from './core/cleanup.js';
import { loadConfig, MAX_PAGES_HARD_LIMIT } from './core/config.js';
import { RobotsBlockedError } from './core/context.js';
import { executeAudit, type RunStatus } from './core/run.js';
import { runLighthouse } from './lighthouse/run-lighthouse.js';
import { BlockedUrlError } from './net/url-guard.js';
import { buildReport, writeReport } from './report/json.js';
import { renderTerminal } from './report/terminal.js';
import { RepoError } from './source/repo.js';
import { buildSourceReport, renderSourceTerminal, writeSourceReport } from './source/report.js';
import { executeSourceAudit } from './source/run.js';
import { captureVisual } from './visual/capture.js';
import { removeSync } from './core/fsutil.js';

const HELP = `Përdorimi: website-audit <url> [opsione]
          website-audit --folder <dosje> [--out <dir>] [--json]
          website-audit --repo <https://…/repo.git> [--out <dir>] [--json]

Faqja hyrëse (MVP-1): availability, SEO teknik, security headers/HTTPS/TLS, Lighthouse mobile.
Site (MVP-2): crawl i kufizuar (robots.txt, pa login/cart/checkout), linke të prishura, sitemap,
dyfishime/canonical, SEO on-page, compression, i18n.
Biznes (MVP-3): CTA, kontakt, formularë (SAFE: pa submit), sinjale privatësie (jo verdikt ligjor),
lloji i sitit/faqeve dhe CMS-i me confidence. Raporti JSON ruhet lokalisht.

Opsione:
  --out <dir>             Dosja e raporteve (parazgjedhje: output/)
  --config <file>         Config JSON (parazgjedhje: ./config.json nëse ekziston)
  --no-lighthouse         Mos ekzekuto Lighthouse (performance/accessibility → skipped)
  --no-crawl              Vetëm faqja hyrëse (MVP-1), pa crawl/sitemap
  --no-business           Pa modulet e MVP-3 (conversion, privacy, detektim)
  --no-quality            Pa cilësinë e përmbajtjes dhe identitetin vizual
  --no-visual             Pa renderimin në browser (vetëm analiza e tekstit)
  --max-pages <n>         Faqe maksimale për crawl (parazgjedhje 25, maks. 100)
  --max-depth <n>         Thellësia maksimale e linkeve (parazgjedhje 3)
  --chrome-path <path>    Rruga e Chrome/Chromium për Lighthouse
  --save-lhr              Ruaj edhe LHR-në e plotë të Lighthouse në dosjen e raporteve
                          ({raporti}.lhr.json). Mund të përmbajë URL/të dhëna të faqes.
  --ignore-robots         Anashkalo robots.txt për tool-in (vetëm për site që i kontrollon vetë)
  --allow-local <hosts>   VETËM për fixtures/teste: lejo hoste lokale, p.sh. 127.0.0.1:4321
  --folder <dosje>        Audit i skedarëve të një dosjeje lokale (HTML/CSS/JS statik; pa ekzekutim)
  --repo <url>            Audit i një repo publike Git (https): klon i cekët i përkohshëm, pa
                          npm install/build/skripte; repo private s'mbështeten
  --json                  Shtyp raportin JSON në stdout në vend të përmbledhjes
  --progress-json         Progresi si rreshta JSON në stderr (për dashboard-in), pa output në stdout
  --exit-with-stdin       Ndalo dhe pastro kur mbyllet stdin (përdoret nga dashboard-i për anulim/mbyllje)
  -h, --help              Ndihmë

Kodet e daljes: 0 ok (edhe partial), 1 gabim i brendshëm, 2 URL/dosje e pavlefshme ose e bllokuar,
3 bllokuar nga robots.txt, 4 repo e paarritshme (private/s'ekziston), e paplotë ose tepër e madhe,
130 i ndërprerë (Ctrl+C ose anulim): pa raport; Chrome, profilet e përkohshme, kloni dhe
screenshot-et e pjesshme lirohen/fshihen para daljes`;

/**
 * Dalja e progresit. Me --progress-json, çdo ngjarje që motori raporton (status, hap, faqe e crawl-it,
 * raporti i shkruar, gabimi) del si një rresht JSON në stderr: dashboard-i e lexon pa e hamendësuar.
 */
interface Progress {
  log(msg: string): void;
  status(s: RunStatus, text?: string): void;
  step(step: string): void;
  report(file: string, status: string): void;
  error(exitCode: number, message: string): number;
  aborted(reason: string): void;
}

let stderrClosed = false;

function progress(json: boolean): Progress {
  // Kur lexuesi (dashboard-i) s'ekziston më, shkrimi hedh EPIPE: progresi heshtet që pastrimi të mbarojë.
  const err = (line: string) => {
    if (stderrClosed) return;
    try {
      process.stderr.write(`${line}\n`);
    } catch {
      stderrClosed = true;
    }
  };
  const emit = (e: Record<string, unknown>) => err(JSON.stringify(e));
  if (!json) {
    return {
      log: err,
      status: (_s, text) => text && err(`• ${text}`),
      step: (s) => err(`  – ${s}`),
      report: () => {},
      error: (code, message) => (err(message), code),
      aborted: (reason) => err(`• Auditi u ndërpre (${reason}): pa raport; burimet e përkohshme u liruan.`),
    };
  }
  return {
    log: (text) => emit({ event: 'log', text }),
    status: (status) => emit({ event: 'status', status }),
    step: (s) => {
      // Crawler-i raporton "12/25 https://…": faqja e 12-të nga kufiri 25 (jo nga totali i sitit).
      const m = s.match(/^\s*(\d+)\/(\d+) (\S+)\s*$/);
      emit(m ? { event: 'crawl', done: Number(m[1]), max: Number(m[2]), url: m[3] } : { event: 'step', text: s.trim() });
    },
    report: (file, status) => emit({ event: 'report', file: path.basename(file), status }),
    error: (exitCode, message) => (emit({ event: 'error', exitCode, message }), exitCode),
    aborted: (reason) => emit({ event: 'aborted', reason }),
  };
}

export const ABORT_EXIT_CODE = 130;

/**
 * Pas ndërprerjes, auditi mund të vazhdojë edhe pak (p.sh. renderimi mbaron "normalisht" kur Chrome mbyllet),
 * por s'duhet të shkruajë raport: pret këtu derisa pastrimi të nxjerrë procesin me kodin 130.
 */
async function stopIfAborting(): Promise<void> {
  if (isAborting()) await new Promise<never>(() => {});
}

/**
 * Ndërprerja: Ctrl+C, mbyllja e dritares/terminalit, SIGTERM, ose (me --exit-with-stdin) mbyllja e stdin-it
 * nga dashboard-i — kur anulon punën ose kur vetë dashboard-i mbyllet/vritet. Rregulli: një audit i ndërprerë
 * s'shkruan raport; Chrome ndalet, profilet e përkohshme dhe kloni i repo-s fshihen, screenshot-et e pjesshme
 * të këtij ekzekutimi fshihen. Pastaj procesi del me kodin 130.
 */
function installAbort(p: Progress, watchStdin: boolean): void {
  let started = false;
  const abort = (reason: string) => {
    if (started) return;
    started = true;
    try {
      p.aborted(reason);
    } catch {
      /* stderr mund të jetë mbyllur (dashboard-i u vra) */
    }
    void runCleanups().finally(() => process.exit(ABORT_EXIT_CODE));
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => abort(sig));
  // Dashboard-i u mbyll/vra: shkrimi në stderr dështon (EPIPE) — s'ka më kujt t'i raportohet.
  process.stderr.on('error', () => {
    stderrClosed = true;
    abort('stderr u mbyll');
  });
  // Një EPIPE i pakapur (p.sh. nga një shkrim tjetër në stderr) ose çdo gabim gjatë pastrimit s'duhet ta
  // ndërpresë pastrimin; gabimet e tjera sillen si zakonisht (dalje me kod 1).
  process.on('uncaughtException', (e: NodeJS.ErrnoException) => {
    if (started || e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'EOF') {
      stderrClosed = true;
      return abort('stderr u mbyll');
    }
    try {
      process.stderr.write(`${e.stack ?? e}\n`);
    } catch {
      /* injoro */
    }
    process.exit(1);
  });
  if (watchStdin) {
    process.stdin.on('data', () => {});
    process.stdin.on('end', () => abort('stdin u mbyll'));
    process.stdin.on('error', () => abort('stdin u mbyll'));
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      config: { type: 'string' },
      'no-lighthouse': { type: 'boolean', default: false },
      'chrome-path': { type: 'string' },
      'ignore-robots': { type: 'boolean', default: false },
      'save-lhr': { type: 'boolean', default: false },
      'no-crawl': { type: 'boolean', default: false },
      'no-business': { type: 'boolean', default: false },
      'no-quality': { type: 'boolean', default: false },
      'no-visual': { type: 'boolean', default: false },
      'max-pages': { type: 'string' },
      'max-depth': { type: 'string' },
      'allow-local': { type: 'string' },
      json: { type: 'boolean', default: false },
      'progress-json': { type: 'boolean', default: false },
      'exit-with-stdin': { type: 'boolean', default: false },
      folder: { type: 'string' },
      repo: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const p = progress(values['progress-json'] ?? false);
  installAbort(p, values['exit-with-stdin'] ?? false);
  // Mbetje nga ndalime të detyruara (procesi u vra pa mundur të pastrojë): fshihen pas 24 orësh.
  sweepStaleTemp();

  const sourceMode = values.folder !== undefined || values.repo !== undefined;
  if (values.help || (sourceMode ? positionals.length !== 0 || (values.folder !== undefined && values.repo !== undefined) : positionals.length !== 1)) {
    if (values['progress-json'] && !values.help) return p.error(2, 'Argumente të pavlefshme');
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  if (sourceMode) return runSource(values.folder, values.repo, values.out, values.config, values.json ?? false, p, values['progress-json'] ?? false);

  const base = loadConfig(values.config);
  const intArg = (name: string, v: string | undefined, min: number, max: number): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new RangeError(`--${name} duhet të jetë numër i plotë ${min}–${max}`);
    return n;
  };
  let maxPages: number | undefined;
  let maxDepth: number | undefined;
  try {
    maxPages = intArg('max-pages', values['max-pages'], 1, MAX_PAGES_HARD_LIMIT);
    maxDepth = intArg('max-depth', values['max-depth'], 0, 10);
  } catch (err) {
    return p.error(2, (err as Error).message);
  }
  const config = {
    ...base,
    outputDir: values.out ?? base.outputDir,
    respectRobots: values['ignore-robots'] ? false : base.respectRobots,
    allowedPrivateHosts: values['allow-local']
      ? values['allow-local'].split(',').map((s) => s.trim()).filter(Boolean)
      : base.allowedPrivateHosts,
    crawl: {
      ...base.crawl,
      enabled: values['no-crawl'] ? false : base.crawl.enabled,
      maxPages: Math.min(maxPages ?? base.crawl.maxPages, MAX_PAGES_HARD_LIMIT),
      maxDepth: maxDepth ?? base.crawl.maxDepth,
    },
    business: { ...base.business, enabled: values['no-business'] ? false : base.business.enabled },
    quality: { ...base.quality, enabled: values['no-quality'] ? false : base.quality.enabled, visual: values['no-visual'] || values['no-lighthouse'] ? false : base.quality.visual },
    lighthouse: {
      ...base.lighthouse,
      enabled: values['no-lighthouse'] ? false : base.lighthouse.enabled,
      chromePath: values['chrome-path'] ?? base.lighthouse.chromePath,
      saveLhr: values['save-lhr'] || base.lighthouse.saveLhr,
    },
  };

  // Screenshot-e pa raport (nga një ndalim i detyruar) më të vjetra se 24 orë.
  sweepOrphanShots(path.resolve(config.outputDir));

  // Shfletuesi për Lighthouse/renderimin: Chrome i instaluar ose Edge; pa to, vazhdojnë kontrollet e tjera.
  if (config.lighthouse.enabled || config.quality.visual) {
    const found = findBrowser(config.lighthouse.chromePath);
    if (found.browser) {
      config.lighthouse.chromePath = found.browser.path;
      p.log(`• Shfletuesi: ${found.browser.name} (${found.browser.path})`);
    } else {
      config.lighthouse.unavailableReason = noBrowserReason(found);
      p.log(`• ${config.lighthouse.unavailableReason}`);
    }
  }

  const statusText: Partial<Record<RunStatus, string>> = {
    crawling: 'mbledhje të dhënash (faqja hyrëse, pastaj crawl i kufizuar)…',
    auditing: 'auditim…',
    scoring: 'pikëzim…',
  };

  // Screenshot-et i përkasin raportit: nëse raporti s'shkruhet (gabim ose ndërprerje), dosja e tyre fshihet.
  let shots: { unregister: () => void; remove: () => void } | undefined;
  try {
    const run = await executeAudit(positionals[0]!, config, {
      onStatus: (s) => p.status(s, statusText[s]),
      onStep: (step) => p.step(step),
      runLighthouse,
      captureVisual: (targets, cfg) => {
        const host = new URL(targets[0]?.url ?? positionals[0]!).hostname.replace(/[^a-z0-9.-]/gi, '_');
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
        const label = `${host}-${stamp}`;
        const dir = path.join(path.resolve(cfg.outputDir), 'visual', label);
        const remove = () => removeSync(dir, { retries: 3, retryDelayMs: 200 });
        shots = { unregister: registerCleanup(remove), remove };
        return captureVisual(targets, cfg, path.resolve(cfg.outputDir), label);
      },
    });
    const report = buildReport(run);
    const lh = run.context?.lighthouse;
    const rawLhr = config.lighthouse.saveLhr && lh?.status === 'ok' ? lh.value.rawLhr : undefined;
    if (config.lighthouse.saveLhr && !rawLhr) {
      p.log(`• --save-lhr: LHR s'u ruajt — Lighthouse s'dha rezultat (${lh?.status === 'error' ? lh.error : lh?.status === 'skipped' ? lh.reason : 'pa rezultat'})`);
    }
    await stopIfAborting();
    const { reportPath: file, lhrPath, report: written } = writeReport(report, path.resolve(config.outputDir), rawLhr);
    shots?.unregister();
    if (lhrPath) p.log(`• LHR i plotë (lokal, mos e shpërndaj pa e kontrolluar): ${lhrPath}`);
    p.report(file, written.status);
    if (values['progress-json']) return 0;
    if (values.json) console.log(JSON.stringify(written, null, 2));
    else console.log(renderTerminal(written, file));
    return 0;
  } catch (err) {
    try {
      shots?.unregister();
      shots?.remove();
    } catch {
      /* injoro */
    }
    if (err instanceof BlockedUrlError) return p.error(2, `URL e refuzuar: ${err.message}`);
    if (err instanceof RobotsBlockedError) return p.error(3, `Auditi u ndal: ${err.message}\nNëse siti është yti, përsërite me --ignore-robots.`);
    return p.error(1, `Gabim: ${(err as Error).stack ?? err}`);
  }
}

/** Auditi i skedarëve: rrjedhë e veçantë nga auditi i URL-së (pa Health Score, pa Lighthouse). */
async function runSource(folder: string | undefined, repo: string | undefined, out: string | undefined, configPath: string | undefined, json: boolean, p: Progress, progressJson: boolean): Promise<number> {
  const config = loadConfig(configPath);
  const s = config.source;
  try {
    const result = await executeSourceAudit(folder !== undefined ? { kind: 'folder', target: folder } : { kind: 'repo', target: repo! }, {
      limits: { maxFiles: s.maxFiles, maxFileBytes: s.maxFileBytes, maxTotalBytes: s.maxTotalBytes, maxDepth: s.maxDepth },
      repoLimits: { maxBytes: s.repoMaxBytes, timeoutMs: s.repoTimeoutMs },
      onStep: (step) => p.step(step),
    });
    const report = buildSourceReport(result);
    await stopIfAborting();
    const file = writeSourceReport(report, path.resolve(out ?? config.outputDir));
    p.report(file, report.status);
    if (progressJson) return 0;
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderSourceTerminal(report, file));
    return 0;
  } catch (err) {
    if (err instanceof RepoError) return p.error(err.code === 'REPO_URL_INVALID' ? 2 : 4, `Repo: ${err.message}`);
    if (err instanceof BlockedUrlError) return p.error(2, `URL e refuzuar: ${err.message}`);
    if (/^Dosja s'u gjet/.test((err as Error).message)) return p.error(2, (err as Error).message);
    return p.error(1, `Gabim: ${(err as Error).stack ?? err}`);
  }
}

main().then((code) => {
  process.exitCode = code;
  // Auditi mbaroi vetë: stdin-i i vëzhguar s'duhet ta mbajë procesin gjallë.
  if (process.stdin.listenerCount('end')) process.stdin.destroy();
});
