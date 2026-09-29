import { describe, expect, it } from 'vitest';
import { parseHtml, parseXRobotsTag } from '../src/parse/html.js';
import { fixture } from './helpers.js';

describe('parseHtml', () => {
  it('nxjerr title, description, H1, canonical (relative → absolute) dhe lang', () => {
    const p = parseHtml(fixture('good.html'), 'https://drita.example/');
    // <title> brenda <svg> injorohet
    expect(p.titles).toEqual(['Pastiçeri Drita — ëmbëlsira të freskëta në Tiranë']);
    expect(p.metaDescriptions[0]).toMatch(/^Pastiçeri Drita ofron/);
    expect(p.h1s).toEqual(['Ëmbëlsira të freskëta çdo ditë']);
    expect(p.canonicals).toHaveLength(1);
    expect(p.canonicals[0]!.resolved).toBe('https://drita.example/');
    expect(p.lang).toBe('sq');
    expect(p.mixedContent).toEqual([]);
    expect(p.robotsMeta).toEqual([]);
  });

  it('gjen probleme: dy tituj, noindex, canonical konfliktues, mixed content, formular http', () => {
    const p = parseHtml(fixture('problems.html'), 'https://example.com/');
    expect(p.titles).toEqual(['A', 'Titull i dytë']);
    expect(p.robotsMeta[0]).toMatchObject({ name: 'robots', content: 'noindex, follow' });
    expect(p.canonicals.map((c) => c.resolved)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(p.h1s).toHaveLength(2);
    expect(p.mixedContent.filter((m) => m.active).map((m) => m.url)).toEqual([
      'http://cdn.example.net/lib.js',
      'http://cdn.example.net/site.css',
    ]);
    expect(p.mixedContent.filter((m) => !m.active).map((m) => m.url)).toEqual(['http://img.example.net/hero.jpg']);
    expect(p.forms).toEqual({ count: 1, postCount: 0, hasPasswordInput: true, insecureActions: ['http://example.com/login'] });
    expect(p.lang).toBeUndefined();
  });

  it('nuk raporton mixed content kur faqja vetë është http', () => {
    expect(parseHtml(fixture('problems.html'), 'http://example.com/').mixedContent).toEqual([]);
  });

  it('respekton <base href> për canonical relativ', () => {
    const p = parseHtml('<head><base href="https://cdn.example.org/sub/"><link rel="canonical" href="page"></head>', 'https://example.com/');
    expect(p.canonicals[0]!.resolved).toBe('https://cdn.example.org/sub/page');
  });

  it('shkurton snippet-et e evidence', () => {
    const long = `<title>${'x'.repeat(1000)}</title>`;
    expect(parseHtml(long, 'https://e.com/').titleSnippet!.length).toBeLessThanOrEqual(301);
  });
});

describe('parseXRobotsTag', () => {
  it('direktiva të përgjithshme dhe për googlebot; injoron bot-ë të tjerë', () => {
    expect(parseXRobotsTag('noindex, nofollow')).toEqual(['noindex', 'nofollow']);
    expect(parseXRobotsTag('googlebot: noindex')).toEqual(['noindex']);
    expect(parseXRobotsTag('otherbot: noindex')).toEqual([]);
    expect(parseXRobotsTag(undefined)).toEqual([]);
  });
});

describe('parsePage: teksti kryesor', () => {
  it('<article> bosh (p.sh. Divi) s\'e fsheh përmbajtjen jashtë tij; iframe regjistrohet', async () => {
    const { parsePage } = await import('../src/parse/page.js');
    const body = Array.from({ length: 120 }, (_, i) => `fjala${i}`).join(' ');
    const html = `<html><body><header>Menu kryesore</header><article></article><div class="et_pb_section"><p>${body}</p></div><iframe src="https://menu.example.com?embed=1"></iframe><footer>Footer</footer></body></html>`;
    const p = parsePage(html, 'https://e.com/menu/');
    expect(p.wordCount).toBe(120);
    expect(p.iframes).toEqual(['https://menu.example.com?embed=1']);
  });

  it('<main> përdoret kur mban pjesën kryesore të tekstit', async () => {
    const { parsePage } = await import('../src/parse/page.js');
    const main = Array.from({ length: 200 }, (_, i) => `m${i}`).join(' ');
    const p = parsePage(`<html><body><div>jashtë main disa fjalë</div><main><p>${main}</p></main></body></html>`, 'https://e.com/');
    expect(p.wordCount).toBe(200);
    expect(p.mainText.startsWith('m0 m1')).toBe(true);
  });
});

describe('parsePage: Cloudflare Email Address Obfuscation', () => {
  it('/cdn-cgi/l/email-protection#<hex> s\'është link faqeje (provë reale nga gjecaj.al)', async () => {
    const fs = await import('node:fs');
    const { parsePage } = await import('../src/parse/page.js');
    const html = fs.readFileSync(new URL('./fixtures/cf-email-protection.html', import.meta.url), 'utf8');
    const p = parsePage(html, 'https://gjecaj.al/');
    expect(p.links.map((l) => l.url)).toEqual(['https://gjecaj.al/contact/']);
    expect(p.cfEmailLinks).toEqual({ count: 3, decoderScript: true, sample: '/cdn-cgi/l/email-protection#95fcfbf3fad5f2fff0f6f4ffbbf4f9' });
  });

  it('dekodimi XOR; të dhëna që s\'dekodohen në email mbeten link i zakonshëm', async () => {
    const { decodeCfEmail, parsePage } = await import('../src/parse/page.js');
    expect(decodeCfEmail('95fcfbf3fad5f2fff0f6f4ffbbf4f9')).toBe('info@gjecaj.al');
    expect(decodeCfEmail('zz')).toBeNull();
    expect(decodeCfEmail('0102')).toBeNull();
    const p = parsePage('<html><body><a href="/cdn-cgi/l/email-protection">x</a><a href="/cdn-cgi/l/email-protection#abcd">y</a></body></html>', 'https://e.com/');
    expect(p.links.map((l) => l.url)).toEqual(['https://e.com/cdn-cgi/l/email-protection', 'https://e.com/cdn-cgi/l/email-protection']);
    expect(p.cfEmailLinks.count).toBe(0);
  });
});
