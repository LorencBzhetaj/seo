import { describe, expect, it } from 'vitest';
import { runCaching } from '../src/modules/site/caching.js';
import { runI18n } from '../src/modules/site/i18n.js';
import { runOnPage } from '../src/modules/site/onpage.js';
import { htmlPage, siteCtx, words } from './site-helpers.js';

const B = 'https://e.com';
const home = { url: `${B}/`, html: htmlPage({ title: undefined, main: '<p>kreu pa titull — e vlerëson MVP-1</p>' }) };

describe('SEO on-page (faqet e tjera)', () => {
  it('bashkon të njëjtin problem sipas template-it; faqja hyrëse s\'përfshihet', () => {
    const product = (i: number) => ({ url: `${B}/p/${i}`, html: htmlPage({ title: `Produkti ${i} — Dyqani`, bodyClass: `single-product postid-${i}`, main: `<h1>P${i}</h1><p>${words(`p${i}`, 150)}</p>` }) });
    const r = runOnPage(siteCtx([home, product(1), product(2), product(3), { url: `${B}/about`, html: htmlPage({ title: 'Rreth nesh — Dyqani', main: `<h1>Rreth</h1><p>${words('r', 150)}</p>` }) }]));
    const desc = r.issues.filter((i) => i.code === 'MISSING_META_DESCRIPTION');
    expect(desc).toHaveLength(2);
    const tpl = desc.find((i) => i.scope === 'template')!;
    expect(tpl.affectedPages).toEqual([`${B}/p/1`, `${B}/p/2`, `${B}/p/3`]);
    expect(tpl.message).toMatch(/^3 faqe pa meta description — i njëjti template \(single-product\)/);
    expect(desc.find((i) => i.scope === 'page')!.affectedPages).toEqual([`${B}/about`]);
    // Faqja hyrëse pa <title> s'raportohet këtu (e mbulon MVP-1)
    expect(r.issues.some((i) => i.code === 'MISSING_TITLE')).toBe(false);
  });

  it('alt="" (dekorativ) s\'numërohet; mungesa e atributit po; kërcim H2→H4; thin content me verifikim manual', () => {
    const r = runOnPage(siteCtx([home, {
      url: `${B}/galeria`,
      html: htmlPage({ title: 'Galeria — Vila', desc: 'Foto', main: '<h1>Galeria</h1><h2>Dhomat</h2><h4>Detaje</h4><img src="/a.jpg" alt=""><img src="/b.jpg"><p>pak tekst</p>' }),
    }]));
    const alt = r.issues.find((i) => i.code === 'IMAGES_MISSING_ALT')!;
    expect(alt.evidence[0]!.detected).toMatch(/^1\/2 imazhe pa alt, p\.sh\. <img src="\/b\.jpg">/);
    expect(r.issues.find((i) => i.code === 'HEADING_LEVEL_SKIP')!.evidence[0]!.detected).toBe('H2 → H4 ("Detaje")');
    const thin = r.issues.find((i) => i.code === 'THIN_CONTENT_POSSIBLE')!;
    expect(thin).toMatchObject({ confidence: 0.5, needsManualReview: true, severity: 'low' });
  });

  it('faqe me përmbajtje në iframe: H1/teksti vlejnë vetëm për HTML-në prind, me confidence më të ulët', () => {
    const r = runOnPage(siteCtx([
      home,
      { url: `${B}/restaurant/menu/`, html: htmlPage({ title: 'Menu — Restoranti', desc: 'Menuja', main: '<p>Menuja jonë</p><iframe src="https://menu.example.com?embed=1"></iframe>' }) },
      { url: `${B}/a`, html: htmlPage({ title: 'Faqja A — Sit', desc: 'A', main: `<p>${words('a', 150)}</p>` }) },
    ]));
    const h1 = r.issues.filter((i) => i.code === 'MISSING_H1');
    expect(h1).toHaveLength(2);
    const iframe = h1.find((i) => i.url === `${B}/restaurant/menu/`)!;
    expect(iframe).toMatchObject({ confidence: 0.6, needsManualReview: true });
    expect(iframe.message).toBe('1 faqe pa H1 në HTML-në prind — përmbajtja kryesore është në iframe');
    expect(iframe.evidence[0]!.detected).toContain("iframe: https://menu.example.com?embed=1 (përmbajtja e iframe-it s'u kontrollua)");
    expect(h1.find((i) => i.url === `${B}/a`)!.confidence).toBe(0.85);
    const thin = r.issues.find((i) => i.code === 'THIN_CONTENT_POSSIBLE' && i.affectedPages.includes(`${B}/restaurant/menu/`))!;
    expect(thin.evidence.find((e) => e.url.endsWith('/menu/'))!.detected).toMatch(/numërimi vlen vetëm për HTML-në e faqes prind — përmbajtja kryesore duket në iframe/);
  });

  it('faqet noindex përjashtohen; pa faqe të indeksueshme përtej hyrëses → score null', () => {
    const r = runOnPage(siteCtx([home, { url: `${B}/falemnderit`, html: htmlPage({ title: 'x', head: '<meta name="robots" content="noindex">' }) }]));
    expect(r.score).toBeNull();
    expect(r.checks[0]!.reason).toMatch(/Asnjë faqe e indeksueshme përtej hyrëses/);
    expect(r.limitations.join(' ')).toMatch(/1 faqe me noindex u përjashtuan/);
  });
});

