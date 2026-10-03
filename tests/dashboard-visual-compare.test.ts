import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageFileSize, imageSize } from '../src/core/image-size.js';
import { startDashboard } from '../src/dashboard/server.js';
import { screenshotPath, type Obj } from '../src/dashboard/store.js';
import { compareVisual, pixelDiff, type VisualPair } from '../src/dashboard/visual-compare.js';

// ------------------------------------------------------------ fixtures: imazhe JPEG reale (të vogla) dhe raporte schema 4

const W = 40;
const H = 60;
const VP = { width: W, height: 30, deviceScaleFactor: 1, isMobile: false };
const VPM = { width: 20, height: 30, deviceScaleFactor: 1, isMobile: true };

/** JPEG W×h me ngjyrë uniforme; `band` ngjyros ndryshe rreshtat [from, to). */
function jpg(w: number, h: number, band?: [number, number]): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hit = band && y >= band[0] && y < band[1];
      data[i] = hit ? 20 : 230;
      data[i + 1] = hit ? 20 : 230;
      data[i + 2] = hit ? 200 : 230;
      data[i + 3] = 255;
    }
  return jpeg.encode({ width: w, height: h, data }, 95).data;
}

/** Pamje me metadatat e plota të kapjes (motori i ri). */
const full = (dir: string, url: string, device: 'desktop' | 'mobile', file: string, o: Obj = {}) => {
  const vp = device === 'mobile' ? VPM : VP;
  return {
    url, pageType: 'home', viewport: device, status: 'ok', screenshot: `visual/${dir}/${file}`, finalUrl: url,
    viewportSize: vp, measuredViewport: { width: vp.width, height: vp.height },
    clip: { width: vp.width, height: H, documentHeight: H, clipped: false },
    screenshotSize: { width: vp.width, height: H }, capturedAt: '2026-10-02T10:00:00.000Z',
    summary: { documentHeight: H }, ...o,
  };
};
/** Pamje e raportit të vjetër: pa viewport, prerje, përmasa, URL përfundimtare. */
const old = (dir: string, url: string, device: 'desktop' | 'mobile', file: string) => ({ url, pageType: 'home', viewport: device, status: 'ok', screenshot: `visual/${dir}/${file}`, summary: { documentHeight: 7616 } });

function report(url: string, date: string, dir: string, captures: Obj[], browserVersion?: string): Obj {
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', url, finalUrl: url, startedAt: date, completedAt: date, status: 'completed',
    health: { score: 77, status: 'GOOD', missingCategories: [] }, categories: { availability: 100 }, modules: [], issues: [], topImprovements: [],
    quality: { status: 'info', statuses: {}, groups: [], issues: [], visual: { screenshotsDir: `visual/${dir}`, limits: { maxPages: 4, maxScreenshotHeight: 3000 }, browserVersion, captures } },
  };
}

let out: string;
const shot = (rel: string) => screenshotPath(out, rel);
const put = (dir: string, file: string, data: Buffer) => {
  fs.mkdirSync(path.join(out, 'visual', dir), { recursive: true });
  fs.writeFileSync(path.join(out, 'visual', dir, file), data);
};
const R: Record<string, Obj> = {};
const CHROME = 'HeadlessChrome/141.0.7390.54';

beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-vcmp-'));
  // A (i ri, i plotë) dhe B (i ri, i plotë): home desktop i njëjtë, home mobile me një brez të ndryshuar
  put('a', 'home-d.jpg', jpg(W, H));
  put('a', 'home-m.jpg', jpg(20, H));
  put('a', 'contact-d.jpg', jpg(W, H));
  put('b', 'home-d.jpg', jpg(W, H));
  put('b', 'home-m.jpg', jpg(20, H, [0, 20]));
  put('b', 'contact-d.jpg', jpg(W, H + 10)); // skedari s'përputhet me screenshotSize të raportit
  put('old', 'home-d.jpg', jpg(W, H));
  put('old', 'home-m.jpg', jpg(20, H));
  put('wide', 'home-d.jpg', jpg(W * 2, H));
  R.A = report('https://e.com/', '2026-10-02T10:00:00.000Z', 'a', [
    full('a', 'https://e.com/', 'desktop', 'home-d.jpg'),
    full('a', 'https://e.com/', 'mobile', 'home-m.jpg'),
    full('a', 'https://e.com/contact/', 'desktop', 'contact-d.jpg'),
    full('a', 'https://e.com/rooms/', 'desktop', 'rooms-d.jpg'), // skedari mungon
  ], CHROME);
  R.B = report('https://e.com/', '2026-10-02T11:00:00.000Z', 'b', [
    full('b', 'https://e.com/', 'desktop', 'home-d.jpg'),
    full('b', 'https://e.com/', 'mobile', 'home-m.jpg'),
    full('b', 'https://e.com/contact/', 'desktop', 'contact-d.jpg'),
    full('b', 'https://e.com/rooms/', 'desktop', 'rooms-d.jpg'),
    full('b', 'https://e.com/new/', 'desktop', 'new-d.jpg'), // vetëm te B
  ], CHROME);
  R.OLD = report('https://e.com/', '2026-10-01T10:00:00.000Z', 'old', [old('old', 'https://e.com/', 'desktop', 'home-d.jpg'), old('old', 'https://e.com/', 'mobile', 'home-m.jpg')]);
  R.WIDE = report('https://e.com/', '2026-10-02T12:00:00.000Z', 'wide', [full('wide', 'https://e.com/', 'desktop', 'home-d.jpg', { viewportSize: { ...VP, width: W * 2 }, measuredViewport: { width: W * 2, height: 30 }, clip: { width: W * 2, height: H, documentHeight: H, clipped: false }, screenshotSize: { width: W * 2, height: H } })], CHROME);
  R.REDIR = report('https://e.com/', '2026-10-02T13:00:00.000Z', 'b', [full('b', 'https://e.com/', 'desktop', 'home-d.jpg', { finalUrl: 'https://e.com/sq/' })], 'HeadlessChrome/142.0.1.1');
  R.OTHER = report('https://tjeter.com/', '2026-10-02T13:00:00.000Z', 'b', [full('b', 'https://tjeter.com/', 'desktop', 'home-d.jpg')], CHROME);
  for (const [k, r] of Object.entries(R)) fs.writeFileSync(path.join(out, `${k === 'OTHER' ? 'tjeter.com' : 'e.com'}-2026100${Object.keys(R).indexOf(k)}-100000.json`), JSON.stringify(r));
});
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

const pairOf = (ps: VisualPair[], url: string, device: string) => ps.find((p) => p.url === url && p.device === device)!;
const check = (p: VisualPair, key: string) => p.checks.find((c) => c.key === key)!;

// ------------------------------------------------------------ përmasat reale të skedarit

describe('Përmasat e imazhit nga header-i', () => {
  it('JPEG dhe PNG lexohen; skedari i dëmtuar ose i panjohur → null', () => {
    expect(imageSize(jpg(37, 11))).toEqual({ width: 37, height: 11 });
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(390, 16);
    png.writeUInt32BE(3000, 20);
    expect(imageSize(png)).toEqual({ width: 390, height: 3000 });
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(imageSize(Buffer.from('jo imazh'))).toBeNull();
    expect(imageFileSize(path.join(os.tmpdir(), 'nuk-ekziston-xyz.jpg'))).toBeNull();
  });
});

// ------------------------------------------------------------ verifikimi para krahasimit

