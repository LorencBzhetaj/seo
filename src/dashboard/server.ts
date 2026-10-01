import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { compareReports } from './compare.js';
import { checkFolder, folderRequest, parseRepoForm, parseUrlForm, type AuditRequest } from './forms.js';
import { JobLimitError, JobManager, type JobManagerOptions } from './jobs.js';
import { STYLE } from './style.js';
import { kindOf, listReports, lhrPath, readReport, screenshotPath } from './store.js';
import { auditFormsView, folderConfirmView, jobsListView, jobView, openReportsForm, type AuditEnv, type FormState } from './views-jobs.js';
import { findBrowser, type BrowserLookup } from '../core/browser.js';
import { gitAvailable } from '../core/git.js';
import { loadConfig } from '../core/config.js';
import { comparePickerView, compareView, errorView, listView, sourceReportView, urlReportView, type Files, type Query } from './views.js';

/**
 * Serveri lokal i dashboard-it.
 * - dëgjon vetëm në 127.0.0.1 (s'ka opsion për adresë tjetër) dhe pranon vetëm Host 127.0.0.1/localhost
 *   me portin e vet (mbrojtje nga DNS rebinding);
 * - faqet s'kanë JavaScript (CSP script-src 'none');
 * - veprimet (nisja/anulimi i auditeve) vetëm me POST, dhe vetëm kur kërkesa vjen nga vetë dashboard-i:
 *   Origin (ose Sec-Fetch-Site: same-origin) + token CSRF i rastësishëm për çdo nisje të serverit +
 *   Content-Type i formularit. Një faqe tjetër e hapur në browser s'mund ta lexojë tokenin (pa CORS).
 */

export const LOOPBACK = '127.0.0.1';
const MAX_BODY = 16 * 1024;

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  // same-origin: pa referrer drejt sajteve të tjera, por Chrome dërgon Origin-in real në POST-et e dashboard-it
  // (me no-referrer dërgon "Origin: null"). Linket e jashtme kanë gjithsesi rel=noreferrer.
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export interface DashboardOptions {
  outputDir: string;
  /** Për teste: kërkimi i shfletuesit (parazgjedhje: config.json + Chrome/Edge i instaluar). */
  findBrowser?: () => BrowserLookup;
  /** Për teste: kontrolli i Git-it (parazgjedhje: `git --version`). */
  gitAvailable?: () => boolean;
  /** Për teste: hapja e dosjes së raporteve (parazgjedhje: Explorer). */
  openFolder?: (dir: string) => void;
  /** Opsione të punëve (kufiri, komanda për teste, hoste lokale për fixtures). */
  jobs?: Omit<JobManagerOptions, 'outputDir'>;
}

export interface Dashboard {
  server: http.Server;
  jobs: JobManager;
  /** Tokeni CSRF i kësaj nisjeje (vetëm për teste; faqet e fusin në formularë). */
  csrf: string;
}

