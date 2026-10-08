import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { compareReports } from './compare.js';
import { compareVisual, pixelDiff, type PixelDiffResult } from './visual-compare.js';
import { compareSeries, seriesForCompare } from './lh-series.js';
import { checkFolder, folderRequest, parseRepoForm, parseUrlForm, type AuditRequest } from './forms.js';
import { JobLimitError, JobManager, type JobManagerOptions } from './jobs.js';
import { STYLE } from './style.js';
import { kindOf, listReports, lhrPath, readReport, screenshotPath } from './store.js';
import { auditFormsView, folderConfirmView, jobsListView, jobView, openReportsForm, type AuditEnv, type FormState } from './views-jobs.js';
import { findBrowser, type BrowserLookup } from '../core/browser.js';
import { gitAvailable } from '../core/git.js';
import { loadConfig } from '../core/config.js';
import { defaultGscDir, displayDir, GscStore, maskClientId, parseClientJson, redactSecrets as redactSecretsSafe } from './gsc-store.js';
import { buildAuthRequest, checkState, exchangeCode, GscClient, GscError, revokeToken, type FetchFn, type GscSite, type PendingAuth } from './gsc-api.js';
import { datasetsForReport, fetchDataset, indexDataset, latestFinalDate, presetPeriod, validatePeriod, crawlMatch, type GscDataset } from './gsc-model.js';
import { confirmDeleteBody, connectBody, datasetBody, gscBody, type GscViewState } from './views-gsc.js';

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
import { layout } from './views.js';
import { overviewView } from './views-overview.js';
import { buildTasks } from './tasks.js';
import { urlIssues } from './model.js';
import { comparePickerView, compareView, errorView, galleryView, listView, sourceReportView, tasksView, urlReportView, visualCompareView, type Files, type Query } from './views.js';

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
  /** Search Console (faza 5): ruajtja dhe fetch-i (testet japin store në dosje të përkohshme dhe fetch të simuluar). */
  gsc?: { store?: GscStore; fetch?: FetchFn; now?: () => Date; /** Google i simuluar: çdo faqe dhe periudhë etiketohet "Demo". */ demo?: boolean };
}

