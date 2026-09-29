import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/parse/page.js';
import { textPageFrom } from '../src/quality/pages.js';
import { analyzeText, lineInSource, type TextPage } from '../src/quality/text.js';

const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 1009}`).join(' ');
const REPEATED = 'Ofrojmë shërbime të personalizuara për çdo klient me vëmendje të veçantë ndaj detajeve dhe kërkesave tuaja specifike.';
const TEMPLATE = 'Na ndiqni në rrjetet sociale për ofertat e fundit dhe lajmet e bujtinës gjatë gjithë vitit në Alpet Shqiptare.';

function page(id: string, o: Partial<TextPage> = {}): TextPage {
  const main = o.mainText ?? words(id.replace(/\W/g, ''), 120);
  return {
    id, lang: 'sq', title: `Faqja ${id} | Bujtina Shembull`, h1s: [`Faqja ${id}`], mainText: main, wordCount: main.split(/\s+/).length,
    contentBlocks: [], genericLinks: [], ctas: [], iframes: [], noindex: false, ...o,
  };
}
const codes = (pages: TextPage[]) => analyzeText(pages).signals.map((s) => `${s.code}:${s.target}`);

describe('Cilësia e tekstit: blloqe të përsëritura', () => {
  it('paragraf identik në 3 nga 6 faqe → sinjal (low, 0.5, verifikim); s\'pretendon autorësi AI', () => {
    const pages = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => page(id, { contentBlocks: [{ tag: 'p', text: TEMPLATE }, ...(i < 3 ? [{ tag: 'p', text: REPEATED }] : [])] }));
    const a = analyzeText(pages);
    const s = a.signals.find((x) => x.code === 'REPEATED_CONTENT_BLOCK')!;
    expect(s).toMatchObject({ severity: 'low', confidence: 0.5, target: 'a', related: ['b', 'c'] });
    expect(s.evidence[0]).toContain('Ofrojmë shërbime të personalizuara');
    expect(s.whyItMatters).toMatch(/s'provon që teksti\/dizajni është krijuar nga AI/);
    // Blloku që del në të gjitha 6 faqet trajtohet si shabllon, jo si problem
    expect(a.signals.filter((x) => x.code === 'REPEATED_CONTENT_BLOCK')).toHaveLength(1);
    expect(a.observations.join(' ')).toMatch(/1 blloqe teksti shfaqen në ≥ 60%.*shabllon, s'penalizohen/);
  });

  it('false positive: përkthimet sq/en s\'krahasohen; paragrafi në 2 faqe s\'mjafton; titujt (h2) s\'numërohen', () => {
    const sq = ['a', 'b'].map((id) => page(id, { contentBlocks: [{ tag: 'p', text: REPEATED }] }));
    const en = ['c', 'd'].map((id) => page(id, { lang: 'en', contentBlocks: [{ tag: 'p', text: REPEATED }] }));
    const h2 = ['e', 'f', 'g'].map((id) => page(id, { lang: 'it', contentBlocks: [{ tag: 'h2', text: REPEATED }] }));
    expect(codes([...sq, ...en, ...h2]).filter((c) => c.startsWith('REPEATED'))).toEqual([]);
  });

  it('parsePage: header/nav/footer s\'hyjnë te blloqet e përmbajtjes', () => {
    const p = parsePage(`<html><body><header><p>${TEMPLATE}</p></header><main><p>${REPEATED}</p></main><footer><p>${TEMPLATE}</p></footer></body></html>`, 'https://e.com/');
    expect(p.contentBlocks.map((b) => b.text)).toEqual([REPEATED]);
  });
});

describe('Cilësia e tekstit: fraza të përgjithshme', () => {
  const cliche = 'Mirë se vini në faqen tonë. Ofrojmë cilësi të lartë dhe një përvojë të paharrueshme. Ekipi ynë profesional punon me pasion për zgjidhjen ideale. ';
  it('fraza të dendura pa detaje konkrete → GENERIC_COPY (0.4, low) me frazat si provë', () => {
    const s = analyzeText([page('g', { mainText: cliche + words('x', 90) })]).signals.find((x) => x.code === 'GENERIC_COPY')!;
    expect(s).toMatchObject({ severity: 'low', confidence: 0.4 });
    expect(s.evidence[0]).toMatch(/"mirë se vini në faqen tonë"|"Mirë se vini në faqen tonë"/i);
  });

  it('false positive: të njëjtat fraza, por me çmime/orare/numra → s\'raportohet', () => {
    const facts = 'Dhoma dyshe 45 € nata, mëngjesi 08:00–10:00, 12 dhoma, 3 km nga qendra, rezervime deri në 22:00, parkim 10 vende. ';
    expect(codes([page('f', { mainText: cliche + facts + words('y', 70) })]).filter((c) => c.startsWith('GENERIC'))).toEqual([]);
  });

  it('false positive: 1–2 fraza të zakonshme më vete s\'mjaftojnë', () => {
    expect(codes([page('h', { mainText: `Shërbim cilësor dhe me pasion. ${words('z', 120)}` })]).filter((c) => c.startsWith('GENERIC'))).toEqual([]);
  });
});

describe('Cilësia e tekstit: titulli ↔ përmbajtja', () => {
  it('titulli që s\'ka lidhje me përmbajtjen → sinjal; emri i markës (i përbashkët) përjashtohet', () => {
    const pages = [
      page('x', { title: 'Oferta speciale verore | Bujtina Shembull', h1s: ['Galeria'], mainText: words('foto', 120) }),
      page('y', { title: 'Dhomat | Bujtina Shembull' }),
      page('z', { title: 'Kontakt | Bujtina Shembull' }),
    ];
    const s = analyzeText(pages).signals.find((x) => x.code === 'TITLE_CONTENT_MISMATCH' && x.target === 'x')!;
    expect(s.evidence[1]).toBe('fjalë kyçe (pa emrin e markës): oferta, speciale, verore');
  });

  it('false positive: forma të lakuara shqip ("Dhomat" ↔ "dhomave") dhe titulli i markës s\'raportohen', () => {
    const pages = [
      page('d', { title: 'Dhomat me ballkon | Bujtina Shembull', h1s: ['Akomodimi'], mainText: `Të gjitha dhomave u shtuam ballkone të reja. ${words('d', 110)}` }),
      page('e', { title: 'Bujtina Shembull', mainText: words('e', 120) }),
      page('f', { title: 'Faqja f | Bujtina Shembull' }),
    ];
    expect(codes(pages).filter((c) => c.startsWith('TITLE'))).toEqual([]);
  });
});

describe('Cilësia e tekstit: CTA dhe linke pa kontekst', () => {
  /** Faqe e parsuar realisht: konteksti (titulli i kartës, plani) vjen nga parser-i, jo nga testi. */
  const parsed = (id: string, body: string) => textPageFrom(id, parsePage(`<html lang="en"><body><header><nav><a href="/">Home</a></nav></header><main>${body}</main><footer><a href="/x/1">Read more</a></footer></body></html>`, id));
  const sig = (p: TextPage) => analyzeText([p]).signals;

  it('pozitiv: 3× "Lexo më shumë" pa titull/tekst pranë, drejt faqeve të ndryshme → GENERIC_LINK_TEXT_REPEATED', () => {
    const p = parsed('https://e.com/', '<div class="links"><a href="/blog/a">Lexo më shumë</a> <a href="/blog/b">Lexo më shumë</a> <a href="/blog/c">Lexo më shumë</a></div>');
    const s = sig(p);
    expect(s.map((x) => x.code)).toEqual(['GENERIC_LINK_TEXT_REPEATED']);
    expect(s[0]!.message).toBe('3× "Lexo më shumë" në përmbajtje, drejt 3 destinacioneve të ndryshme, pa titull ose tekst pranë që i dallon');
    expect(s[0]!.evidence[0]).toBe('emri i aksesueshëm: "Lexo më shumë" (burimi: teksti i dukshëm)');
    expect(s[0]!.whyItMatters).not.toMatch(/shabllon/);
    // të njëjtat linke vetëm në menu/footer s'numërohen
    expect(sig(parsed('https://e.com/f', '<p>Tekst.</p>')).filter((x) => x.code.includes('LINK'))).toEqual([]);
  });

  it('regresion (gjecaj.al /rooms): "Details" brenda kartave me titull e përshkrim → vetëm vërejtje aksesueshmërie, me provën e emrit', () => {
    const card = (slug: string, title: string) => `<div class="room"><img src="/${slug}.jpg" alt="${title}"><h3>${title}</h3><p>Dhomë me pamje nga malet, 2 persona.</p><a class="btn" href="/guesthouse/rooms/${slug}/">Details</a></div>`;
    const p = parsed('https://e.com/rooms/', card('deluxe-double-balcony', 'Deluxe Double Balcony') + card('deluxe-triple-balcony', 'Deluxe Triple Balcony') + card('traditional-room', 'Traditional Room'));
    expect(p.genericLinks.filter((l) => l.region === 'main').map((l) => l.context)).toEqual(['Deluxe Double Balcony', 'Deluxe Triple Balcony', 'Traditional Room']);
    const s = sig(p);
    expect(s.map((x) => x.code)).toEqual(['LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT']);
    expect(s[0]).toMatchObject({ kind: 'accessibility', severity: 'low' });
    expect(s[0]!.evidence).toEqual([
      'emri i aksesueshëm: "Details" (burimi: teksti i dukshëm; pa aria-label/aria-labelledby përshkrues)',
      'konteksti pranë: "Deluxe Double Balcony", "Deluxe Triple Balcony", "Traditional Room"',
      'destinacione: /guesthouse/rooms/deluxe-double-balcony/, /guesthouse/rooms/deluxe-triple-balcony/, /guesthouse/rooms/traditional-room/',
    ]);
    expect(s[0]!.message).not.toMatch(/pa kontekst/);
    expect(s[0]!.whyItMatters).toMatch(/jo sinjal "AI slop" dhe jo provë shablloni/);
    // pa pohime kategorike për WCAG: emri llogaritet me algoritëm të thjeshtuar
    expect(s[0]!.whyItMatters).toMatch(/përafrim të thjeshtuar: kjo s'është vlerësim përputhshmërie me WCAG/);
    expect(s[0]!.whyItMatters).not.toMatch(/2\.4\.\d|plotëson|shkel/);
    expect(s[0]!.suggestion).toContain('aria-label="Details: Deluxe Double Balcony"');
  });

  it('konteksti me <br> në titull lexohet me hapësirë; shigjeta s\'hyn te aria-label i sugjeruar', () => {
    const card = (slug: string, a: string, b: string) => `<div><h2>${a}<br/>${b}</h2><p>Përshkrim.</p><a href="/${slug}">Learn more→</a></div>`;
    const p = parsed('https://e.com/', card('intake', 'Intake', 'and integrations') + card('plan', 'Planning', 'and monitoring') + card('ai', 'AI and', 'automations'));
    expect(p.genericLinks.filter((l) => l.region === 'main').map((l) => l.context)).toEqual(['Intake and integrations', 'Planning and monitoring', 'AI and automations']);
    expect(sig(p)[0]!.suggestion).toContain('aria-label="Learn more: Intake and integrations"');
  });

  it('false positive: "Read more" me aria-label ose aria-labelledby përshkrues s\'numërohet; aria-labelledby pa element → teksti', () => {
    const p = parsePage(`<html><body><main>
      <a href="/a" aria-label="Read more about maze fli">Read more</a>
      <span id="t-b">Byrek me hithra</span><a href="/b" aria-labelledby="t-b">Read more</a>
      <a href="/c" aria-labelledby="mungon">Read more</a>
      <a href="/d" aria-label="Read more">Read more</a>
    </main></body></html>`, 'https://e.com/');
    expect(p.genericLinks.map((l) => [l.href, l.nameSource])).toEqual([['/c', 'text'], ['/d', 'aria-label']]);
  });

  it('sugjerimi (pa kontekst) ndërtohet nga destinacioni real, jo nga një shembull fiks', () => {
    const p = parsed('https://e.com/j', '<ul>' + ['maze-fli-lamb', 'byrek-me-hithra', 'kacamak'].map((s) => `<li><a href="/journal/food/${s}/">Read more</a></li>`).join('') + '</ul>');
    expect(sig(p)[0]!.suggestion).toContain('p.sh. "Maze fli lamb" në vend të "Read more"');
  });

  it('false positive: 8× "Read more" drejt së njëjtës faqe s\'raportohet (s\'e ngatërron vizitorin)', () => {
    const p = parsed('https://e.com/r', Array.from({ length: 8 }, (_, i) => `<p>Pjata ${i}</p><a href="/restaurant/menu/">Read more →</a>`).join(''));
    expect(sig(p)).toEqual([]);
  });

  it('e njëjta faqe në dy URL ("/" dhe "/homepage") → një sinjal me faqen e dytë si related', () => {
    const body = '<div>' + [1, 2, 3, 4].map((i) => `<a href="/p${i}">Learn more</a>`).join(' ') + '</div>';
    const s = analyzeText([parsed('https://e.com/', body), parsed('https://e.com/homepage', body)]).signals;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ code: 'GENERIC_LINK_TEXT_REPEATED', target: 'https://e.com/', related: ['https://e.com/homepage'] });
  });

  it('regresion (gjecaj.al /gift-cards): "Choose this gift" në 4 karta produktesh me emra të ndryshëm → s\'raportohet', () => {
    const card = (name: string, price: number) => `<div class="product"><h3>${name}</h3><p>${price} €</p><a class="btn" href="/gift-cards/">Choose this gift →</a></div>`;
    const p = parsed('https://e.com/gift-cards/', card('Dinner for two', 60) + card('Weekend stay', 180) + card('Hiking day', 45) + card('Cooking class', 35));
    expect(p.ctas.filter((c) => c.region === 'main').map((c) => c.context)).toEqual(['Dinner for two', 'Weekend stay', 'Hiking day', 'Cooking class']);
    const a = analyzeText([p]);
    expect(a.signals).toEqual([]);
    expect(a.observations.join(' ')).toMatch(/1 grupe CTA të përsëritura s'u raportuan: janë të lidhura me produkte\/plane\/karta/);
  });

  it('regresion (linear.app /pricing): "Get started" për plane të ndryshme, edhe në tabelën e krahasimit → s\'raportohet', () => {
    const plans = ['Free', 'Basic', 'Business', 'Enterprise'];
    const cards = plans.map((n) => `<div class="plan"><h2>${n}</h2><p>Për ekipe.</p><a class="btn" href="/signup">Get started</a></div>`).join('');
    const table = `<table><tr><th></th>${plans.map((n) => `<th>${n}</th>`).join('')}</tr><tr><td>Anëtarë</td><td>2</td><td>∞</td><td>∞</td><td>∞</td></tr><tr><td></td>${plans.map(() => '<td><a class="btn" href="/signup">Get started</a></td>').join('')}</tr></table>`;
    const p = parsed('https://e.com/pricing', cards + table);
    const main = p.ctas.filter((c) => c.region === 'main');
    expect(main).toHaveLength(8);
    expect(main.map((c) => c.context)).toEqual([...plans, ...plans]);
    expect(sig(p)).toEqual([]);
  });

  it('pozitiv: i njëjti CTA 4× drejt së njëjtës faqe pa kontekst → sinjal i dobët (0.4), pa sugjerim heqjeje; 3× jo', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `<section><p>Paragraf ${'x'.repeat(i + 1)}</p></section><div><a class="btn" href="/booking">Book now</a></div>`).join('');
    const p = parsed('https://e.com/c', body(4));
    // teksti pranë është në seksionin fqinj, jo në të njëjtin bllok me butonin
    expect(p.ctas.filter((c) => c.region === 'main').map((c) => c.context)).toEqual([undefined, undefined, undefined, undefined]);
    const s = sig(p).find((x) => x.code === 'CTA_REPEATED_ON_PAGE')!;
    expect(s).toMatchObject({ confidence: 0.4, severity: 'low' });
    expect(s.evidence).toContain('destinacioni: https://e.com/booking');
    expect(s.suggestion).not.toMatch(/hiq|mbaj një/i);
    expect(sig(parsed('https://e.com/c3', body(3))).filter((x) => x.code === 'CTA_REPEATED_ON_PAGE')).toEqual([]);
  });
});

describe('Auditi i skedarëve: rreshti i provës', () => {
  it('lineInSource gjen rreshtin e tekstit në HTML; kur s\'gjendet, s\'shpik rresht', () => {
    const html = `<html>\n<body>\n<main>\n<p>${REPEATED}</p>\n</main></body></html>`;
    expect(lineInSource(html, REPEATED)).toBe(4);
    expect(lineInSource(html, 'tekst që s\'ekziston')).toBeUndefined();
    const tp = textPageFrom('faqe.html', parsePage(html, 'https://source.invalid/faqe.html'), html);
    expect(tp.contentBlocks[0]!.text).toBe(REPEATED);
  });
});