describe('Krahasimi vizual: verifikimi i URL-së, pajisjes, viewport-it, prerjes dhe skedarit', () => {
  it('metadata të plota dhe të njëjta → krahasim i plotë; ndryshimi i pikselëve matet sipas brezave', () => {
    const c = compareVisual('A.json', R.A!, 'B.json', R.B!, shot);
    expect(c.sameTarget).toBe(true);
    const d = pairOf(c.pairs, 'https://e.com/', 'desktop');
    expect(d.status).toBe('full');
    expect(d.checks.every((x) => x.state === 'ok')).toBe(true);
    expect(check(d, 'viewport').a).toBe('40 × 30');
    expect(check(d, 'clip').a).toBe('e plotë');
    const same = pixelDiff(shot(d.a!.screenshot)!, shot(d.b!.screenshot)!);
    expect(same).toMatchObject({ ok: true, changedPct: 0, commonHeight: H });
    expect(d.orientative).toBe(false);

    const m = pairOf(c.pairs, 'https://e.com/', 'mobile');
    expect(m.status).toBe('full');
    const diff = pixelDiff(shot(m.a!.screenshot)!, shot(m.b!.screenshot)!);
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.changedPct).toBeGreaterThan(30); // 20 nga 60 rreshta
      expect(diff.changedPct).toBeLessThan(37);
      expect(diff.bands[0]).toMatchObject({ from: 0, to: H });
    }
  });

  it('skedari që s\'përputhet me përmasat e raportit, skedari që mungon dhe faqja vetëm në njërin audit → s\'krahasohet', () => {
    const c = compareVisual('A.json', R.A!, 'B.json', R.B!, shot);
    const ct = pairOf(c.pairs, 'https://e.com/contact/', 'desktop');
    expect(ct.status).toBe('not-comparable');
    expect(check(ct, 'file')).toMatchObject({ state: 'blocked' });
    expect(check(ct, 'file').note).toContain("B: skedari s'përputhet me raportin");
    expect(check(ct, 'file').b).toBe('40 × 70 (raporti: 40 × 60)');

    const rooms = pairOf(c.pairs, 'https://e.com/rooms/', 'desktop');
    expect(rooms.status).toBe('not-comparable');
    expect(check(rooms, 'file').note).toContain('screenshot-i mungon lokalisht');

    const only = pairOf(c.pairs, 'https://e.com/new/', 'desktop');
    expect(only.a).toBeUndefined();
    expect(only.status).toBe('not-comparable');
    expect(only.checks[0]!.note).toContain("faqja s'u kap në këtë pajisje te A");

    // pamje e anashkaluar nga motori: arsyeja pa prefiksin e dyfishtë
    const skipped = report('https://e.com/', '2026-10-02T09:00:00.000Z', 'a', [{ url: 'https://e.com/', pageType: 'home', viewport: 'desktop', status: 'skipped', reason: "S'u renderua: Session closed." }]);
    const sk = pairOf(compareVisual('S.json', skipped, 'A.json', R.A!, shot).pairs, 'https://e.com/', 'desktop');
    expect(sk.status).toBe('not-comparable');
    expect(sk.checks[0]!.note).toBe("s'u renderua te A: Session closed.");
  });

  it('raport i vjetër pa metadata → krahasim me kufizime; vlerat që mungojnë s\'shpiken, prerja nxirret dhe shënohet', () => {
    const c = compareVisual('OLD.json', R.OLD!, 'A.json', R.A!, shot);
    const d = pairOf(c.pairs, 'https://e.com/', 'desktop');
    expect(d.status).toBe('limited');
    expect(d.orientative).toBe(true);
    expect(check(d, 'viewport')).toMatchObject({ a: "s'është ruajtur", b: '40 × 30', state: 'limited' });
    expect(check(d, 'viewport').note).toContain('raport i vjetër');
    expect(check(d, 'finalUrl')).toMatchObject({ a: "s'është ruajtur", state: 'limited' });
    expect(check(d, 'measured').a).toBe("s'është ruajtur");
    expect(check(d, 'clip').a).toBe('prerë te 3000 px (nxjerrë nga lartësia)');
    expect(check(d, 'clip').state).toBe('limited');
    expect(check(d, 'file')).toMatchObject({ a: '40 × 60', state: 'limited' });
    expect(check(d, 'browser')).toMatchObject({ a: "s'është ruajtur", state: 'limited' });
    // URL dhe pajisja vërtetohen edhe për raportin e vjetër
    expect(check(d, 'url').state).toBe('ok');
    expect(check(d, 'device').state).toBe('ok');
  });

  it('gjerësi e ndryshme viewport-i → s\'krahasohet piksel-për-piksel; ridrejtim dhe Chrome tjetër → kufizime', () => {
    const w = pairOf(compareVisual('A.json', R.A!, 'W.json', R.WIDE!, shot).pairs, 'https://e.com/', 'desktop');
    expect(w.status).toBe('not-comparable');
    expect(check(w, 'viewport')).toMatchObject({ state: 'blocked' });
    expect(check(w, 'file').note).toContain('gjerësi të ndryshme');

    const r = pairOf(compareVisual('A.json', R.A!, 'R.json', R.REDIR!, shot).pairs, 'https://e.com/', 'desktop');
    expect(r.status).toBe('limited');
    expect(check(r, 'finalUrl')).toMatchObject({ b: 'https://e.com/sq/', state: 'limited' });
    expect(check(r, 'browser')).toMatchObject({ a: 'Chrome 141', b: 'Chrome 142', state: 'limited' });
  });

  it('pajisja e ruajtur që s\'përputhet me emulimin → s\'krahasohet; site të ndryshme → asnjë çift', () => {
    const bad = report('https://e.com/', '2026-10-02T14:00:00.000Z', 'b', [full('b', 'https://e.com/', 'desktop', 'home-d.jpg', { viewportSize: { ...VP, isMobile: true } })], CHROME);
    expect(check(pairOf(compareVisual('A.json', R.A!, 'X.json', bad, shot).pairs, 'https://e.com/', 'desktop'), 'device').state).toBe('blocked');
    const o = compareVisual('A.json', R.A!, 'O.json', R.OTHER!, shot);
    expect(o.sameTarget).toBe(false);
    expect(o.pairs).toEqual([]);
  });
});

// ------------------------------------------------------------ serveri

