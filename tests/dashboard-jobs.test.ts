import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFolder, parseRepoForm, parseUrlForm } from '../src/dashboard/forms.js';
import type { Job } from '../src/dashboard/jobs.js';
import { startDashboard, type Dashboard } from '../src/dashboard/server.js';
import { startFixtureSite, type FixtureSite } from './fixture-site.js';

const FAKE = path.resolve('tests/fixtures/fake-audit-cli.mjs');
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

type D = Dashboard & { url: string };
const origin = (d: D) => d.url.replace(/\/$/, '');

/** POST si formulari i dashboard-it: Origin i vet + token + Content-Type i formularit. */
async function post(d: D, p: string, form: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(d.url + p.replace(/^\//, ''), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin(d), 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: new URLSearchParams({ token: d.csrf, ...form }),
  });
}
const jobIdOf = (res: Response) => res.headers.get('location')!.replace('/jobs/', '');

let out: string;
let tmp: string;
beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-jobs-out-'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-jobs-src-'));
  for (const n of ['projekt-ok', 'projekt-fail', 'projekt-slow']) {
    fs.mkdirSync(path.join(tmp, n));
    fs.writeFileSync(path.join(tmp, n, 'index.html'), '<html></html>');
  }
});
afterAll(() => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------ validimi i formularëve

describe('Formularët: vlerat parazgjedhje dhe validimi', () => {
  it('URL: parazgjedhjet (25 faqe, thellësi 3) dhe argumentet për CLI-në; opsionet e çaktivizuara', () => {
    const on = { lighthouse: 'on', crawl: 'on', business: 'on', quality: 'on', visual: 'on' };
    expect(parseUrlForm({ url: 'siti.al', ...on })).toMatchObject({ ok: true, value: { kind: 'url', target: 'https://siti.al/', args: ['--max-pages', '25', '--max-depth', '3', '--', 'https://siti.al/'] } });
    const off = parseUrlForm({ url: 'https://siti.al/', maxPages: '5', crawl: 'on', saveLhr: 'on' });
    expect(off).toMatchObject({ ok: true, value: { args: ['--max-pages', '5', '--max-depth', '3', '--no-lighthouse', '--no-business', '--no-quality', '--', 'https://siti.al/'] } });
    for (const bad of [{ url: '' }, { url: 'javascript:alert(1)' }, { url: 'ftp://x.al' }, { url: 'https://u:p@x.al' }, { url: 'x.al', maxPages: '101' }, { url: 'x.al', maxDepth: '-1' }]) expect(parseUrlForm(bad).ok).toBe(false);
  });

  it('Repo: vetëm https pa kredenciale; argumentet kalojnë te motori që bën validimin e plotë', () => {
    expect(parseRepoForm({ repo: 'https://github.com/octocat/Spoon-Knife' })).toMatchObject({ ok: true, value: { args: ['--repo', 'https://github.com/octocat/Spoon-Knife'] } });
    for (const bad of ['', 'git@github.com:a/b.git', 'http://github.com/a/b', 'file:///C:/x', 'https://tok@github.com/a/b', '--upload-pack=x']) expect(parseRepoForm({ repo: bad }).ok, bad).toBe(false);
  });

  it('Dosja: vetëm shteg absolut lokal ekzistues; refuzohen relativ, rrjet, skedar, rrënja, dosja e përdoruesit, sistemi', () => {
    const ok = checkFolder(path.join(tmp, 'projekt-ok'));
    expect(ok).toMatchObject({ ok: true, realPath: fs.realpathSync.native(path.join(tmp, 'projekt-ok')), entries: { count: 1, sample: ['index.html'] } });
    const reason = (p: string) => checkFolder(p).errors[0] ?? '';
    expect(reason('projekt-ok')).toMatch(/absolut/);
    expect(reason('\\\\server\\share\\x')).toMatch(/rrjetit/);
    expect(reason('//server/share')).toMatch(/rrjetit/);
    expect(reason(path.join(tmp, 'mungon'))).toMatch(/s'u gjet/);
    expect(reason(path.join(tmp, 'projekt-ok', 'index.html'))).toMatch(/S'është dosje/);
    expect(reason(path.parse(tmp).root)).toMatch(/Rrënja e diskut/);
    expect(reason(os.homedir())).toMatch(/Dosja e përdoruesit/);
    expect(reason(process.platform === 'win32' ? (process.env.SystemRoot ?? 'C:\\Windows') : '/etc')).toMatch(/sistemit/);
  });

  it('Dosja përmes symlink/junction: shfaqet dhe auditohet shtegu real', () => {
    const link = path.join(tmp, 'lidhje');
    fs.symlinkSync(path.join(tmp, 'projekt-ok'), link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(checkFolder(link).realPath).toBe(fs.realpathSync.native(path.join(tmp, 'projekt-ok')));
  });
});

// ------------------------------------------------------------ punët me CLI të simuluar

describe('Punët (CLI i simuluar): nisja, progresi, përfundimi, gabimi dhe anulimi për të tria mënyrat', () => {
  let d: D;
  beforeAll(async () => {
    d = await startDashboard({ outputDir: out, port: 0, jobs: { command: { exec: process.execPath, args: [FAKE] }, maxConcurrent: 2, cancelGraceMs: 1500 } });
  });
  afterAll(() => new Promise<void>((r) => d.server.close(() => r())));

  const startForm = async (kind: 'url' | 'folder' | 'repo', name: string): Promise<string> => {
    if (kind === 'url') return jobIdOf(await post(d, '/audit/url', { url: `https://${name}.example/`, crawl: 'on', lighthouse: 'on' }));
    if (kind === 'repo') return jobIdOf(await post(d, '/audit/repo', { repo: `https://example.com/${name}.git` }));
    const dir = path.join(tmp, `projekt-${name}`);
    const check = await post(d, '/audit/folder/check', { path: dir });
    expect(check.status).toBe(200);
    const confirm = await check.text();
    const real = fs.realpathSync.native(dir);
    expect(confirm).toContain('Do të lexohet kjo dosje');
    expect(confirm).toContain(real.replace(/&/g, '&amp;'));
    return jobIdOf(await post(d, '/audit/folder/start', { path: real }));
  };

  for (const kind of ['url', 'folder', 'repo'] as const) {
    it(`${kind}: nisje → progres i raportuar → përfundim me link te raporti`, async () => {
      const id = await startForm(kind, 'ok');
      const running = await (await fetch(`${d.url}jobs/${id}`)).text();
      expect(running).toMatch(/<meta http-equiv="refresh" content="2">/);
      const job = await d.jobs.wait(id);
      expect(job).toMatchObject({ state: 'completed', exitCode: 0, reportStatus: 'completed' });
      expect(fs.existsSync(path.join(out, job.reportFile!))).toBe(true);
      if (kind === 'url') expect(job).toMatchObject({ engineStatus: 'scoring', crawl: { done: 3, max: 3 } });
      else expect(job.events.map((e) => e.text)).toEqual(expect.arrayContaining(['hapi 1', 'hapi 2', 'hapi 3']));
      const page = await (await fetch(`${d.url}jobs/${id}`)).text();
      expect(page).toContain(`href="/report/${encodeURIComponent(job.reportFile!)}"`);
      expect(page).not.toMatch(/http-equiv="refresh"/);
      expect((await fetch(`${d.url}report/${encodeURIComponent(job.reportFile!)}`)).status).toBe(200);
    });

    it(`${kind}: gabimi i motorit → "dështoi" me mesazhin dhe kodin, pa raport`, async () => {
      const id = await startForm(kind, 'fail');
      const job = await d.jobs.wait(id);
      expect(job).toMatchObject({ state: 'failed', exitCode: 2 });
      expect(job.error).toMatch(/Gabim i simuluar/);
      expect(job.reportFile).toBeUndefined();
      const page = await (await fetch(`${d.url}jobs/${id}`)).text();
      expect(page).toContain('Auditi dështoi');
      expect(page).not.toContain('Hap raportin');
    });

    it(`${kind}: anulimi → "anuluar", pa raport; motori pastron vetë (nipi ndalet, screenshot-et e pjesshme fshihen)`, async () => {
      const before = new Set(fs.readdirSync(out));
      const id = await startForm(kind, 'slow');
      const job = d.jobs.get(id)!;
      await until(() => job.events.some((e) => e.text.startsWith('grandchild')));
      const gpid = Number(job.events.find((e) => e.text.startsWith('grandchild'))!.text.split(' ')[1]);
      await until(() => !!job.crawl);
      expect(alive(gpid)).toBe(true);
      const res = await post(d, `/jobs/${id}/cancel`, {});
      expect(res.status).toBe(303);
      const done = await d.jobs.wait(id);
      expect(done.state).toBe('cancelled');
      expect(done.reportFile).toBeUndefined();
      await until(() => !alive(gpid), 5000);
      const shots = job.events.find((e) => e.text.startsWith('shots '))!.text.slice(6);
      expect(fs.existsSync(shots)).toBe(false);
      expect(done.exitCode).toBe(130);
      expect(job.events.map((e) => e.text).join(' | ')).toMatch(/motori u ndal pa raport dhe liroi burimet/);
      expect(job.events.map((e) => e.text).join(' | ')).not.toMatch(/me forcë/);
      expect(fs.readdirSync(out).filter((f) => !before.has(f) && f !== 'visual')).toEqual([]);
      const page = await (await fetch(`${d.url}jobs/${id}`)).text();
      expect(page).toContain('Auditi u anulua');
      expect(page).toContain("s'u krijua raport");
      expect(page).not.toContain('Hap raportin');
      // Lista e punëve s'e shfaq si të përfunduar
      expect(await (await fetch(`${d.url}jobs`)).text()).toMatch(/b-skipped">anuluar/);
    });
  }

  it("motori që s'del pas mbylljes së stdin-it ndalet me forcë pas afatit (bashkë me nipin)", async () => {
    const id = jobIdOf(await post(d, '/audit/url', { url: 'https://stubborn.example/', crawl: 'on' }));
    const job = d.jobs.get(id)!;
    await until(() => job.events.some((e) => e.text.startsWith('grandchild')));
    const gpid = Number(job.events.find((e) => e.text.startsWith('grandchild'))!.text.split(' ')[1]);
    await post(d, `/jobs/${id}/cancel`, {});
    const done = await d.jobs.wait(id);
    expect(done.state).toBe('cancelled');
    expect(done.events.map((e) => e.text).join(' | ')).toMatch(/u ndal me forcë/);
    await until(() => !alive(gpid), 5000);
  });

  it("mbyllja e dashboard-it: cancelAll pret që punët të dalin; asnjë s'del 'përfunduar'", async () => {
    const d2: D = await startDashboard({ outputDir: out, port: 0, jobs: { command: { exec: process.execPath, args: [FAKE] } } });
    const ids = [jobIdOf(await post(d2, '/audit/url', { url: 'https://slow-x.example/', crawl: 'on' })), jobIdOf(await post(d2, '/audit/repo', { repo: 'https://example.com/slow-y.git' }))];
    await until(() => ids.every((id) => d2.jobs.get(id)!.events.some((e) => e.text.startsWith('shots '))));
    const pids = ids.map((id) => Number(d2.jobs.get(id)!.events.find((e) => e.text.startsWith('grandchild'))!.text.split(' ')[1]));
    await d2.jobs.cancelAll();
    expect(ids.map((id) => d2.jobs.get(id)!.state)).toEqual(['cancelled', 'cancelled']);
    await until(() => pids.every((p) => !alive(p)), 5000);
    for (const id of ids) expect(fs.existsSync(d2.jobs.get(id)!.events.find((e) => e.text.startsWith('shots '))!.text.slice(6))).toBe(false);
    await new Promise<void>((r) => d2.server.close(() => r()));
  });

  it('anulim pasi raporti u shkrua → "përfunduar" me shënim (raporti ekziston dhe është i plotë)', async () => {
    const id = jobIdOf(await post(d, '/audit/url', { url: 'https://late.example/', crawl: 'on' }));
    const job = d.jobs.get(id)!;
    await until(() => !!job.reportFile);
    await post(d, `/jobs/${id}/cancel`, {});
    const done = await d.jobs.wait(id);
    expect(done.state).toBe('completed');
    expect(done.note).toMatch(/Anulimi erdhi pasi raporti ishte shkruar/);
  });

  it('kufiri i njëkohshmërisë: e treta refuzohet (429) derisa të lirohet një vend; i njëjti objekt dy herë jo', async () => {
    const a = jobIdOf(await post(d, '/audit/url', { url: 'https://slow-a.example/', crawl: 'on' }));
    const dup = await post(d, '/audit/url', { url: 'https://slow-a.example/', crawl: 'on' });
    expect(dup.status).toBe(429);
    expect(await dup.text()).toContain('të njëjtin objekt');
    const b = jobIdOf(await post(d, '/audit/repo', { repo: 'https://example.com/slow-b.git' }));
    const third = await post(d, '/audit/url', { url: 'https://slow-c.example/', crawl: 'on' });
    expect(third.status).toBe(429);
    expect(await third.text()).toContain('kufiri 2');
    const form = await (await fetch(`${d.url}audit`)).text();
    expect(form).toMatch(/Kufiri u arrit/);
    await post(d, `/jobs/${a}/cancel`, {});
    await d.jobs.wait(a);
    const c = await post(d, '/audit/url', { url: 'https://slow-c.example/', crawl: 'on' });
    expect(c.status).toBe(303);
    await post(d, `/jobs/${b}/cancel`, {});
    await post(d, `/jobs/${jobIdOf(c)}/cancel`, {});
    await Promise.all([d.jobs.wait(b), d.jobs.wait(jobIdOf(c))]);
  });

  it('mbrojtja nga faqe të tjera: pa token, token i gabuar, Origin i huaj, cross-site, pa Origin, JSON, body i madh → refuzim', async () => {
    const n = d.jobs.list().length;
    const form = { url: 'https://x.example/' };
    expect((await post(d, '/audit/url', { ...form, token: 'gabim' })).status).toBe(403);
    const noToken = await fetch(`${d.url}audit/url`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin(d) }, body: new URLSearchParams(form) });
    expect(noToken.status).toBe(403);
    expect((await post(d, '/audit/url', form, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await post(d, '/audit/url', form, { Origin: 'http://127.0.0.1:1' , 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    // "Origin: null" (dokument i sandbox-uar, data:) pa Sec-Fetch-Site same-origin → refuzim
    const nullOrigin = (site?: string) => fetch(`${d.url}audit/url`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null', ...(site ? { 'Sec-Fetch-Site': site } : {}) }, body: new URLSearchParams({ ...form, token: d.csrf }) });
    expect((await nullOrigin()).status).toBe(403);
    expect((await nullOrigin('cross-site')).status).toBe(403);
    const noOrigin = await fetch(`${d.url}audit/url`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, token: d.csrf }) });
    expect(noOrigin.status).toBe(403);
    expect((await post(d, '/audit/url', form, { 'Content-Type': 'application/json' })).status).toBe(403);
    expect((await post(d, '/audit/url', { ...form, pad: 'x'.repeat(20_000) })).status).toBe(413);
    expect((await post(d, `/jobs/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/cancel`, {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(d.jobs.list().length).toBe(n);
    // Tokeni është në formularët e vetë dashboard-it (që faqet e huaja s'i lexojnë: pa CORS).
    const page = await fetch(`${d.url}audit`);
    expect(await page.text()).toContain(`name="token" value="${d.csrf}"`);
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('dosja: nisja pranon vetëm shtegun real të konfirmuar; shteg i ndryshëm ose i pavlefshëm → formular me gabim', async () => {
    const n = d.jobs.list().length;
    const bad = await post(d, '/audit/folder/start', { path: 'relativ/dosje' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('absolut');
    const unc = await post(d, '/audit/folder/check', { path: '\\\\evil.example\\share' });
    expect(await unc.text()).toMatch(/Shtigjet e rrjetit/);
    const link = path.join(tmp, 'lidhje');
    const viaLink = await post(d, '/audit/folder/start', { path: link });
    expect(viaLink.status).toBe(400);
    expect(await viaLink.text()).toContain('Dosja ndryshoi që nga konfirmimi');
    expect(d.jobs.list().length).toBe(n);
  });
});

// ------------------------------------------------------------ punët me CLI-në reale (motori ekzistues)

describe('Punët me CLI-në reale: URL (fixture lokal), dosje, repo (gabim pa rrjet) dhe anulim', () => {
  let d: D;
  let site: FixtureSite;
  let slow: FixtureSite;
  beforeAll(async () => {
    site = await startFixtureSite();
    slow = await startFixtureSite({ productPages: 40, latencyMs: 300 });
    d = await startDashboard({ outputDir: out, port: 0, jobs: { allowLocal: [site.host, slow.host] } });
  });
  afterAll(async () => {
    await new Promise<void>((r) => d.server.close(() => r()));
    await site.close();
    await slow.close();
  });

  it('URL: auditi real përfundon, progresi vjen nga motori dhe raporti hapet', async () => {
    const res = await post(d, '/audit/url', { url: site.base, crawl: 'on', maxPages: '5', business: 'on' });
    expect(res.status).toBe(303);
    const job = await d.jobs.wait(jobIdOf(res));
    expect(job.state, job.error).toBe('completed');
    expect(job.events.map((e) => e.text)).toEqual(expect.arrayContaining(['statusi: crawling', 'statusi: auditing', 'statusi: scoring']));
    expect(job.crawl).toMatchObject({ max: 5 });
    expect(job.command).toContain('--no-lighthouse');
    const report = JSON.parse(fs.readFileSync(path.join(out, job.reportFile!), 'utf8'));
    expect(report.url.replace(/\/$/, '')).toBe(site.base.replace(/\/$/, ''));
    expect((await fetch(`${d.url}report/${encodeURIComponent(job.reportFile!)}`)).status).toBe(200);
  }, 120_000);

  it('Dosje: auditi real i skedarëve përfundon (pa ekzekutim kodi)', async () => {
    const dir = path.resolve('tests/fixtures/source/sit statik ë ç');
    const res = await post(d, '/audit/folder/start', { path: fs.realpathSync.native(dir) });
    const job = await d.jobs.wait(jobIdOf(res));
    expect(job.state, job.error).toBe('completed');
    expect(job.reportFile).toMatch(/^source-folder-sit_statik_e_c-/);
    expect(job.events.map((e) => e.text)).toContain('lista e skedarëve (pa ndjekur symlink-e)');
  }, 120_000);

  it('Repo: motori refuzon hostin privat (kufizimet ekzistuese) → "dështoi", pa rrjet dhe pa raport', async () => {
    const res = await post(d, '/audit/repo', { repo: 'https://127.0.0.1/repo.git' });
    const job = await d.jobs.wait(jobIdOf(res));
    expect(job).toMatchObject({ state: 'failed', exitCode: 2 });
    expect(job.error).toMatch(/URL e refuzuar: 127\.0\.0\.1/);
    expect(job.reportFile).toBeUndefined();
  }, 120_000);

  it('Anulim real gjatë crawl-it: procesi ndalet, s\'shkruhet raport', async () => {
    const before = new Set(fs.readdirSync(out));
    const res = await post(d, '/audit/url', { url: new URL('/products', slow.base).href, crawl: 'on', maxPages: '40' });
    expect(res.status, await res.clone().text()).toBe(303);
    const id = jobIdOf(res);
    const job = d.jobs.get(id)!;
    await until(() => (job.crawl?.done ?? 0) >= 2, 60_000);
    await post(d, `/jobs/${id}/cancel`, {});
    const done: Job = await d.jobs.wait(id);
    expect(done.state).toBe('cancelled');
    const requestsAtCancel = slow.requests.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(slow.requests.length).toBe(requestsAtCancel);
    expect(fs.readdirSync(out).filter((f) => !before.has(f) && f.endsWith('.json'))).toEqual([]);
  }, 120_000);
});
