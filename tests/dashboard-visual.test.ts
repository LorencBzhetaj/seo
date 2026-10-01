import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlIssues } from '../src/dashboard/model.js';
import { startDashboard } from '../src/dashboard/server.js';
import { isShotRel, screenshotPath, type Obj } from '../src/dashboard/store.js';
import { galleryView, urlReportView, type Files } from '../src/dashboard/views.js';
import { gallery, signalShots, signalsForShot } from '../src/dashboard/visual.js';

// ------------------------------------------------------------ fixtures (si raportet reale të gjecaj.al, schema 4)

const DIR = 'visual/site-20261001-124538';
const cap = (url: string, viewport: string, file: string, o: Obj = {}) => ({ url, pageType: 'home', viewport, status: 'ok', screenshot: `${DIR}/${file}`, summary: { documentHeight: viewport === 'mobile' ? 7616 : 2400 }, ...o });
const signal = (code: string, url: string, module: string, evidence: Obj[], o: Obj = {}) => ({ code, scope: 'page', url, affectedPages: [url], severity: 'low', confidence: 0.6, message: `${code} mesazh`, whyItMatters: 'pse', fix: 'si', evidence, module, priority: 4, needsManualReview: true, ...o });

function report(o: Obj = {}): Obj {
  return {
    reportSchemaVersion: '4', ruleSetVersion: 'r', url: 'https://e.com/', finalUrl: 'https://e.com/', startedAt: '2026-10-01T12:44:16.950Z', completedAt: '2026-10-01T12:46:46.010Z', status: 'completed',
    health: { score: 77, status: 'GOOD', missingCategories: [] }, categories: { availability: 100 }, modules: [], issues: [], topImprovements: [],
    quality: {
      status: 'info', statuses: {}, groups: [],
      visual: {
        screenshotsDir: DIR, limits: { maxPages: 4, maxScreenshotHeight: 3000 },
        captures: [
          cap('https://e.com/', 'desktop', '1-home-desktop.jpg'),
          cap('https://e.com/', 'mobile', '1-home-mobile.jpg'),
          cap('https://e.com/contact/', 'desktop', '2-contact-desktop.jpg', { pageType: 'contact' }),
          cap('https://e.com/contact/', 'mobile', '2-contact-mobile.jpg', { pageType: 'contact' }),
          { url: 'https://e.com/rooms/', pageType: 'rooms', viewport: 'desktop', status: 'skipped', reason: 'HTTP 503 në browser — pamja s\'u analizua' },
        ],
      },
      issues: [
        // sinjal vizual me screenshot si provë (faqja dhe pajisja përputhen)
        signal('MOBILE_HORIZONTAL_OVERFLOW', 'https://e.com/', 'visual-identity', [{ type: 'dom', url: 'https://e.com/', detected: 'scrollWidth 412 > 390' }, { type: 'screenshot', url: 'https://e.com/', detected: 'screenshot', raw: `${DIR}/1-home-mobile.jpg` }]),
        // sinjal përmbajtjeje pa screenshot si provë
        signal('LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', 'https://e.com/contact/', 'content-quality', [{ type: 'dom', url: 'https://e.com/contact/', detected: '"Read more →"' }]),
        // faqe pa pamje të renderuar
        signal('TITLE_CONTENT_MISMATCH', 'https://e.com/book/', 'content-quality', [{ type: 'dom', url: 'https://e.com/book/', detected: 'titulli' }]),
        // screenshot i një faqeje tjetër si "provë" → s'vërtetohet
        signal('GRADIENT_HEAVY', 'https://e.com/', 'visual-identity', [{ type: 'screenshot', raw: `${DIR}/2-contact-desktop.jpg` }]),
        // screenshot që s'është te pamjet e raportit
        signal('PLACEHOLDER_IMAGE', 'https://e.com/', 'visual-identity', [{ type: 'screenshot', raw: `${DIR}/9-tjeter-desktop.jpg` }]),
        // shteg i pasigurt
        signal('UNIFORM_ICON_CARDS', 'https://e.com/', 'visual-identity', [{ type: 'screenshot', raw: '../../sekret-jashte.jpg' }]),
      ],
    },
    ...o,
  };
}

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let out: string;
let files: Files;
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(data));

beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-visual-'));
  fs.mkdirSync(path.join(out, DIR), { recursive: true });
  // 2-contact-mobile.jpg mungon me qëllim
  for (const f of ['1-home-desktop.jpg', '1-home-mobile.jpg', '2-contact-desktop.jpg']) fs.writeFileSync(path.join(out, DIR, f), JPG);
  fs.writeFileSync(path.join(path.dirname(out), 'sekret-jashte.jpg'), 'x');
  write('e.com-20261001-124416.json', report());
  write('e.com-20260920-100000.json', report({ reportSchemaVersion: '1', quality: undefined, completedAt: '2026-09-20T10:00:00.000Z' }));
  write('e.com-20260925-100000.json', report({ reportSchemaVersion: '3', quality: { status: 'skipped', reason: 'Renderimi u çaktivizua (--no-visual)' } }));
  write('source-folder-x-20261001-100000.json', { reportSchemaVersion: 'source-1', reportType: 'source-audit', source: { kind: 'folder', name: 'x' }, status: 'completed', findings: [], checks: [] });
  files = { shotExists: (rel) => !!screenshotPath(out, rel), lhrExists: () => false };
});
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

const stateOf = (rel: string) => (!isShotRel(rel) ? 'invalid' : files.shotExists(rel) ? 'ok' : 'missing');

// ------------------------------------------------------------ modeli