describe('Krahasimi vizual në dashboard', () => {
  let server: http.Server;
  let base = '';
  const files = () => fs.readdirSync(out).filter((f) => f.endsWith('.json'));
  const nameOf = (k: string) => files()[Object.keys(R).indexOf(k)]!;
  const get = async (p: string) => {
    const res = await fetch(base + p);
    return { status: res.status, csp: res.headers.get('content-security-policy') ?? '', body: await res.text() };
  };
  beforeAll(async () => {
    const d = await startDashboard({ outputDir: out, port: 0 });
    server = d.server;
    base = d.url.replace(/\/$/, '');
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('lista e çifteve, statuset, CSP; imazhet vetëm nga /shot/visual; pa "përmirësim/përkeqësim"', async () => {
    const r = await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('B')}`);
    expect(r.status).toBe(200);
    expect(r.csp).toContain("script-src 'none'");
    expect(r.body).toContain('5 çifte');
    expect(r.body).toContain('krahasim i plotë');
    expect(r.body).toContain('s&#39;krahasohet');
    expect(r.body).toContain("s'hyn në Health Score");
    for (const m of r.body.matchAll(/<img [^>]*src="([^"]+)"/g)) expect(m[1]).toMatch(/^\/shot\/visual\//);
    expect(r.body).not.toMatch(/u përmirësua|u përkeqësua/);
  });

  it('çifti i zgjedhur: tabela e verifikimit, ndryshimi i matur, krah-për-krah dhe mbivendosja', async () => {
    const r = await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('B')}&page=${encodeURIComponent('https://e.com/')}&device=mobile`);
    expect(r.body).toContain('Verifikimi para krahasimit');
    expect(r.body).toContain('Ndryshimi i matur i pikselëve');
    expect(r.body).toMatch(/<strong>3\d\.\d%<\/strong> e pikselëve kanë diferencë <strong>mbi tolerancën 40\/255<\/strong>/);
    expect(r.body).toContain('<strong>E zeza</strong> do të thotë');
    expect(r.body).toContain('A origjinale</a>');
    expect(r.body).not.toContain('matje orientuese');
    expect(r.body).toContain('Krah për krah');
    expect(r.body).toContain('<img class="top"');
    expect(r.body).toContain('pragje provizore');
  });

  it('raporti i vjetër del "me kufizime"; çifti i pakrahasueshëm s\'matet', async () => {
    const r = await get(`/compare/visual?a=${nameOf('OLD')}&b=${nameOf('A')}&page=${encodeURIComponent('https://e.com/')}&device=desktop`);
    expect(r.body).toContain('krahasim me kufizime');
    expect(r.body).toContain('raport i vjetër');
    expect(r.body).toContain('matje orientuese');
    expect(r.body).toContain('viewport-i i raportit A s');
    expect(r.body).toContain('0% do të thotë që asnjë piksel');
    const n = await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('B')}&page=${encodeURIComponent('https://e.com/contact/')}&device=desktop`);
    expect(n.body).toContain("S'u mat ndryshimi i pikselëve");
    expect(n.body).not.toContain('<img class="top"');
  });

  it('galeria shfaq viewport-in dhe përmasat e ruajtura për raportet e reja; "s\'është ruajtur" për të vjetrat', async () => {
    const n = await get(`/report/${nameOf('A')}/visual?shot=0`);
    expect(n.body).toContain('40 × 30 px');
    expect(n.body).toContain('Përmasat e skedarit</dt><dd>40 × 60 px');
    const o = await get(`/report/${nameOf('OLD')}/visual?shot=0`);
    expect(o.body).toContain("madhësia s'është ruajtur në këtë raport");
    expect(o.body).toContain('nxjerrë nga lartësia; prerja s&#39;është ruajtur');
  });

  it('krahasimi i raporteve tregon panelin vizual; emrat e pasigurt dhe i njëjti raport refuzohen', async () => {
    const c = await get(`/compare?a=${nameOf('A')}&b=${nameOf('B')}`);
    expect(c.body).toContain('Krahasimi vizual');
    expect(c.body).toContain('/compare/visual?a=');
    expect((await get(`/compare/visual?a=..%2F..%2Fsekret.json&b=${nameOf('B')}`)).status).toBe(404);
    expect((await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('A')}`)).status).toBe(400);
    const o = await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('OTHER')}`);
    expect(o.body).toContain('pamjet s&#39;krahasohen');
    // parametrat e panjohur të faqes/pajisjes injorohen (s'ka shteg skedari nga kërkesa)
    const u = await get(`/compare/visual?a=${nameOf('A')}&b=${nameOf('B')}&page=..%2F..%2Fx&device=desktop`);
    expect(u.status).toBe(200);
    expect(u.body).not.toContain('Verifikimi para krahasimit');
  });
});
