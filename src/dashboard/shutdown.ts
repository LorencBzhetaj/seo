import type http from 'node:http';
import { CANCEL_GRACE_MS, type JobManager } from './jobs.js';

/**
 * Ctrl+C / mbyllja e dritares: anulo auditet në punë dhe prit që motori të lirojë Chrome-in dhe skedarët e
 * përkohshëm, pastaj dil. Edhe nëse dashboard-i vritet pa arritur këtu, stdin-i i çdo auditi mbyllet dhe
 * motori pastron vetë.
 */
export function installShutdown(server: http.Server, jobs: JobManager): void {
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
}
