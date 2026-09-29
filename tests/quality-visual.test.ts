import { describe, expect, it } from 'vitest';
import type { AuditContext } from '../src/core/context.js';
import { MVP1_MODULES, QUALITY_MODULES, runModules } from '../src/core/run.js';
import { runVisualIdentity } from '../src/modules/quality/quality.js';
import { analyzeVisual } from '../src/quality/visual.js';
import { computeHealth } from '../src/scoring/scorer.js';
import type { VisualCapture } from '../src/visual/capture.js';
import type { ProbeCardGroup, ProbeResult } from '../src/visual/probe.js';
import { lighthouseFixture, makeCtx } from './helpers.js';

const G = 'linear-gradient(135deg, rgb(106, 17, 203) 0%, rgb(37, 117, 252) 100%)';
function probe(o: Partial<ProbeResult> = {}): ProbeResult {
  return { viewport: { width: 1366, height: 900 }, scrollWidth: 1366, documentHeight: 2000, sections: [], cardGroups: [], gradients: [], images: [], fonts: ['Inter'], elementsScanned: 300, truncated: false, ...o };
}
const cap = (url: string, p: ProbeResult, viewport: 'desktop' | 'mobile' = 'desktop', pageType?: string): VisualCapture => ({ url, viewport, status: 'ok', probe: p, screenshot: `visual/t/${url.split('/').pop() || 'home'}-${viewport}.jpg`, pageType });
const iconGroup = (top: number): ProbeCardGroup => ({ selector: 'div.cards > div.card', count: 4, signature: 'div.card>svg,h3,p', width: 318, height: 161, hasIcon: true, hasHeading: true, hasImage: false, region: 'main', top });
const grad = (top: number, value = G) => ({ value, selector: 'section.grad', width: 1366, height: 260, top, region: 'main' as const, textClip: false });
const codes = (caps: VisualCapture[]) => analyzeVisual(caps).signals.map((s) => s.code);

describe('Identiteti vizual: vetëm me prova të mjaftueshme', () => {
  it('3 grupe kartash identike ikonë+titull+tekst (12 karta) → UNIFORM_ICON_CARDS (low, 0.35) me screenshot', () => {
    const s = analyzeVisual([cap('https://e.com/', probe({ cardGroups: [iconGroup(600), iconGroup(860), iconGroup(1120)] }))]).signals[0]!;
    expect(s).toMatchObject({ code: 'UNIFORM_ICON_CARDS', severity: 'low', confidence: 0.35, screenshots: ['visual/t/home-desktop.jpg'] });
    expect(s.whyItMatters).toMatch(/stil i qëllimshëm i markës/);
  });

  it('false positive: një grup kartash, ose karta me foto reale → s\'raportohet', () => {
    expect(codes([cap('https://e.com/', probe({ cardGroups: [iconGroup(600)] }))])).toEqual([]);
    const photo = [600, 860, 1120].map((t) => ({ ...iconGroup(t), hasImage: true }));
    expect(codes([cap('https://e.com/', probe({ cardGroups: photo }))])).toEqual([]);
  });

  it('i njëjti gradient në 3 seksione të mëdha → GRADIENT_HEAVY; një gradient i vetëm (hero) jo', () => {
    expect(codes([cap('https://e.com/', probe({ gradients: [grad(500), grad(800), grad(1100)] }))])).toEqual(['GRADIENT_HEAVY']);
    expect(codes([cap('https://e.com/', probe({ gradients: [grad(0)] }))])).toEqual([]);
    // tekst me gradient (logo/titull) s'numërohet si seksion
    expect(codes([cap('https://e.com/', probe({ gradients: [grad(0), { ...grad(10), textClip: true }, { ...grad(20), textClip: true }] }))])).toEqual([]);
  });

  it('mesazhi i gradientit: numrat përputhen me pozicionet (seksioni me karta mbi gradient numërohet si seksion me gradient)', () => {
    // si fixture-i: hero + 3 seksione gradient, i pari i klasifikuar "cards"
    const sections = [
      { kind: 'hero' as const, selector: 'section.hero', top: 60, height: 486, cards: 0 },
      { kind: 'cards' as const, selector: 'section.grad', top: 546, height: 257, cards: 4 },
      { kind: 'gradient' as const, selector: 'section.grad', top: 803, height: 258, cards: 0 },
      { kind: 'gradient' as const, selector: 'section.grad', top: 1061, height: 257, cards: 0 },
    ];
    const s = analyzeVisual([cap('https://e.com/', probe({ sections, gradients: [grad(546), grad(803), grad(1061)] }))]).signals[0]!;
    expect(s).toMatchObject({ code: 'GRADIENT_HEAVY', severity: 'low', confidence: 0.35 });
    expect(s.message).toBe('I njëjti gradient si sfond në 3 blloqe të mëdha të përmbajtjes; 3 nga 4 seksionet kryesore të faqes kanë sfond gradient — kërkon verifikim');
    expect(s.evidence).toContain('seksionet kryesore: hero → cards → gradient → gradient');
  });

  it('placeholder → medium 0.8; stock kërkon ≥ 2 imazhe dhe mbetet sinjal i dobët; foto vetjake jo', () => {
    const img = (src: string) => ({ src, width: 600, height: 400, naturalWidth: 1200, naturalHeight: 800, alt: 'x', region: 'main' as const, top: 900, background: false });
    const s = analyzeVisual([cap('https://e.com/', probe({ images: [img('https://e.com/img/placeholder-hero.png')] }))]).signals;
    expect(s[0]).toMatchObject({ code: 'PLACEHOLDER_IMAGE', severity: 'medium', confidence: 0.8 });
    expect(codes([cap('https://e.com/', probe({ images: [img('https://images.unsplash.com/photo-1')] }))])).toEqual([]);
    expect(codes([cap('https://e.com/', probe({ images: [img('https://images.unsplash.com/photo-1'), img('https://images.pexels.com/p/2.jpg')] }))])).toEqual(['STOCK_OR_DEMO_IMAGERY']);
    expect(codes([cap('https://e.com/', probe({ images: [img('https://e.com/wp-content/uploads/2026/09/theth-bujtina.jpg'), img('https://e.com/img/DSC_1234.jpg')] }))])).toEqual([]);
    // false positive: i njëjti skedar stock dy herë (img + background) = 1 imazh, s'mjafton
    const one = 'https://e.com/wp-content/uploads/img/shutterstock_2357286297_compressed.webp';
    expect(codes([cap('https://e.com/', probe({ images: [img(one), { ...img(one), background: true }] }))])).toEqual([]);
  });

  it('i njëjti hero në 3 faqe → REPEATED_HERO_IMAGE (madhësitë WordPress -300x200 bashkohen)', () => {
    const hero = (src: string) => [{ src, width: 1366, height: 500, naturalWidth: 2000, naturalHeight: 800, alt: '', region: 'main' as const, top: 80, background: true }];
    const caps = ['/', '/a/', '/b/'].map((p, i) => cap(`https://e.com${p}`, probe({ images: hero(`https://e.com/up/hero${i ? '-1366x500' : ''}.jpg`) })));
    const s = analyzeVisual(caps).signals.find((x) => x.code === 'REPEATED_HERO_IMAGE')!;
    expect(s.related).toEqual(['https://e.com/a/', 'https://e.com/b/']);
  });

  it('mobile: tejkalim horizontal mbi gjerësinë e konfiguruar (390), edhe kur innerWidth është zmadhuar', () => {
    const m = probe({ viewport: { width: 924, height: 844 }, scrollWidth: 924 });
    expect(analyzeVisual([cap('https://e.com/x', m, 'mobile')]).signals[0]).toMatchObject({ code: 'MOBILE_HORIZONTAL_OVERFLOW', severity: 'medium', confidence: 0.9, evidence: ['scrollWidth 924px > viewport 390px (mobile 390×844)'] });
    expect(codes([cap('https://e.com/x', probe({ viewport: { width: 390, height: 844 }, scrollWidth: 395 }), 'mobile')])).toEqual([]);
  });

  it('e njëjta renditje seksionesh në 3 faqe të llojeve të ndryshme → sinjal; faqe të të njëjtit lloj (blog) jo', () => {
    const sections = ['hero', 'cards', 'gradient'].map((kind, i) => ({ kind: kind as 'hero', selector: 's', top: i * 500, height: 400, cards: kind === 'cards' ? 3 : 0 }));
    const diff = ['home', 'contact', 'product'].map((t, i) => cap(`https://e.com/${i}`, probe({ sections }), 'desktop', t));
    expect(codes(diff)).toContain('IDENTICAL_SECTION_LAYOUT');
    const blog = [0, 1, 2].map((i) => cap(`https://e.com/blog/${i}`, probe({ sections }), 'desktop', 'blog-post'));
    expect(codes(blog)).not.toContain('IDENTICAL_SECTION_LAYOUT');
  });
});

