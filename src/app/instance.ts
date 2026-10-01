import http from 'node:http';
import { dashboardInstanceId } from '../dashboard/server.js';

export const DEFAULT_PORT = 4780;
export const PORT_TRIES = 10;

/**
 * A po punon në këtë port një dashboard i SEO Tool me këtë dosje raportesh? Me node:http pa keep-alive (jo
 * fetch): s'mbeten socket-e të hapura, kështu që procesi mund të dalë menjëherë pas kontrollit.
 */
export function instanceOnPort(port: number, outputDir: string, timeoutMs = 1500): Promise<boolean> {
  const id = dashboardInstanceId(outputDir);
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', agent: false, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.headers['x-seo-tool'] === id);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** Porti i dashboard-it që po punon me këtë dosje raportesh, ose undefined. */
export async function runningInstance(outputDir: string): Promise<number | undefined> {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_TRIES; port++) if (await instanceOnPort(port, outputDir)) return port;
  return undefined;
}