/** Mesazhet e faqes GSC sipas kodit (s'pasqyrohet tekst arbitrar nga URL-ja). */
const GSC_MESSAGES: Record<string, string> = {
  imported: 'Klienti OAuth u importua dhe u ruajt i mbrojtur.',
  connected: 'Llogaria Google u lidh (vetëm lexim i Search Console).',
  // "u revokua" thuhet vetëm kur Google e konfirmoi kërkesën e revokimit (HTTP 200).
  disconnected: 'Llogaria u shkëput: Google konfirmoi revokimin e token-it dhe token-i u fshi nga ky kompjuter.',
  'disconnected-local': "Kredencialet lokale (token-i) u fshinë nga ky kompjuter, por revokimi te Google NUK u konfirmua (token-i mund të ishte tashmë i pavlefshëm, ose kërkesa dështoi). Kontrollo dhe hiq aksesin te myaccount.google.com/permissions.",
  'disconnected-none': "S'kishte token të ruajtur në këtë kompjuter; s'u dërgua asnjë kërkesë revokimi te Google.",
  'data-deleted': 'Të dhënat e ruajtura të Search Console u fshinë.',
  'all-deleted': 'U fshi gjithçka e Search Console në këtë kompjuter (klienti, token-i, të dhënat). Google konfirmoi revokimin e token-it.',
  'all-deleted-local': "U fshi gjithçka e Search Console në këtë kompjuter (klienti, token-i, të dhënat), por revokimi te Google NUK u konfirmua. Kontrollo dhe hiq aksesin te myaccount.google.com/permissions.",
  'all-deleted-none': "U fshi gjithçka e Search Console në këtë kompjuter (klienti, të dhënat). S'kishte token të lexueshëm, prandaj s'u dërgua kërkesë revokimi te Google.",
};
const GSC_ERRORS: Record<string, string> = {
  denied: 'Lidhja u anulua te Google (s\'u dha leja).',
};

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
  // Search Console: sekretet në dosjen e përdoruesit (DPAPI në Windows), jashtë output/ dhe Git.
  const gscStore = opts.gsc?.store ?? new GscStore();
  const gscFetch: FetchFn = opts.gsc?.fetch ?? ((url, init) => fetch(url, init));
  const gscNow = opts.gsc?.now ?? (() => new Date());
  const gscDemo = opts.gsc?.demo === true;
  const gscApi = new GscClient(gscStore, gscFetch, () => gscNow().getTime());
  // Gjendja e lidhjes OAuth në pritje: vetëm në memorie, një përdorim, 10 minuta.
  let pendingAuth: PendingAuth | undefined;
  const gscErrorText = (e: unknown) => (e instanceof GscError ? e.message : `Gabim: ${redactSecretsSafe((e as Error)?.message ?? String(e))}`);
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
        if (p.startsWith('/gsc/')) return await handleGscPost(p, form);
        return handlePost(p, form);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Metodë e palejuar', { Allow: 'GET, HEAD, POST' });

      const q: Query = Object.fromEntries(url.searchParams);
      const files: Files = {
        shotExists: (rel) => !!screenshotPath(opts.outputDir, rel),
        lhrExists: (name) => !!lhrPath(opts.outputDir, name),
      };

      if (p === '/') return page(200, overviewPage(q.site));
      if (p === '/reports') return page(200, listView(listReports(opts.outputDir), openReportsForm(csrf, '/reports')));
      if (p === '/tasks') {
        // Detyrat e raportit URL më të fundit (ose të sitit të zgjedhur); pa raport → Përmbledhja.
        const latest = latestUrlReport(q.site);
        return redirect(latest ? `/report/${encodeURIComponent(latest.file)}/tasks` : '/');
      }
      // --- Search Console (vetëm lexim) ---
      if (p === '/gsc') return page(200, layout('Search Console', gscBody(await gscState({ message: GSC_MESSAGES[q.msg ?? ''], error: GSC_ERRORS[q.err ?? ''] }))));
      if (p === '/gsc/confirm') {
        const what = q.what === 'all' ? 'all' : 'data';
        let n = 0;
        try {
          n = gscStore.listDatasets().length;
        } catch {
          n = 0;
        }
        return page(200, layout('Search Console', confirmDeleteBody(csrf, what, n)));
      }
      if (p === '/gsc/callback') {
        if (q.error) {
          pendingAuth = undefined;
          return redirect('/gsc?err=denied');
        }
        const bad = checkState(pendingAuth, q.state, gscNow().getTime());
        if (bad) return page(400, layout('Search Console', gscBody(await gscState({ error: bad }))));
        const pending = pendingAuth!;
        pendingAuth = undefined; // një përdorim
        try {
          const client = gscStore.loadClient();
          if (!client) throw new GscError("Klienti OAuth s'është importuar.", 'not-configured');
          gscStore.saveToken(await exchangeCode(gscFetch, client, pending, q.code ?? '', gscNow().getTime()));
          return redirect('/gsc?msg=connected');
        } catch (e) {
          return page(400, layout('Search Console', gscBody(await gscState({ error: gscErrorText(e) }))));
        }
      }
      const gd = p.match(/^\/gsc\/data\/([a-f0-9]{16})$/);
      if (gd) {
        const ds = gscStore.loadDataset<GscDataset>(gd[1]!);
        if (!ds) return page(404, errorView("S'u gjet", 'Kjo periudhë e Search Console s\'ekziston (mund të jetë fshirë).'));
        let match;
        if (q.report) {
          const rr = readReport(opts.outputDir, q.report);
          if (rr.ok && kindOf(rr.report) === 'url') match = { report: q.report, m: crawlMatch(rr.report, indexDataset(ds)) };
        }
        return page(200, layout(`GSC · ${ds.property}`, datasetBody(ds, { page: q.page, query: q.query, pp: q.pp, qp: q.qp, n: q.n }, match, hasToken())));
      }
      if (p === '/style.css') return send(200, 'text/css; charset=utf-8', STYLE);
      if (p === '/audit') return page(200, auditFormsView(csrf, jobs.running(), jobs.maxConcurrent, {}, auditEnv()));
      if (p === '/jobs') return page(200, jobsListView(jobs.list(), jobs.maxConcurrent));
      if (p.startsWith('/jobs/')) {
        const job = jobs.get(p.slice('/jobs/'.length));
        return job ? page(200, jobView(job, csrf)) : page(404, errorView('Puna s\'u gjet', 'Puna s\'ekziston (lista mbahet vetëm sa është hapur dashboard-i).'));
      }
      // Detyrat e rekomanduara: /report/<emri>/tasks (vetëm raporte URL; emri validohet si çdo raport)
      const tsk = p.match(/^\/report\/([^/]+)\/tasks$/);
      if (tsk) {
        const name = decodeURIComponent(tsk[1]!);
        const r = readReport(opts.outputDir, name);
        if (!r.ok) return page(404, errorView("Raporti s'u hap", r.reason));
        if (kindOf(r.report) !== 'url') return page(404, errorView('Pa detyra', 'Auditet e skedarëve kanë gjetjet e tyre me path:line; detyrat vlejnë për raportet URL.'));
        const datasets = datasetsForReport(r.report, gscStore.listDatasets<GscDataset>());
        const chosen = q.gsc === 'none' ? undefined : (datasets.find((d) => d.id === q.gsc) ?? datasets[0]);
        return page(200, tasksView(name, r.report, { datasets, selected: chosen ? indexDataset(chosen) : null, rank: q.rank === 'gsc' ? 'gsc' : 'technical', report: r.report, connected: hasToken() }, { area: q.area, sev: q.sev }));
      }
      // Galeria e pamjeve: /report/<emri>/visual (emri validohet si çdo raport; imazhet vetëm përmes /shot/)
      const gal = p.match(/^\/report\/([^/]+)\/visual$/);
      if (gal) {
        const name = decodeURIComponent(gal[1]!);
        const r = readReport(opts.outputDir, name);
        if (!r.ok) return page(404, errorView('Raporti s\'u hap', r.reason));
        if (kindOf(r.report) !== 'url') return page(404, errorView('Pa pamje', 'Auditet e skedarëve s\'kanë pamje të renderuara.'));
        return page(200, galleryView(name, r.report, q, files));
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
        const shotFile = (rel: string) => screenshotPath(opts.outputDir, rel);
        const sa = seriesForCompare(a.report);
        const sb = seriesForCompare(b.report);
        return page(200, compareView(compareReports(q.a, a.report, q.b, b.report), compareVisual(q.a, a.report, q.b, b.report, shotFile), sa && sb ? compareSeries(sa, sb) : null));
      }
      // Krahasimi vizual: e njëjta faqe + pajisje mes dy auditeve; pikselët maten vetëm për çiftin e zgjedhur.
      if (p === '/compare/visual') {
        const list = listReports(opts.outputDir);
        if (!q.a || !q.b) return page(200, comparePickerView(list, { a: list.reports[1]?.file, b: list.reports[0]?.file }));
        const a = readReport(opts.outputDir, q.a);
        const b = readReport(opts.outputDir, q.b);
        if (!a.ok || !b.ok) return page(404, comparePickerView(list, q, `S'u hap: ${!a.ok ? a.reason : ''} ${!b.ok ? b.reason : ''}`));
        if (q.a === q.b) return page(400, comparePickerView(list, q, 'Zgjidh dy raporte të ndryshme.'));
        const shotFile = (rel: string) => screenshotPath(opts.outputDir, rel);
        const c = compareVisual(q.a, a.report, q.b, b.report, shotFile);
        const sel = c.pairs.find((x) => x.url === q.page && x.device === q.device);
        let diff: PixelDiffResult | undefined;
        if (sel && sel.status !== 'not-comparable' && sel.a && sel.b) {
          const fa = shotFile(sel.a.screenshot);
          const fb = shotFile(sel.b.screenshot);
          if (fa && fb) diff = pixelDiff(fa, fb, sel.a.meta.viewportSize?.deviceScaleFactor ?? 1);
        }
        return page(200, visualCompareView(c, q, diff));
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

    /** A ka token të ruajtur e të lexueshëm (pa thirrje te Google). */
    function hasToken(): boolean {
      try {
        return !!gscStore.loadToken();
      } catch {
        return false;
      }
    }

    /** Raporti URL më i fundit (për sitin e dhënë, ose për çdo sit). */
    function latestUrlReport(siteKey?: string) {
      const urls = listReports(opts.outputDir).reports.filter((x) => x.kind === 'url');
      return (siteKey ? urls.find((x) => x.siteKey === siteKey) : undefined) ?? urls[0];
    }

    /** Përmbledhja: raporti URL më i fundit i sitit, detyrat dhe periudha GSC më e fundit që e mbulon. */
    function overviewPage(siteKey?: string): string {
      const list = listReports(opts.outputDir);
      const urls = list.reports.filter((x) => x.kind === 'url');
      const sites = [...new Map(urls.map((x) => [x.siteKey, { key: x.siteKey, target: x.target }])).values()];
      const latest = latestUrlReport(siteKey);
      const base = { sites, otherReports: list.reports.length - urls.length };
      if (!latest) return overviewView(base);
      const rr = readReport(opts.outputDir, latest.file);
      if (!rr.ok) return overviewView(base);
      let datasets: GscDataset[] = [];
      try {
        datasets = datasetsForReport(rr.report, gscStore.listDatasets<GscDataset>());
      } catch {
        datasets = [];
      }
      return overviewView({
        ...base,
        site: { key: latest.siteKey, target: latest.target },
        latest: { summary: latest, report: rr.report },
        tasks: buildTasks(rr.report, urlIssues(rr.report)),
        gsc: { dataset: datasets[0] ?? null, connected: hasToken() },
      });
    }

    async function gscState(extra: Partial<GscViewState> = {}): Promise<GscViewState> {
      const state: GscViewState = { csrf, dir: displayDir(gscStore.dir), dirConfigured: !samePath(gscStore.dir, defaultGscDir()), protection: gscStore.protector.kind, demo: gscDemo, datasets: [], ...extra };
      try {
        const c = gscStore.loadClient();
        if (c) state.client = { clientId: maskClientId(c.clientId), projectId: c.projectId };
        const t = gscStore.loadToken();
        if (t) state.token = { connectedAt: t.connectedAt, scope: t.scope };
        state.datasets = gscStore.listDatasets<GscDataset>();
        state.lastRevoke = gscStore.loadRevokeResult();
      } catch (e) {
        state.error = state.error ?? gscErrorText(e);
      }
      if (state.token) {
        try {
          state.sites = await gscApi.listSites();
        } catch (e) {
          state.sitesError = gscErrorText(e);
          if (e instanceof GscError && e.kind === 'reconnect') state.token = undefined;
        }
      }
      return state;
    }

    /** Revokimi i token-it të ruajtur: '' = Google e konfirmoi, '-local' = s'u konfirmua, '-none' = s'kishte token të lexueshëm. */
    async function revokeStored(): Promise<'' | '-local' | '-none'> {
      let t;
      try {
        t = gscStore.loadToken();
      } catch {
        // I palexueshëm (p.sh. tjetër përdorues Windows): s'ka çfarë t'i dërgohet Google-it; fshihet lokalisht.
        t = undefined;
      }
      if (!t) return '-none';
      const r = await revokeToken(gscFetch, t);
      // Përgjigjja e Google ruhet (pa token) që të verifikohet më vonë te faqja GSC; "Fshi gjithçka" e heq bashkë me dosjen.
      gscStore.saveRevokeResult({ at: gscNow().toISOString(), confirmed: r.revoked, httpStatus: r.httpStatus, error: r.error });
      return r.revoked ? '' : '-local';
    }

    async function handleGscPost(p: string, form: Record<string, string>) {
      const fail = async (status: number, error: string) => page(status, layout('Search Console', gscBody(await gscState({ error }))));
      try {
        if (p === '/gsc/client') {
          const parsed = parseClientJson(form.json ?? '');
          if (!parsed.ok) return await fail(400, parsed.error);
          gscStore.saveClient(parsed.client);
          return redirect('/gsc?msg=imported');
        }
        if (p === '/gsc/connect') {
          const client = gscStore.loadClient();
          if (!client) return await fail(400, 'Importo fillimisht klientin OAuth.');
          const port = (server.address() as AddressInfo).port;
          const { url, pending } = buildAuthRequest(client, `http://${LOOPBACK}:${port}/gsc/callback`, gscNow().getTime());
          pendingAuth = pending;
          return page(200, layout('Lidhja me Google', connectBody(url, gscDemo)));
        }
        if (p === '/gsc/disconnect') {
          const r = await revokeStored();
          gscStore.deleteToken();
          return redirect(`/gsc?msg=disconnected${r}`);
        }
        // Fshirjet kërkojnë konfirmimin nga faqja /gsc/confirm (fusha confirm=po); pa të → te konfirmimi.
        if ((p === '/gsc/delete-data' || p === '/gsc/delete-all') && form.confirm !== 'po') return redirect(`/gsc/confirm?what=${p === '/gsc/delete-all' ? 'all' : 'data'}`);
        if (p === '/gsc/delete-data') {
          gscStore.deleteDatasets();
          return redirect('/gsc?msg=data-deleted');
        }
        if (p === '/gsc/delete-all') {
          const r = await revokeStored();
          gscStore.deleteAll();
          return redirect(`/gsc?msg=all-deleted${r}`);
        }
        if (p === '/gsc/fetch') {
          // Property duhet të jetë nga lista e llogarisë (s'pranohet vlerë arbitrare).
          const sites: GscSite[] = await gscApi.listSites();
          const site = sites.find((x) => x.siteUrl === form.property);
          if (!site) return await fail(400, 'Property e panjohur për këtë llogari.');
          const latest = await latestFinalDate(gscApi, site.siteUrl, gscNow());
          let period: { startDate: string; endDate: string };
          if (form.preset === 'custom') period = { startDate: (form.start ?? '').trim(), endDate: (form.end ?? '').trim() };
          else {
            const days = Number(form.preset);
            if (![7, 28, 90].includes(days)) return await fail(400, 'Periudhë e pavlefshme.');
            if (!latest) return await fail(400, `Property ${site.siteUrl} s'ka të dhëna përfundimtare në 10 ditët e fundit; zgjidh periudhë të dhënë me data.`);
            period = presetPeriod(days, latest);
          }
          const bad = validatePeriod(period.startDate, period.endDate, latest, gscNow());
          if (bad) return await fail(400, bad);
          const ds = await fetchDataset(gscApi, site, period.startDate, period.endDate, latest, gscNow(), gscDemo);
          gscStore.saveDataset(ds);
          return redirect(`/gsc/data/${ds.id}`);
        }
        return page(404, errorView('S\'u gjet', 'Ky veprim s\'ekziston.'));
      } catch (e) {
        return await fail(e instanceof GscError && e.kind === 'invalid' ? 400 : 502, gscErrorText(e));
      }
    }

    function handlePost(p: string, form: Record<string, string>) {
      if (p === '/open-reports') {
        // Vetëm dosja e raporteve e këtij dashboard-i; asnjë shteg nga kërkesa.
        fs.mkdirSync(opts.outputDir, { recursive: true });
        (opts.openFolder ?? openFolderInExplorer)(opts.outputDir);
        return redirect(form.back === '/audit' ? '/audit' : '/reports');
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
