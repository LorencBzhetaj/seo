#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDashboard } from '../dashboard/server.js';
import { clearOwnTemp } from '../core/cleanup.js';
import { installShutdown } from '../dashboard/shutdown.js';
import { DEFAULT_PORT, instanceOnPort, PORT_TRIES } from './instance.js';

/**
 * Nisësi i programit të instaluar (shkurtorja në Start Menu): përdor Node-in e paketuar, mban të dhënat e
 * përdoruesit jashtë dosjes së instalimit dhe hap dashboard-in në browser. Dritarja e konsolës është
 * "programi": mbyllja e saj anulon auditet në punë (ato pastrojnë vetë) dhe ndal dashboard-in.
 *
 * Dosja e të dhënave (e shkrueshme nga përdoruesi): %LOCALAPPDATA%\SEO Tool (ose SEO_TOOL_DATA):
 *   output\   raportet, LHR dhe screenshot-et
 *   tmp\      skedarët e përkohshëm të auditeve (profilet e Chrome, klonet e repo-ve)
 *   config.json (opsional)
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SEO_TOOL_DATA) return path.resolve(env.SEO_TOOL_DATA);
  return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SEO Tool');
}

function openBrowser(url: string): void {
  if (process.env.SEO_TOOL_NO_OPEN) return;
  // explorer.exe e hap URL-në me shfletuesin e parazgjedhur (pa PowerShell dhe pa shell).
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

async function main(): Promise<void> {
  process.title = 'SEO Tool';
  const data = dataDir();
  const outputDir = path.join(data, 'output');
  const tmp = path.join(data, 'tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  // Auditet (procese bij) trashëgojnë këtë: profilet e Chrome dhe klonet shkojnë te tmp\ i përdoruesit.
  process.env.TEMP = tmp;
  process.env.TMP = tmp;
  // config.json lexohet nga dosja e të dhënave, jo nga dosja e instalimit.
  process.chdir(data);

  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_TRIES; port++) {
    if (await instanceOnPort(port, outputDir)) {
      const url = `http://127.0.0.1:${port}/`;
      console.log(`SEO Tool është tashmë i hapur: ${url}`);
      openBrowser(url);
      setTimeout(() => process.exit(0), 3000);
      return;
    }
    try {
      const { url, server, jobs } = await startDashboard({ outputDir, port });
      installShutdown(server, jobs);
      // S'ka instancë tjetër me këtë dosje: çdo gjë te tmp është mbetje e një ndalimi të detyruar.
      const leftovers = clearOwnTemp(tmp);
      console.log('SEO Tool');
      console.log(`Dashboard-i: ${url}  (vetëm në këtë kompjuter)`);
      console.log(`Raportet: ${outputDir}`);
      console.log(`Konfigurimi (opsional): ${path.join(data, 'config.json')}`);
      console.log('Mbyll këtë dritare për ta ndalur programin; auditet në punë anulohen.');
      if (leftovers.length) console.log(`U pastruan ${leftovers.length} skedarë të përkohshëm nga një ndalim i mëparshëm.`);
      openBrowser(url);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error(`Portet ${DEFAULT_PORT}–${DEFAULT_PORT + PORT_TRIES - 1} janë të zëna.`);
}

main().catch((e: Error) => {
  console.error(`SEO Tool s'u nis: ${e.message}`);
  // Dritarja mbetet e hapur pak, që mesazhi të lexohet.
  setTimeout(() => process.exit(1), 15_000);
});
