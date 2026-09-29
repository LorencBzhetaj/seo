import { describe, expect, it } from 'vitest';
import { jaccard, removeBoilerplate, shingles, tokenize } from '../src/intelligence/similarity.js';
import { runDuplicates } from '../src/modules/site/duplicates.js';
import { htmlPage, siteCtx, words } from './site-helpers.js';

const B = 'https://e.com';
const codes = (r: ReturnType<typeof runDuplicates>) => r.issues.map((i) => i.code).sort();

describe('similarity', () => {
  it('Jaccard mbi shingle 5-fjalëshe', () => {
    const a = shingles(tokenize(words('a', 100)));
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles(tokenize(words('b', 100))))).toBe(0);
  });

  it('heq tekstin e përbashkët të template-it vetëm kur ka ≥ 4 faqe', () => {
    const common = tokenize(words('cta', 60));
    const sets = new Map(['p1', 'p2', 'p3', 'p4'].map((k) => [k, shingles([...common, ...tokenize(words(k, 60))])]));
    const cleaned = removeBoilerplate(sets);
    expect(jaccard(cleaned.get('p1')!, cleaned.get('p2')!)).toBe(0);
    // Me < 4 faqe s'dallohet dot template-i nga përmbajtja: s'hiqet asgjë
    const three = new Map([...sets].slice(0, 3));
    expect(removeBoilerplate(three)).toBe(three);
  });
});

describe('Dyfishime titujsh/përshkrimesh', () => {
  it('3 faqe të të njëjtit template me të njëjtin titull → një issue "template"; faqet unike s\'preken', () => {
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'Kreu', desc: 'd0' }) },
      ...[1, 2, 3].map((i) => ({ url: `${B}/p/${i}`, html: htmlPage({ title: 'Produkt | Dyqani', desc: `d${i}`, bodyClass: 'single-product' }) })),
      { url: `${B}/about`, html: htmlPage({ title: 'Rreth nesh', desc: 'd9' }) },
    ]));
    const dup = r.issues.filter((i) => i.code === 'DUPLICATE_TITLES');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ scope: 'template', severity: 'medium' });
    expect(dup[0]!.affectedPages).toEqual([`${B}/p/1`, `${B}/p/2`, `${B}/p/3`]);
    expect(dup[0]!.evidence[0]).toMatchObject({ url: `${B}/p/1`, detected: 'titull: "Produkt | Dyqani"' });
  });

  it('faqet me canonical drejt tjetrës ose noindex s\'numërohen si dyfishime titujsh', () => {
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'X' }) },
      { url: `${B}/a`, html: htmlPage({ title: 'Njëjtë' }) },
      { url: `${B}/a?print=1`, html: htmlPage({ title: 'Njëjtë', head: `<link rel="canonical" href="${B}/a">` }) },
      { url: `${B}/b`, html: htmlPage({ title: 'Njëjtë', head: '<meta name="robots" content="noindex">' }) },
    ]));
    expect(codes(r)).not.toContain('DUPLICATE_TITLES');
  });

  it('meta description e njëjtë → low', () => {
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'A', desc: 'Përshkrim i njëjtë' }) },
      { url: `${B}/b`, html: htmlPage({ title: 'B', desc: 'Përshkrim i njëjtë' }) },
    ]));
    expect(r.issues.find((i) => i.code === 'DUPLICATE_META_DESCRIPTIONS')!.severity).toBe('low');
  });
});

