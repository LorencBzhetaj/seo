import { VIEWPORTS, type VisualCapture } from '../visual/capture.js';
import { NOT_AUTHORSHIP, signal, type QualitySignal } from './signals.js';

export interface VisualAnalysis {
  signals: QualitySignal[];
  observations: string[];
}

const PLACEHOLDER = /(placehold\.co|placeholder\.com|via\.placeholder|placekitten|picsum\.photos|dummyimage\.com|placeimg|fakeimg|lorempixel)|[/_-](placeholder|dummy|lorem-?ipsum|sample-image|default-image|no-image)[._-]/i;
const STOCK = /(images\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|shutterstock|istockphoto|gettyimages|stock\.adobe|freepik|depositphotos|dreamstime|123rf)|[/_-](stock|shutterstock|istock|adobestock|depositphotos|pexels|unsplash|pixabay)[-_./]/i;
const THEME_DEMO = /\/(themes|plugins)\/[^/]+\/(demo|images\/demo|assets\/demo|sample)/i;

const shortSrc = (u: string) => (u.length > 110 ? `${u.slice(0, 109)}…` : u);
const imgKey = (u: string) => u.split('?')[0]!.replace(/-\d+x\d+(?=\.\w+$)/, ''); // WordPress: foto-300x200.jpg → foto.jpg

/**
 * Analiza e pamjes nga faqet e renderuara. Rregullat kërkojnë prova të mjaftueshme: një gradient,
 * një grup kartash apo një shabllon i zakonshëm më vete s'është problem; shënohet edhe mundësia e
 * stilit të qëllimshëm të markës. Gjykimet subjektive: rëndësi e ulët + verifikim manual.
 */
