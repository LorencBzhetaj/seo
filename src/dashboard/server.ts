import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareReports } from './compare.js';
import { STYLE } from './style.js';
import { kindOf, listReports, lhrPath, readReport, screenshotPath } from './store.js';
import { comparePickerView, compareView, errorView, listView, sourceReportView, urlReportView, type Files, type Query } from './views.js';

/**
 * Serveri lokal i dashboard-it. Vetëm lexim nga dosja e raporteve; asnjë veprim që ndryshon gjendje.
 * - dëgjon vetëm në 127.0.0.1 (s'ka opsion për adresë tjetër);
 * - pranon vetëm Host 127.0.0.1/localhost me portin e vet (mbrojtje nga DNS rebinding);
 * - vetëm GET/HEAD; faqet s'kanë JavaScript (CSP script-src 'none');
 * - skedarët (screenshot, LHR) shërbehen vetëm brenda dosjes së raporteve, me emra të validuar.
 */

export const LOOPBACK = '127.0.0.1';

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export interface DashboardOptions {
  outputDir: string;
}

export function createDashboardServer(opts: DashboardOptions): http.Server {
  const server = http.createServer((req, res) => {
    const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const page = (status: number, body: string) => send(status, 'text/html; charset=utf-8', body);
    try {
      const port = (server.address() as AddressInfo | null)?.port;
      const host = (req.headers.host ?? '').toLowerCase();
      if (!port || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return send(421, 'text/plain; charset=utf-8', 'Host i palejuar');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Vetëm lexim (GET)', { Allow: 'GET, HEAD' });

      const url = new URL(req.url ?? '/', `http://${host}`);
      const q: Query = Object.fromEntries(url.searchParams);
      const files: Files = {
        shotExists: (rel) => !!screenshotPath(opts.outputDir, rel),
        lhrExists: (name) => !!lhrPath(opts.outputDir, name),
      };
      const p = url.pathname;

      if (p === '/') return page(200, listView(listReports(opts.outputDir)));
      if (p === '/style.css') return send(200, 'text/css; charset=utf-8', STYLE);
      if (p.startsWith('/report/')) {
        const name = decodeURIComponent(p.slice('/report/'.length));
        const r = readReport(opts.outputDir, name);
        if (!r.ok) return page(404, errorView('Raporti s\'u hap', r.reason));
        return page(200, kindOf(r.report) === 'url' ? urlReportView(name, r.report, q, files) : sourceReportView(name, r.report, q));
      }
      if (p === '/compare') {
        const list = listReports(opts.outputDir);
        if (!q.a || !q.b) return page(200, comparePickerView(list, { a: list.reports[1]?.file, b: list.reports[0]?.file }));
        const a = readReport(opts.outputDir, q.a);
        const b = readReport(opts.outputDir, q.b);
        if (!a.ok || !b.ok) return page(404, comparePickerView(list, q, `S'u hap: ${!a.ok ? a.reason : ''} ${!b.ok ? b.reason : ''}`));
        if (q.a === q.b) return page(400, comparePickerView(list, q, 'Zgjidh dy raporte të ndryshme.'));
        return page(200, compareView(compareReports(q.a, a.report, q.b, b.report)));
      }
      if (p.startsWith('/shot/')) {
        const rel = p.slice('/shot/'.length).split('/').map(decodeURIComponent).join('/');
        const file = screenshotPath(opts.outputDir, `visual/${rel.replace(/^visual\//, '')}`);
        if (!file) return send(404, 'text/plain; charset=utf-8', 'Screenshot-i s\'u gjet');
        return send(200, /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', fs.readFileSync(file));
      }
      if (p.startsWith('/lhr/')) {
        const name = decodeURIComponent(p.slice('/lhr/'.length));
        const file = lhrPath(opts.outputDir, name);
        if (!file) return send(404, 'text/plain; charset=utf-8', 'LHR s\'u gjet');
        // Shkarkim, jo shfaqje: LHR-ja përmban HTML/tekst nga faqja e audituar.
        return send(200, 'application/json; charset=utf-8', fs.readFileSync(file), { 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"` });
      }
      return page(404, errorView('S\'u gjet', 'Kjo faqe s\'ekziston.'));
    } catch (e) {
      return page(500, errorView('Gabim', `Gabim i brendshëm: ${(e as Error).message}`));
    }
  });
  return server;
}

/** Nis serverin vetëm në 127.0.0.1. Porti 0 = i lirë, i zgjedhur nga sistemi. */
export function startDashboard(opts: DashboardOptions & { port: number }): Promise<{ server: http.Server; url: string }> {
  const server = createDashboardServer(opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, LOOPBACK, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://${LOOPBACK}:${port}/` });
    });
  });
}
