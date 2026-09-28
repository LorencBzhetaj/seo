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