describe('Compression/caching', () => {
  const big = (url: string, headers: Record<string, string>) => ({ url, html: htmlPage({ title: 'T', main: `<p>${words('x', 400)}</p>` }), headers: { 'content-type': 'text/html', ...headers } });

  it('HTML i pakompresuar në të gjitha faqet → një issue site-wide me madhësinë si provë', () => {
    const other = { ...big(`${B}/b`, {}), html: htmlPage({ title: 'B', bodyClass: 'single-post', main: `<p>${words('y', 400)}</p>` }) };
    const r = runCaching(siteCtx([big(`${B}/`, {}), big(`${B}/a`, { 'cache-control': 'no-cache' }), other]));
    // Edhe me dy template: një issue i vetëm (konfigurim serveri), jo një për template
    expect(r.issues.filter((x) => x.code === 'HTML_NOT_COMPRESSED')).toHaveLength(1);
    const i = r.issues.find((x) => x.code === 'HTML_NOT_COMPRESSED')!;
    expect(i.scope).toBe('site');
    expect(i.message).toBe('Të gjitha 3 dokumentet HTML të kontrolluara shërbehen pa compression (konfigurim serveri)');
    expect(i.affectedPages).toHaveLength(3);
    expect(i.evidence[0]!.detected).toMatch(/^Content-Encoding mungon; \d+ KB HTML$/);
    // Cache-Control s'gjykohet pa kontekst
    expect(r.issues.map((x) => x.code)).toEqual(['HTML_NOT_COMPRESSED']);
    expect(r.checks.find((c) => c.id === 'html-cache-headers')!.observations![0]).toMatch(/^Cache-Control: (2× mungon, 1× no-cache)$/);
  });

  it('HTML i kompresuar → pa issue', () => {
    const r = runCaching(siteCtx([big(`${B}/`, { 'content-encoding': 'br' }), big(`${B}/a`, { 'content-encoding': 'gzip' })]));
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('dokumente të vogla → not_applicable, score null', () => {
    const r = runCaching(siteCtx([{ url: `${B}/`, html: '<html><body>ok</body></html>', headers: { 'content-type': 'text/html' } }]));
    expect(r).toMatchObject({ score: null, status: 'not_applicable' });
  });
});

describe('i18n (vetëm kur aplikohet)', () => {
  it('site njëgjuhësh → not_applicable, score null', () => {
    const r = runI18n(siteCtx([home, { url: `${B}/a`, html: htmlPage({ title: 'A' }) }]));
    expect(r).toMatchObject({ score: null, status: 'not_applicable' });
    expect(r.checks[0]!.reason).toMatch(/njëgjuhësh/);
  });

  it('dy gjuhë pa hreflang → sinjal me confidence të ulët', () => {
    const r = runI18n(siteCtx([home, { url: `${B}/en/`, html: htmlPage({ title: 'EN', lang: 'en' }) }]));
    expect(r.issues[0]).toMatchObject({ code: 'MULTILINGUAL_WITHOUT_HREFLANG', confidence: 0.6, needsManualReview: true });
  });

  it('hreflang pa lidhje kthyese, kod i pavlefshëm, gjuhë që s\'përputhet, pa self-reference', () => {
    const sq = { url: `${B}/`, html: htmlPage({ title: 'SQ', head: `<link rel="alternate" hreflang="en" href="${B}/en/"><link rel="alternate" hreflang="english" href="${B}/en/">` }) };
    const en = { url: `${B}/en/`, html: htmlPage({ title: 'EN', lang: 'de', head: `<link rel="alternate" hreflang="en" href="${B}/en/">` }) };
    const r = runI18n(siteCtx([sq, en]));
    const codes = r.issues.map((i) => i.code).sort();
    expect(codes).toEqual(['HREFLANG_INVALID_CODE', 'HREFLANG_LANG_MISMATCH', 'HREFLANG_NOT_RECIPROCAL', 'HREFLANG_NO_SELF_REFERENCE']);
    expect(r.issues.find((i) => i.code === 'HREFLANG_NOT_RECIPROCAL')!.evidence[0]!.detected).toMatch(/s'lidh mbrapsht te https:\/\/e\.com\//);
    expect(r.issues.find((i) => i.code === 'HREFLANG_LANG_MISMATCH')!.evidence[0]!.detected).toMatch(/hreflang="en".*<html lang="de">/);
  });

  it('hreflang i saktë dhe reciprok → pa issue', () => {
    const tags = `<link rel="alternate" hreflang="sq" href="${B}/"><link rel="alternate" hreflang="en" href="${B}/en/"><link rel="alternate" hreflang="x-default" href="${B}/">`;
    const r = runI18n(siteCtx([{ url: `${B}/`, html: htmlPage({ title: 'SQ', head: tags }) }, { url: `${B}/en/`, html: htmlPage({ title: 'EN', lang: 'en', head: tags }) }]));
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
  });
});
