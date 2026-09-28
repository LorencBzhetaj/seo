#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './core/config.js';
import { RobotsBlockedError } from './core/context.js';
import { executeAudit, type RunStatus } from './core/run.js';
import { runLighthouse } from './lighthouse/run-lighthouse.js';
import { BlockedUrlError } from './net/url-guard.js';
import { buildReport, writeReport } from './report/json.js';
import { renderTerminal } from './report/terminal.js';

const HELP = `Përdorimi: website-audit <url> [opsione]

Audit MVP-1 i faqes hyrëse: availability, SEO teknik, security headers/HTTPS/TLS,
Lighthouse mobile (performance, accessibility, best practices). Raporti JSON ruhet lokalisht.

Opsione:
  --out <dir>             Dosja e raporteve (parazgjedhje: output/)
  --config <file>         Config JSON (parazgjedhje: ./config.json nëse ekziston)
  --no-lighthouse         Mos ekzekuto Lighthouse (performance/accessibility → skipped)
  --chrome-path <path>    Rruga e Chrome/Chromium për Lighthouse
  --save-lhr              Ruaj edhe LHR-në e plotë të Lighthouse në dosjen e raporteve
                          ({raporti}.lhr.json). Mund të përmbajë URL/të dhëna të faqes.
  --ignore-robots         Anashkalo robots.txt për tool-in (vetëm për site që i kontrollon vetë)
  --allow-local <hosts>   VETËM për fixtures/teste: lejo hoste lokale, p.sh. 127.0.0.1:4321
  --json                  Shtyp raportin JSON në stdout në vend të përmbledhjes
  -h, --help              Ndihmë

Kodet e daljes: 0 ok (edhe partial), 1 gabim i brendshëm, 2 URL e pavlefshme/e bllokuar, 3 bllokuar nga robots.txt`;

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
      'allow-local': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length !== 1) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }

  const base = loadConfig(values.config);
  const config = {
    ...base,
    outputDir: values.out ?? base.outputDir,
    respectRobots: values['ignore-robots'] ? false : base.respectRobots,
    allowedPrivateHosts: values['allow-local']
      ? values['allow-local'].split(',').map((s) => s.trim()).filter(Boolean)
      : base.allowedPrivateHosts,
    lighthouse: {
      ...base.lighthouse,
      enabled: values['no-lighthouse'] ? false : base.lighthouse.enabled,
      chromePath: values['chrome-path'] ?? base.lighthouse.chromePath,
      saveLhr: values['save-lhr'] || base.lighthouse.saveLhr,
    },
  };

  const log = (msg: string) => process.stderr.write(`${msg}\n`);
  const statusText: Partial<Record<RunStatus, string>> = {
    crawling: 'mbledhje të dhënash (vetëm faqja hyrëse, pa crawl)…',
    auditing: 'auditim…',
    scoring: 'pikëzim…',
  };

  try {
    const run = await executeAudit(positionals[0]!, config, {
      onStatus: (s) => statusText[s] && log(`• ${statusText[s]}`),
      onStep: (step) => log(`  – ${step}`),
      runLighthouse,
    });
    const report = buildReport(run);
    const lh = run.context?.lighthouse;
    const rawLhr = config.lighthouse.saveLhr && lh?.status === 'ok' ? lh.value.rawLhr : undefined;
    if (config.lighthouse.saveLhr && !rawLhr) {
      log(`• --save-lhr: LHR s'u ruajt — Lighthouse s'dha rezultat (${lh?.status === 'error' ? lh.error : lh?.status === 'skipped' ? lh.reason : 'pa rezultat'})`);
    }
    const { reportPath: file, lhrPath, report: written } = writeReport(report, path.resolve(config.outputDir), rawLhr);
    if (lhrPath) log(`• LHR i plotë (lokal, mos e shpërndaj pa e kontrolluar): ${lhrPath}`);
    if (values.json) console.log(JSON.stringify(written, null, 2));
    else console.log(renderTerminal(written, file));
    return 0;
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      log(`URL e refuzuar: ${err.message}`);
      return 2;
    }
    if (err instanceof RobotsBlockedError) {
      log(`Auditi u ndal: ${err.message}\nNëse siti është yti, përsërite me --ignore-robots.`);
      return 3;
    }
    log(`Gabim: ${(err as Error).stack ?? err}`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
