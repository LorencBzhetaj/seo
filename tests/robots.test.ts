import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../src/parse/robots.js';

describe('parseRobots / isAllowed', () => {
  const txt = [
    '# koment',
    'User-agent: *',
    'Disallow: /private',
    'Allow: /private/public',
    'Disallow: /*.pdf$',
    '',
    'User-agent: Googlebot',
    'User-agent: Bingbot',
    'Disallow: /',
    'Allow: /$',
    '',
    'User-agent: BadBot',
    'Disallow:',
    'Sitemap: https://example.com/sitemap.xml',
  ].join('\n');
  const r = parseRobots(txt);

  it('lexon grupet dhe sitemap-et', () => {
    expect(r.groups).toHaveLength(3);
    expect(r.groups[1]!.agents).toEqual(['googlebot', 'bingbot']);
    expect(r.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('rregulli më i gjatë fiton; Allow fiton në barazi', () => {
    expect(isAllowed(r, 'SomeBot', '/private/x').allowed).toBe(false);
    expect(isAllowed(r, 'SomeBot', '/private/public/x').allowed).toBe(true);
  });

  it('mbështet wildcard * dhe ankorim $', () => {
    expect(isAllowed(r, 'SomeBot', '/docs/file.pdf').allowed).toBe(false);
    expect(isAllowed(r, 'SomeBot', '/docs/file.pdf?x=1').allowed).toBe(true);
  });

  it('grupi specifik zëvendëson "*"; "Allow: /$" lejon vetëm faqen hyrëse', () => {
    const home = isAllowed(r, 'Mozilla/5.0 (compatible; Googlebot/2.1)', '/');
    expect(home.allowed).toBe(true);
    expect(home.matchedAgent).toBe('googlebot');
    const other = isAllowed(r, 'Googlebot', '/about');
    expect(other.allowed).toBe(false);
    expect(other.rule?.line).toBe(9);
  });

  it('"Disallow:" bosh lejon gjithçka', () => {
    expect(isAllowed(r, 'BadBot', '/private').allowed).toBe(true);
  });

  it('pa rregulla ose pa grup që përputhet → lejohet', () => {
    expect(isAllowed(parseRobots(''), 'x', '/').allowed).toBe(true);
    const d = isAllowed(parseRobots('User-agent: other\nDisallow: /'), 'mybot', '/');
    expect(d.allowed).toBe(true);
    expect(d.matchedAgent).toBeNull();
  });
});