/** A vjen kërkesa që ndryshon gjendje nga vetë dashboard-i? Kthen arsyen e refuzimit, ose undefined. */
export function mutationRejection(headers: http.IncomingHttpHeaders, port: number): string | undefined {
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const origin = headers.origin;
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return `Sec-Fetch-Site: ${String(site)}`;
  if (origin !== undefined) {
    // "null" pranohet vetëm kur browser-i vetë konfirmon same-origin (Sec-Fetch-Site s'mund të vendoset nga faqet).
    const nullSameOrigin = origin === 'null' && site === 'same-origin';
    if (!nullSameOrigin && !origins.includes(String(origin).toLowerCase())) return `Origin i huaj: ${String(origin)}`;
  } else if (site === undefined) return 'Mungon Origin/Sec-Fetch-Site';
  if (!String(headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return 'Content-Type i papritur';
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readBody(req: http.IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    // Mbi kufirin: lexohet deri në fund pa u ruajtur, që klienti të marrë përgjigjen 413.
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => resolve(size > MAX_BODY ? undefined : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(undefined));
  });
}

export function createDashboard(opts: DashboardOptions): Dashboard {
  const jobs = new JobManager({ ...opts.jobs, outputDir: opts.outputDir });
  const csrf = crypto.randomBytes(32).toString('base64url');
  const instanceId = dashboardInstanceId(opts.outputDir);
  const configPath = path.resolve('config.json');
  // Kontrollohet në çdo hapje të faqes: nëse përdoruesi instalon Chrome/Edge, mjafton rifreskimi.
  const auditEnv = (): AuditEnv => {
    let configured: string | undefined;
    try {
      configured = loadConfig().lighthouse.chromePath;
    } catch {
      configured = undefined;
    }
    return { browser: opts.findBrowser ? opts.findBrowser() : findBrowser(configured), git: gitCheck(), outputDir: opts.outputDir, configPath };
  };
  // Git kontrollohet më së shumti një herë në 30 s (instalimi i tij kërkon gjithsesi rihapjen e programit).
  let gitCache: { ok: boolean; at: number } | undefined;
  const gitCheck = () => {
    if (opts.gitAvailable) return opts.gitAvailable();
    if (!gitCache || Date.now() - gitCache.at > 30_000) gitCache = { ok: gitAvailable(), at: Date.now() };
    return gitCache.ok;
  };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, { ...SECURITY_HEADERS, 'X-SEO-Tool': instanceId, 'Content-Type': type, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const page = (status: number, body: string) => send(status, 'text/html; charset=utf-8', body);
    const text = (status: number, body: string) => send(status, 'text/plain; charset=utf-8', body);
    const redirect = (to: string) => send(303, 'text/plain; charset=utf-8', '', { Location: to });
    try {
      const port = (server.address() as AddressInfo | null)?.port;
      const host = (req.headers.host ?? '').toLowerCase();
      if (!port || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return text(421, 'Host i palejuar');
      const url = new URL(req.url ?? '/', `http://${host}`);
      const p = url.pathname;

      if (req.method === 'POST') {
        const why = mutationRejection(req.headers, port);
        if (why) return text(403, `Kërkesa u refuzua: ${why}`);
        const body = await readBody(req);
        if (body === undefined) return text(413, 'Kërkesë tepër e madhe');
        const form = Object.fromEntries(new URLSearchParams(body));
        if (!safeEqual(form.token ?? '', csrf)) return text(403, 'Kërkesa u refuzua: token i pavlefshëm (rifresko faqen)');
        return handlePost(p, form);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Metodë e palejuar', { Allow: 'GET, HEAD, POST' });

      const q: Query = Object.fromEntries(url.searchParams);
      const files: Files = {
        shotExists: (rel) => !!screenshotPath(opts.outputDir, rel),
        lhrExists: (name) => !!lhrPath(opts.outputDir, name),
      };

      if (p === '/') return page(200, listView(listReports(opts.outputDir), openReportsForm(csrf, '/')));
      if (p === '/style.css') return send(200, 'text/css; charset=utf-8', STYLE);
      if (p === '/audit') return page(200, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, {}, auditEnv()));
      if (p === '/jobs') return page(200, jobsListView(jobs.list(), jobs.maxConcurrent));
      if (p.startsWith('/jobs/')) {
        const job = jobs.get(p.slice('/jobs/'.length));
        return job ? page(200, jobView(job, csrf)) : page(404, errorView('Puna s\'u gjet', 'Puna s\'ekziston (lista mbahet vetëm sa është hapur dashboard-i).'));
      }
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
        if (!file) return text(404, 'Screenshot-i s\'u gjet');
        return send(200, /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', fs.readFileSync(file));
      }
      if (p.startsWith('/lhr/')) {
        const name = decodeURIComponent(p.slice('/lhr/'.length));
        const file = lhrPath(opts.outputDir, name);
        if (!file) return text(404, 'LHR s\'u gjet');
        // Shkarkim, jo shfaqje: LHR-ja përmban HTML/tekst nga faqja e audituar.
        return send(200, 'application/json; charset=utf-8', fs.readFileSync(file), { 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"` });
      }
      return page(404, errorView('S\'u gjet', 'Kjo faqe s\'ekziston.'));
    } catch (e) {
      return page(500, errorView('Gabim', `Gabim i brendshëm: ${(e as Error).message}`));
    }

    function start(reqd: AuditRequest, formState: FormState) {
      try {
        const job = jobs.start(reqd.kind, reqd.target, reqd.args, reqd.options);
        return redirect(`/jobs/${job.id}`);
      } catch (e) {
        if (e instanceof JobLimitError) return page(429, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, { ...formState, errors: [e.message] }, auditEnv()));
        throw e;
      }
    }

    function handlePost(p: string, form: Record<string, string>) {
      if (p === '/open-reports') {
        // Vetëm dosja e raporteve e këtij dashboard-i; asnjë shteg nga kërkesa.
        fs.mkdirSync(opts.outputDir, { recursive: true });
        (opts.openFolder ?? openFolderInExplorer)(opts.outputDir);
        return redirect(form.back === '/audit' ? '/audit' : '/');
      }
      if (p === '/audit/url' || p === '/audit/repo') {
        const kind = p === '/audit/url' ? 'url' : 'repo';
        const parsed = kind === 'url' ? parseUrlForm(form) : parseRepoForm(form);
        if (!parsed.ok) return page(400, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, { kind, values: form, errors: parsed.errors }, auditEnv()));
        return start(parsed.value, { kind, values: form });
      }
      if (p === '/audit/folder/check') {
        const check = checkFolder(form.path);
        if (!check.ok) return page(400, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, { kind: 'folder', values: form, errors: check.errors }, auditEnv()));
        return page(200, folderConfirmView(csrf, check, form.path ?? ''));
      }
      if (p === '/audit/folder/start') {
        // Rivalidim: nisja pranon vetëm shtegun real të konfirmuar, të pandryshuar që nga kontrolli.
        const check = checkFolder(form.path);
        if (!check.ok || check.realPath !== form.path) return page(400, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, { kind: 'folder', values: form, errors: check.ok ? ['Dosja ndryshoi që nga konfirmimi: kontrolloje përsëri.'] : check.errors }, auditEnv()));
        return start(folderRequest(check.realPath!), { kind: 'folder', values: form });
      }
      const m = p.match(/^\/jobs\/([0-9a-f-]{36})\/cancel$/);
      if (m) {
        if (!jobs.get(m[1]!)) return page(404, errorView('Puna s\'u gjet', 'Puna s\'ekziston.'));
        jobs.cancel(m[1]!);
        return redirect(`/jobs/${m[1]}`);
      }
      return page(404, errorView('S\'u gjet', 'Ky veprim s\'ekziston.'));
    }
  });
  // Mbyllja e dashboard-it ndal edhe auditet në punë (s'mbeten procese jetime).
  server.on('close', () => void jobs.cancelAll());
  return { server, jobs, csrf };
}