describe('Përmbajtje e ngjashme: sinjale konservative', () => {
  it('tekst i përbashkët template-i (CTA) me përmbajtje të ndryshme → asnjë dyfishim', () => {
    const cta = words('cta', 120);
    const r = runDuplicates(siteCtx(['/', '/a', '/b', '/c', '/d'].map((p, i) => ({
      url: `${B}${p}`, html: htmlPage({ title: `T${i}`, main: `<h1>T${i}</h1><p>${cta}</p><p>${words(`u${i}x`, 150)}</p>` }),
    }))));
    expect(codes(r).filter((c) => /CONTENT/.test(c))).toEqual([]);
  });

  it('ngjashmëri e lartë pa sinjale të tjera → SIMILAR_CONTENT_POSSIBLE, low, verifikim manual', () => {
    const base = words('lajm', 300);
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'Kreu', main: `<p>${words('kreu', 200)}</p>` }) },
      { url: `${B}/lajm-1`, html: htmlPage({ title: 'Lajmi 1', main: `<p>${base} fund1</p>` }) },
      { url: `${B}/lajm-2`, html: htmlPage({ title: 'Lajmi 2', main: `<p>${base} fund2</p>` }) },
    ]));
    const i = r.issues.find((x) => x.code === 'SIMILAR_CONTENT_POSSIBLE')!;
    expect(i).toMatchObject({ severity: 'low', confidence: 0.5, needsManualReview: true });
    expect(i.evidence[0]!.detected).toMatch(/hash i tekstit: ndryshon; titull: ndryshon; URL: të ndryshme/);
    // Pa dyfishim të provuar, mungesa e canonical s'penalizohet
    expect(codes(r)).not.toContain('DUPLICATES_WITHOUT_CONSISTENT_CANONICAL');
  });

  it('i njëjti tekst në /a dhe /a/ me të njëjtin titull → dyfishim i provuar; pa canonical → issue', () => {
    const same = htmlPage({ title: 'Oferta', main: `<h1>Oferta</h1><p>${words('oferta', 200)}</p>` });
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'Kreu', main: `<p>${words('kreu', 200)}</p>` }) },
      { url: `${B}/oferta`, html: same },
      { url: `${B}/oferta/`, html: same },
    ]));
    const proven = r.issues.find((i) => i.code === 'DUPLICATE_CONTENT_PROVEN')!;
    expect(proven).toMatchObject({ severity: 'medium', confidence: 0.9 });
    expect(proven.evidence[0]!.detected).toMatch(/hash i tekstit: i njëjtë; titull: i njëjtë; URL: variante/);
    const canon = r.issues.find((i) => i.code === 'DUPLICATES_WITHOUT_CONSISTENT_CANONICAL')!;
    expect(canon.evidence.map((e) => e.detected)).toEqual(['canonical: mungon', 'canonical: mungon']);
  });

  it('dyfishim i provuar me canonical të qëndrueshëm → pa issue canonical', () => {
    const same = htmlPage({ title: 'Oferta', head: `<link rel="canonical" href="${B}/oferta">`, main: `<p>${words('oferta', 200)}</p>` });
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'Kreu', main: `<p>${words('kreu', 200)}</p>` }) },
      { url: `${B}/oferta`, html: same },
      { url: `${B}/oferta/`, html: same },
    ]));
    expect(codes(r)).not.toContain('DUPLICATES_WITHOUT_CONSISTENT_CANONICAL');
    expect(r.checks.find((c) => c.id === 'canonical')!.observations!.join(' ')).toMatch(/canonical të qëndrueshëm/);
  });
});

describe('Canonical', () => {
  it('mungesa e canonical pa dyfishime → vetëm vërejtje, jo issue', () => {
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'A' }) },
      { url: `${B}/b`, html: htmlPage({ title: 'B' }) },
    ]));
    expect(r.issues).toEqual([]);
    expect(r.checks.find((c) => c.id === 'canonical')!.observations!.join(' ')).toMatch(/2 faqe pa canonical — s'llogaritet problem/);
  });

  it('canonical drejt URL-je që kthen 404 (e kontrolluar nga crawl-i) → CANONICAL_TARGET_NOT_INDEXABLE', () => {
    const r = runDuplicates(siteCtx([
      { url: `${B}/`, html: htmlPage({ title: 'A' }) },
      { url: `${B}/b`, html: htmlPage({ title: 'B', head: `<link rel="canonical" href="${B}/old">` }) },
      { url: `${B}/old`, status: 404 },
    ]));
    const i = r.issues.find((x) => x.code === 'CANONICAL_TARGET_NOT_INDEXABLE')!;
    expect(i.evidence[0]!.detected).toBe(`canonical → ${B}/old: HTTP 404`);
  });

  it('më pak se 2 faqe → score null me arsye', () => {
    const r = runDuplicates(siteCtx([{ url: `${B}/`, html: htmlPage({ title: 'A' }) }]));
    expect(r.score).toBeNull();
    expect(r.checks[0]!.reason).toMatch(/Duhen ≥ 2 faqe/);
  });
});