describe('Moduli i identitetit vizual dhe Health Score', () => {
  const visualCtx = (captures: VisualCapture[]): AuditContext => ({
    ...makeCtx({ lighthouse: { status: 'ok', value: lighthouseFixture() } }),
    visual: { status: 'ok', value: { captures, screenshotsDir: 'visual/t', limits: { maxPages: 4, navigationTimeoutMs: 30000, delayMs: 500, maxScreenshotHeight: 3000 }, blockedRequests: [] } },
  });

  it('sinjale pa score (status info), screenshot-et si evidence; Health i pandryshuar', () => {
    const ctx = visualCtx([cap('https://example.com/', probe({ gradients: [grad(500), grad(800), grad(1100)] }))]);
    const r = runVisualIdentity(ctx);
    expect(r).toMatchObject({ section: 'quality', score: null, status: 'info' });
    const issue = r.issues[0]!;
    expect(issue.evidence.map((e) => e.type)).toEqual(['dom', 'screenshot']);
    expect(issue.evidence[1]).toMatchObject({ detected: 'screenshot: visual/t/home-desktop.jpg', raw: 'visual/t/home-desktop.jpg' });
    const base = runModules(ctx, MVP1_MODULES);
    const all = runModules(ctx, [...MVP1_MODULES, ...QUALITY_MODULES]);
    expect(computeHealth(all.filter((x) => x.section === 'homepage'), base.flatMap((x) => x.issues))).toEqual(computeHealth(base, base.flatMap((x) => x.issues)));
  });

  it('renderimi i pamundur → skipped me arsye; pamje të pjesshme → partial', () => {
    expect(runVisualIdentity({ ...makeCtx(), visual: { status: 'skipped', reason: 'Renderimi vizual u çaktivizua (--no-visual)' } })).toMatchObject({ status: 'skipped', score: null, reason: 'Renderimi vizual u çaktivizua (--no-visual)' });
    const partial = runVisualIdentity(visualCtx([cap('https://example.com/', probe()), { url: 'https://example.com/x', viewport: 'mobile', status: 'skipped', reason: 'S\'u renderua: timeout' }]));
    expect(partial).toMatchObject({ status: 'info', partial: true });
  });
});