/**
 * Identifikuesi në header-in X-SEO-Tool: nisësi i programit të instaluar e përdor që të rihapë një dashboard
 * tashmë të hapur me të njëjtën dosje raportesh, në vend që të nisë një të dytë. Hash, jo shtegu.
 */
export function dashboardInstanceId(outputDir: string): string {
  return `dashboard; out=${crypto.createHash('sha256').update(path.resolve(outputDir).toLowerCase()).digest('hex').slice(0, 16)}`;
}

/** Hap dosjen në menaxherin e skedarëve të sistemit (pa shell; shtegu kalon si argument). */
function openFolderInExplorer(dir: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => {}).unref();
}

/** Pajtueshmëri: serveri pa qasje te punët. */
export function createDashboardServer(opts: DashboardOptions): http.Server {
  return createDashboard(opts).server;
}

/** Nis serverin vetëm në 127.0.0.1. Porti 0 = i lirë, i zgjedhur nga sistemi. */
export function startDashboard(opts: DashboardOptions & { port: number }): Promise<Dashboard & { url: string }> {
  const d = createDashboard(opts);
  return new Promise((resolve, reject) => {
    d.server.once('error', reject);
    d.server.listen(opts.port, LOOPBACK, () => {
      const { port } = d.server.address() as AddressInfo;
      resolve({ ...d, url: `http://${LOOPBACK}:${port}/` });
    });
  });
}