describe('Pamjet: galeria dhe lidhja sinjal → screenshot', () => {
  it('galeria: faqet, pajisjet, data e auditit, lartësia; skedari që mungon dhe pamja e pa-renderuar dallohen', () => {
    const g = gallery(report(), stateOf);
    expect(g.available).toBe(true);
    expect(g.auditDate).toBe('2026-10-01T12:46:46.010Z');
    expect(g.pages).toEqual(['https://e.com/', 'https://e.com/contact/', 'https://e.com/rooms/']);
    expect(g.devices).toEqual(['desktop', 'mobile']);
    expect(g.shots.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'missing', 'missing']);
    expect(g.shots[1]).toMatchObject({ device: 'mobile', documentHeight: 7616 });
    expect(g.shots[4]).toMatchObject({ status: 'skipped', screenshot: '' });
  });

  it('provë: vetëm kur shtegu i provës është pamje e së njëjtës faqe; pajisja merret nga pamja', () => {
    const g = gallery(report(), stateOf);
    const issues = urlIssues(report()).filter((i) => i.section === 'quality');
    const by = (code: string) => signalShots(issues.find((i) => i.code === code)!, g);

    const overflow = by('MOBILE_HORIZONTAL_OVERFLOW');
    expect(overflow.proof).toHaveLength(1);
    expect(overflow.proof[0]!.shot).toMatchObject({ url: 'https://e.com/', device: 'mobile', index: 1 });
    // kontekst: e njëjta faqe, pajisja tjetër; prova s'përsëritet si kontekst
    expect(overflow.context.map((s) => s.index)).toEqual([0]);

    const wrongPage = by('GRADIENT_HEAVY');
    expect(wrongPage.proof[0]!.shot).toBeUndefined();
    expect(wrongPage.proof[0]!.unverified).toMatch(/faqeje tjetër \(https:\/\/e\.com\/contact\/\)/);
    expect(wrongPage.context.map((s) => s.index)).toEqual([0, 1]);

    expect(by('PLACEHOLDER_IMAGE').proof[0]).toMatchObject({ state: 'missing', unverified: expect.stringMatching(/s'gjendet te pamjet/) });
    expect(by('UNIFORM_ICON_CARDS').proof[0]!.shot).toBeUndefined();

    const content = by('LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT');
    expect(content.proof).toEqual([]);
    expect(content.context.map((s) => [s.url, s.device])).toEqual([['https://e.com/contact/', 'desktop'], ['https://e.com/contact/', 'mobile']]);
    expect(by('TITLE_CONTENT_MISMATCH')).toMatchObject({ proof: [], context: [], pagesWithoutShots: ['https://e.com/book/'] });
  });

  it('përputhja është e saktë: URL me "/" ndryshe ose pa pamje → s\'lidhet', () => {
    const r = report();
    const q = r.quality as Obj;
    (q.issues as Obj[]).push(signal('X', 'https://e.com/contact', 'content-quality', [{ type: 'dom', detected: 'x' }]));
    const g = gallery(r, stateOf);
    const s = signalShots(urlIssues(r).find((i) => i.code === 'X')!, g);
    expect(s.context).toEqual([]);
    expect(s.pagesWithoutShots).toEqual(['https://e.com/contact']);
  });

  it('nga pamja te sinjalet: prova vs e njëjta faqe', () => {
    const r = report();
    const g = gallery(r, stateOf);
    const linked = signalsForShot(g.shots[1]!, urlIssues(r), g);
    expect(linked.proof.map((i) => i.code)).toEqual(['MOBILE_HORIZONTAL_OVERFLOW']);
    expect(linked.samePage.map((i) => i.code).sort()).toEqual(['GRADIENT_HEAVY', 'PLACEHOLDER_IMAGE', 'UNIFORM_ICON_CARDS']);
  });
});

// ------------------------------------------------------------ pamjet HTML

describe('Pamjet: raporti dhe galeria', () => {
  it('raporti: paneli i pamjeve, provë e sinjalit vs pamje për kontekst, mungesat të shprehura', () => {
    const out = urlReportView('e.com-20261001-124416.json', report(), {}, files);
    expect(out).toContain('id="pamjet"');
    expect(out).toContain('href="/report/e.com-20261001-124416.json/visual"');
    expect(out).toContain('Provë e sinjalit');
    expect(out).toContain('Pamje për kontekst');
    expect(out).toContain('jo provë e këtij sinjali');
    expect(out).toContain('Screenshot-i mungon lokalisht');
    expect(out).toContain('Shteg i pavlefshëm screenshot-i');
    expect(out).not.toContain('/shot/..');
    expect(out).toContain("S'ka screenshot për këtë faqe në këtë raport");
    expect(out).toContain("S'u renderua: HTTP 503");
    // sinjalet: të gjetshme, jashtë Health Score, pa etiketë "e krijuar nga AI"
    expect(out).toContain('href="#signals"');
    expect(out).toMatch(/Sinjalet e cilësisë \(6: 2 përmbajtje, 4 pamje\)/);
    expect(out).toContain('jashtë Health Score');
    expect(out).not.toMatch(/e krijuar nga AI|krijuar me AI|AI-generated/i);
    expect(out).toContain('<div class="score">77 <small>GOOD</small></div>');
  });

  it('galeria: filtra sipas faqes dhe pajisjes; pamja e madhe me metadatat; viewport pa e shpikur', () => {
    const name = 'e.com-20261001-124416.json';
    const all = galleryView(name, report(), {}, files);
    expect(all).toContain('5 pamje');
    expect(all.match(/<figure class="shot/g)).toHaveLength(5);
    const mobile = galleryView(name, report(), { device: 'mobile' }, files);
    expect(mobile).toContain('2 pamje (të filtruara)');
    const page = galleryView(name, report(), { page: 'https://e.com/contact/', device: 'desktop' }, files);
    expect(page.match(/<figure class="shot/g)).toHaveLength(1);
    // vlerë filtri e panjohur → injorohet
    expect(galleryView(name, report(), { device: 'tablet', page: 'https://evil/' }, files)).toContain('5 pamje');

    const one = galleryView(name, report(), { shot: '1', device: 'mobile' }, files);
    expect(one).toContain('id="pamja"');
    expect(one).toContain('<img src="/shot/visual/site-20261001-124538/1-home-mobile.jpg"');
    expect(one).toContain("madhësia s'është ruajtur në këtë raport");
    expect(one).toContain('7616 px');
    expect(one).toContain('Screenshot-i është prerë te 3000 px');
    expect(one).toContain('2026-10-01');
    expect(one).toMatch(/Sinjale ku kjo pamje është provë<\/h3>\s*<ul class="plain"><li>.*MOBILE_HORIZONTAL_OVERFLOW/s);
    expect(galleryView(name, report(), { shot: '99' }, files)).toContain("Pamja nr. 99 s'ekziston");
    expect(galleryView(name, report(), { shot: '3' }, files)).toContain('Screenshot-i mungon lokalisht');
  });

  it('raporte të vjetra: pa quality ose me quality të anashkaluar → pa galeri, me arsye, pa gabim', () => {
    const old = report({ reportSchemaVersion: '1', quality: undefined });
    const view = urlReportView('old.json', old, {}, files);
    expect(view).toContain('pa pamje të renderuara');
    expect(view).toContain('s&#39;ka seksionin e cilësisë');
    expect(view).not.toContain('<img');
    expect(galleryView('old.json', old, {}, files)).toContain('s&#39;ka seksionin e cilësisë/pamjes');
    const skipped = galleryView('s.json', report({ quality: { status: 'skipped', reason: 'Renderimi u çaktivizua (--no-visual)' } }), {}, files);
    expect(skipped).toContain('Renderimi u çaktivizua (--no-visual)');
    // quality pa visual (p.sh. --no-visual në schema 4)
    expect(galleryView('n.json', report({ quality: { status: 'info', statuses: { visualIdentity: { reason: 'Renderimi vizual u çaktivizua' } }, issues: [] } }), {}, files)).toContain('Renderimi vizual u çaktivizua');
  });
});

// ------------------------------------------------------------ serveri

describe('Pamjet: serveri (vetëm 127.0.0.1, vetëm output/)', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    ({ server, url: base } = await startDashboard({ outputDir: out, port: 0 }));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('galeria shërbehet me CSP pa skripte; imazhet vetëm përmes /shot/ brenda output/visual', async () => {
    const res = await fetch(`${base}report/e.com-20261001-124416.json/visual?device=mobile&shot=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
    const body = await res.text();
    const imgs = [...body.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]!);
    expect(imgs.length).toBeGreaterThan(0);
    for (const src of imgs) {
      expect(src).toMatch(/^\/shot\/visual\/site-20261001-124538\/[\w.-]+\.jpg$/);
      expect((await fetch(base + src.slice(1))).headers.get('content-type')).toBe('image/jpeg');
    }
  });

  it('refuzon shtigjet e pasigurta dhe raportet e pavlefshme', async () => {
    for (const p of ['report/..%2F..%2Fsekret.json/visual', 'report/e.com-20261001-124416.lhr.json/visual', 'report/s-ekziston.json/visual', 'shot/visual/..%2F..%2Fsekret-jashte.jpg', 'shot/..%2Fsekret-jashte.jpg', 'shot/visual/site-20261001-124538/2-contact-mobile.jpg']) {
      expect((await fetch(base + p)).status, p).toBe(404);
    }
    expect((await fetch(`${base}report/source-folder-x-20261001-100000.json/visual`)).status).toBe(404);
    expect((await fetch(`${base}report/e.com-20260920-100000.json/visual`)).status).toBe(200);
    expect(isShotRel('visual/a/b.jpg')).toBe(true);
    for (const bad of ['../x.jpg', 'visual/../x.jpg', 'visual/a/../b.jpg', 'visual/a/b.svg', 'visual/a/b/c.jpg', '/etc/x.jpg', 'visual\\a\\b.jpg']) expect(isShotRel(bad), bad).toBe(false);
  });
});
