#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CANCEL_GRACE_MS } from './jobs.js';
import { startDashboard } from './server.js';

/**
 * Dashboard-i lokal: raportet e output/ dhe nisja e auditeve (përmes CLI-së së motorit, si procese më vete).
 */
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'output' },
    port: { type: 'string', default: '4780' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Përdorimi: npm run dashboard -- [--out output] [--port 4780]

Hap raportet e output/ dhe nis audite në http://127.0.0.1:<port>/ — vetëm në këtë kompjuter (127.0.0.1),
pa llogari dhe pa cloud. Ndalo me Ctrl+C.`);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Port i pavlefshëm: ${values.port}`);
  process.exit(2);
}

const outputDir = path.resolve(values.out);
startDashboard({ outputDir, port })
  .then(({ url, server, jobs }) => {
    // Ctrl+C / mbyllja e dritares: anulo auditet në punë dhe prit që motori të lirojë Chrome-in dhe skedarët
    // e përkohshëm. Edhe nëse dashboard-i vritet pa arritur këtu, stdin-i i çdo auditi mbyllet dhe motori
    // pastron vetë.
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const n = jobs.running().length;
      if (n) console.log(`Po anulohen ${n} audite në punë…`);
      server.close();
      setTimeout(() => process.exit(0), CANCEL_GRACE_MS + 1000).unref();
      void jobs.cancelAll().finally(() => process.exit(0));
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.once(sig, stop);
    console.log(`Dashboard-i: ${url}`);
    console.log(`Raportet: ${outputDir}`);
    console.log('Vetëm lokal (127.0.0.1). Ndalo me Ctrl+C.');
  })
  .catch((e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Porti ${port} është i zënë; provo --port 0 (i lirë) ose një tjetër.` : `Dashboard-i s'u nis: ${e.message}`);
    process.exit(1);
  });