export function analyzeVisual(captures: VisualCapture[]): VisualAnalysis {
  const signals: QualitySignal[] = [];
  const ok = captures.filter((c) => c.status === 'ok' && c.probe);
  const observations: string[] = [
    `${ok.length}/${captures.length} pamje u renderuan (desktop + mobile)`,
    ...captures.filter((c) => c.status === 'skipped').map((c) => `skipped ${c.viewport} ${c.url}: ${c.reason}`),
  ];
  if (!ok.length) return { signals, observations };
  const desktop = ok.filter((c) => c.viewport === 'desktop');
  const shots = (url: string) => ok.filter((c) => c.url === url && c.screenshot).map((c) => c.screenshot!);

  // --- 1. Mobile: tejkalim horizontal (defekt i matshëm, jo gjykim estetik) ---
  for (const c of ok.filter((x) => x.viewport === 'mobile')) {
    // Gjerësia e konfiguruar (390px): në emulim mobile innerWidth zmadhohet bashkë me përmbajtjen.
    const width = VIEWPORTS.mobile.width;
    const over = c.probe!.scrollWidth - width;
    if (over > 8) {
      signals.push(signal({
        code: 'MOBILE_HORIZONTAL_OVERFLOW', kind: 'visual', severity: 'medium', confidence: 0.9,
        message: `Në mobile faqja del ${over}px jashtë ekranit horizontalisht`,
        target: c.url, evidence: [`scrollWidth ${c.probe!.scrollWidth}px > viewport ${width}px (mobile 390×844)`],
        whyItMatters: 'Lëvizja anash në telefon e bën faqen të duket e prishur dhe e vështirëson leximin.',
        suggestion: 'Gjej elementin më të gjerë (DevTools → mobile) dhe kufizoje me max-width: 100% / overflow-wrap.',
        screenshots: c.screenshot ? [c.screenshot] : [],
      }));
    }
  }

  // --- 2. Imazhe placeholder (qartë të papërfunduara) dhe stock/demo (vetëm sinjal) ---
  for (const c of desktop) {
    const main = c.probe!.images.filter((i) => i.region === 'main');
    const placeholders = main.filter((i) => PLACEHOLDER.test(i.src));
    if (placeholders.length) {
      signals.push(signal({
        code: 'PLACEHOLDER_IMAGE', kind: 'visual', severity: 'medium', confidence: 0.8,
        message: `${placeholders.length} imazh(e) placeholder në përmbajtje`,
        target: c.url, evidence: placeholders.slice(0, 4).map((i) => `${shortSrc(i.src)} (${i.width}×${i.height})`),
        whyItMatters: 'Imazhet placeholder tregojnë faqe të papërfunduar dhe ulin besimin menjëherë.',
        suggestion: 'Zëvendësoji me foto reale të vendit, produktit ose ekipit.',
        screenshots: shots(c.url),
      }));
    }
    // I njëjti skedar (img + background, ose madhësi WordPress) numërohet një herë.
    const stock = [...new Map(main.filter((i) => !PLACEHOLDER.test(i.src) && (STOCK.test(i.src) || THEME_DEMO.test(i.src))).map((i) => [imgKey(i.src), i])).values()];
    if (stock.length >= 2) {
      signals.push(signal({
        code: 'STOCK_OR_DEMO_IMAGERY', kind: 'visual', severity: 'low', confidence: 0.4,
        message: `${stock.length} imazhe nga banka fotosh/demo e temës në përmbajtje — kërkon verifikim`,
        target: c.url, evidence: stock.slice(0, 4).map((i) => shortSrc(i.src)),
        whyItMatters: `Fotot e përgjithshme (stock/demo) përdoren nga shumë site dhe s'tregojnë vendin/produktin real. ${NOT_AUTHORSHIP}`,
        suggestion: 'Kur është e mundur, përdor foto origjinale; mbaji stock vetëm për ilustrime dytësore.',
        screenshots: shots(c.url),
      }));
    }
  }

  // --- 3. I njëjti imazh kryesor (hero) në shumë faqe të ndryshme ---
  const heroBy = new Map<string, string[]>();
  for (const c of desktop) {
    const big = c.probe!.images.filter((i) => i.region === 'main' && i.top < c.probe!.viewport.height * 1.2).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (big && big.width * big.height >= c.probe!.viewport.width * 250) heroBy.set(imgKey(big.src), [...(heroBy.get(imgKey(big.src)) ?? []), c.url]);
  }
  for (const [src, urls] of heroBy) {
    if (urls.length < 3) continue;
    signals.push(signal({
      code: 'REPEATED_HERO_IMAGE', kind: 'visual', severity: 'low', confidence: 0.5,
      message: `I njëjti imazh kryesor në krye të ${urls.length} faqeve të ndryshme — kërkon verifikim`,
      target: urls[0]!, related: urls.slice(1), evidence: [shortSrc(src)],
      whyItMatters: 'Kur çdo faqe hapet me të njëjtën pamje, vizitori e ka të vështirë t\'i dallojë dhe faqet duken shabllon.',
      suggestion: 'Jepi faqeve kryesore imazhe që tregojnë temën e tyre (dhoma, menu, kontakt…).',
      screenshots: urls.flatMap(shots).filter((s) => s.includes('desktop')),
    }));
  }

  // --- 4. Karta uniforme të përdorura dendur (ikonë + titull + tekst, e njëjta strukturë) ---
  const cardPages: string[] = [];
  for (const c of desktop) {
    const groups = c.probe!.cardGroups.filter((g) => g.region === 'main');
    const iconCards = groups.filter((g) => g.hasIcon && g.hasHeading && !g.hasImage);
    const sameSig = new Map<string, number>();
    for (const g of iconCards) sameSig.set(g.signature, (sameSig.get(g.signature) ?? 0) + g.count);
    const [sig, cards] = [...sameSig].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const groupsWithSig = iconCards.filter((g) => g.signature === sig).length;
    if (groupsWithSig >= 3 && cards >= 9) {
      cardPages.push(c.url);
      signals.push(signal({
        code: 'UNIFORM_ICON_CARDS', kind: 'visual', severity: 'low', confidence: 0.35,
        message: `${groupsWithSig} grupe kartash identike (ikonë + titull + tekst, ${cards} karta) në një faqe — kërkon verifikim`,
        target: c.url,
        evidence: iconCards.filter((g) => g.signature === sig).slice(0, 4).map((g) => `${g.selector}: ${g.count} karta ${g.width}×${g.height}px (y=${g.top})`),
        whyItMatters: `Seksione të njëpasnjëshme me të njëjtën kartë ikonë+titull+tekst janë modeli më i zakonshëm i shablloneve dhe mund ta bëjnë faqen të duket e përgjithshme. Mund të jetë edhe stil i qëllimshëm i markës. ${NOT_AUTHORSHIP}`,
        suggestion: 'Ndërro formatin e disa seksioneve (foto reale, citate, tabelë, hartë) dhe shto detaje specifike në karta.',
        screenshots: shots(c.url),
      }));
    }
  }

  // --- 5. Gradientë: vetëm përdorim i dendur (≥ 3 seksione të mëdha me të njëjtin gradient, ose ≥ 50% e seksioneve) ---
  for (const c of desktop) {
    const big = c.probe!.gradients.filter((g) => !g.textClip && g.region === 'main');
    const by = new Map<string, number>();
    for (const g of big) by.set(g.value, (by.get(g.value) ?? 0) + 1);
    const [value, n] = [...by].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    // Seksion "me gradient" = seksion kryesor ku fillon një nga gradientët e mëdhenj (sipas pozicionit, jo sipas
    // klasifikimit të seksionit: një seksion me karta mbi gradient klasifikohet "cards").
    const sections = c.probe!.sections;
    const covered = sections.filter((s) => big.some((g) => g.top >= s.top - 2 && g.top < s.top + s.height)).length;
    const textGradients = c.probe!.gradients.filter((g) => g.textClip).length;
    if (n >= 3 || (sections.length >= 4 && covered / sections.length >= 0.5)) {
      const share = sections.length ? `; ${covered} nga ${sections.length} seksionet kryesore të faqes kanë sfond gradient` : '';
      signals.push(signal({
        code: 'GRADIENT_HEAVY', kind: 'visual', severity: 'low', confidence: 0.35,
        message: n >= 3
          ? `I njëjti gradient si sfond në ${n} blloqe të mëdha të përmbajtjes${share} — kërkon verifikim`
          : `${covered} nga ${sections.length} seksionet kryesore të faqes kanë sfond gradient — kërkon verifikim`,
        target: c.url,
        evidence: [`gradienti më i shpeshtë (${n}× si sfond): ${value.slice(0, 120)}`, ...big.filter((g) => g.value === value).slice(0, 3).map((g) => `${g.selector} ${g.width}×${g.height}px (y=${g.top})`), `seksionet kryesore: ${sections.map((s) => s.kind).join(' → ') || 'pa të dhëna'}`, ...(textGradients ? [`${textGradients} tekste me gradient (s'numërohen)`] : [])],
        whyItMatters: `Gradientë të njëjtë në çdo seksion janë tipar i shumë shablloneve dhe i heqin faqes kontrast/hierarki. Një gradient i vetëm ose stil i qëllimshëm i markës s'është problem. ${NOT_AUTHORSHIP}`,
        suggestion: 'Mbaje gradientin për 1–2 momente kryesore (hero, CTA) dhe përdor sfonde të thjeshta/foto për pjesën tjetër.',
        screenshots: shots(c.url),
      }));
    }
  }

  // --- 6. E njëjta renditje seksionesh në faqe të llojeve të ndryshme ---
  const seq = desktop.map((c) => ({ c, s: c.probe!.sections.map((x) => x.kind).join(' → ') })).filter((x) => x.c.probe!.sections.length >= 3);
  const bySeq = new Map<string, typeof seq>();
  for (const x of seq) bySeq.set(x.s, [...(bySeq.get(x.s) ?? []), x]);
  for (const [s, xs] of bySeq) {
    const types = new Set(xs.map((x) => x.c.pageType ?? 'unknown'));
    if (xs.length < 3 || types.size < 3 || !/cards|gradient/.test(s)) continue;
    signals.push(signal({
      code: 'IDENTICAL_SECTION_LAYOUT', kind: 'visual', severity: 'low', confidence: 0.35,
      message: `${xs.length} faqe të llojeve të ndryshme kanë të njëjtën renditje seksionesh — kërkon verifikim`,
      target: xs[0]!.c.url, related: xs.slice(1).map((x) => x.c.url), evidence: [`renditja: ${s}`, `llojet: ${[...types].join(', ')}`],
      whyItMatters: `Kur kontakti, produkti dhe faqja hyrëse kanë të njëjtën strukturë, faqet duken të gjeneruara nga i njëjti shabllon pa përshtatje. ${NOT_AUTHORSHIP}`,
      suggestion: 'Përshtate strukturën me qëllimin e secilës faqe (p.sh. kontakti: hartë + orar; produkti: foto + çmim).',
      screenshots: xs.flatMap((x) => shots(x.c.url)).filter((p) => p.includes('desktop')),
    }));
  }

  const fonts = [...new Set(desktop.flatMap((c) => c.probe!.fonts))];
  observations.push(
    `Grupe kartash në përmbajtje (desktop): ${desktop.map((c) => c.probe!.cardGroups.filter((g) => g.region === 'main').length).join(', ')}; faqe me karta uniforme të dendura: ${cardPages.length}`,
    `Gradientë të mëdhenj në përmbajtje (desktop): ${desktop.map((c) => c.probe!.gradients.filter((g) => !g.textClip && g.region === 'main').length).join(', ')}`,
    `Fonte (h1/h2/p/a/button): ${fonts.join(', ') || '—'}`,
  );
  return { signals, observations };
}
