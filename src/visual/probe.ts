/**
 * Skripti që ekzekutohet NË FAQEN E RENDERUAR (browser) dhe mat modelet vizuale: seksionet, grupet e
 * kartave, gradientët, imazhet, fontet dhe tejkalimin horizontal. Mbahet si string JS i thjeshtë
 * (jo funksion TS), që transpiler-i të mos i shtojë ndihmës (__name…) që s'ekzistojnë në faqe.
 */
export interface ProbeCardGroup {
  selector: string;
  count: number;
  signature: string;
  width: number;
  height: number;
  hasIcon: boolean;
  hasHeading: boolean;
  hasImage: boolean;
  region: 'header' | 'footer' | 'main';
  top: number;
}

export interface ProbeGradient {
  value: string;
  selector: string;
  width: number;
  height: number;
  top: number;
  region: 'header' | 'footer' | 'main';
  textClip: boolean;
}

export interface ProbeImage {
  src: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  alt: string | null;
  region: 'header' | 'footer' | 'main';
  top: number;
  background: boolean;
}

export interface ProbeSection {
  kind: 'hero' | 'cards' | 'gradient' | 'media' | 'text';
  selector: string;
  top: number;
  height: number;
  cards: number;
}

export interface ProbeResult {
  viewport: { width: number; height: number };
  scrollWidth: number;
  documentHeight: number;
  sections: ProbeSection[];
  cardGroups: ProbeCardGroup[];
  gradients: ProbeGradient[];
  images: ProbeImage[];
  fonts: string[];
  elementsScanned: number;
  truncated: boolean;
}

export const PROBE_SCRIPT = String.raw`(() => {
  const MAX = 5000;
  const vw = window.innerWidth, vh = window.innerHeight;
  const sel = (el) => {
    if (!el || !el.tagName) return '';
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id.slice(0, 40);
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter((c) => c && !/\d/.test(c)).slice(0, 2);
    return tag + (cls.length ? '.' + cls.join('.') : '');
  };
  const region = (el) => el.closest('footer,[role="contentinfo"]') ? 'footer' : el.closest('header,nav,[role="banner"],[role="navigation"]') ? 'header' : 'main';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const top = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
  const words = (t) => (t || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const all = Array.from(document.body.querySelectorAll('*'));
  const els = all.slice(0, MAX);

  // Grupe kartash: ≥ 3 fëmijë me të njëjtën strukturë, gjerësi të ngjashme dhe tekst.
  const childSig = (c) => {
    const cls = (typeof c.className === 'string' ? c.className : '').split(/\s+/).filter((x) => x && !/\d/.test(x)).sort().slice(0, 3).join('.');
    const inner = Array.from(c.children).slice(0, 4).map((x) => x.tagName.toLowerCase()).join(',');
    return c.tagName.toLowerCase() + '.' + cls + '>' + inner;
  };
  const inCard = new Set();
  const cardGroups = [];
  for (const el of els) {
    if (el.children.length < 3 || inCard.has(el)) continue;
    const kids = Array.from(el.children).filter(visible);
    const by = new Map();
    for (const k of kids) { const s = childSig(k); by.set(s, (by.get(s) || []).concat([k])); }
    let best = null;
    for (const [s, list] of by) if (list.length >= 3 && (!best || list.length > best[1].length)) best = [s, list];
    if (!best) continue;
    const list = best[1];
    const widths = list.map((k) => k.getBoundingClientRect().width);
    if (Math.max(...widths) / Math.max(1, Math.min(...widths)) > 1.15) continue;
    // Kartë = element i ngushtë në rresht; seksionet me gjerësi të plotë s'janë karta (edhe kur përsëriten)
    if (Math.max(...widths) > vw * 0.6) continue;
    if (!list.every((k) => words(k.innerText) >= 3)) continue;
    const icon = (k) => Array.from(k.querySelectorAll('svg,i,img,span')).some((x) => {
      const r = x.getBoundingClientRect();
      const c = typeof x.className === 'string' ? x.className : '';
      return r.width > 0 && r.width <= 80 && r.height <= 80 && (x.tagName === 'svg' || x.tagName === 'IMG' || /icon|fa-|bi-|material|lucide|feather/i.test(c));
    });
    for (const k of list) k.querySelectorAll('*').forEach((d) => inCard.add(d));
    const r0 = list[0].getBoundingClientRect();
    cardGroups.push({
      selector: sel(el) + ' > ' + sel(list[0]), count: list.length, signature: best[0],
      width: Math.round(r0.width), height: Math.round(r0.height),
      hasIcon: list.filter(icon).length >= Math.ceil(list.length * 0.8),
      hasHeading: list.every((k) => k.querySelector('h2,h3,h4,h5,strong,b')),
      hasImage: list.every((k) => Array.from(k.querySelectorAll('img')).some((i) => i.getBoundingClientRect().width > 80)),
      region: region(el), top: top(el),
    });
    if (cardGroups.length >= 40) break;
  }

  // Gradientët: sfonde në elemente të mëdha, ose tekst me gradient (background-clip: text).
  const gradients = [];
  for (const el of els) {
    const s = getComputedStyle(el);
    const bg = s.backgroundImage || '';
    if (!bg.includes('gradient(')) continue;
    const r = el.getBoundingClientRect();
    const textClip = (s.webkitBackgroundClip || s.backgroundClip) === 'text';
    if (!textClip && (r.width < vw * 0.5 || r.height < 80)) continue;
    gradients.push({ value: bg.replace(/\s+/g, ' ').slice(0, 200), selector: sel(el), width: Math.round(r.width), height: Math.round(r.height), top: top(el), region: region(el), textClip });
    if (gradients.length >= 60) break;
  }

  // Imazhet e dukshme (≥ 80×80) dhe sfondet e mëdha me url().
  const images = [];
  for (const img of Array.from(document.images)) {
    const r = img.getBoundingClientRect();
    if (r.width < 80 || r.height < 80 || !visible(img)) continue;
    images.push({ src: img.currentSrc || img.src, width: Math.round(r.width), height: Math.round(r.height), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, alt: img.getAttribute('alt'), region: region(img), top: top(img), background: false });
    if (images.length >= 80) break;
  }
  for (const el of els) {
    const bg = getComputedStyle(el).backgroundImage || '';
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (!m) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5 || r.height < 200) continue;
    images.push({ src: new URL(m[1], location.href).href, width: Math.round(r.width), height: Math.round(r.height), naturalWidth: 0, naturalHeight: 0, alt: null, region: region(el), top: top(el), background: true });
    if (images.length >= 100) break;
  }

  // Seksionet kryesore: zbret nga main/body nëpër mbështjellës të vetëm deri te blloqet e faqes.
  let container = document.querySelector('main') || document.body;
  for (let i = 0; i < 5; i++) {
    const kids = Array.from(container.children).filter((k) => visible(k) && !k.matches('header,nav,footer,script,style,[role="banner"],[role="contentinfo"]'));
    if (kids.length === 1 && kids[0].getBoundingClientRect().width >= vw * 0.9) container = kids[0]; else break;
  }
  const sections = [];
  Array.from(container.children).forEach((k, i) => {
    if (!visible(k) || k.matches('header,nav,footer,script,style,[role="banner"],[role="contentinfo"]')) return;
    const r = k.getBoundingClientRect();
    if (r.height < 80 || r.width < vw * 0.6) return;
    const cards = cardGroups.filter((g) => k.contains(document.querySelector(g.selector.split(' > ')[0]) || null)).reduce((n, g) => n + g.count, 0);
    const grad = (getComputedStyle(k).backgroundImage || '').includes('gradient(');
    const kind = cards >= 3 ? 'cards' : grad ? 'gradient' : (sections.length === 0 && k.querySelector('h1')) ? 'hero' : k.querySelector('img') && words(k.innerText) > 10 ? 'media' : 'text';
    sections.push({ kind, selector: sel(k), top: top(k), height: Math.round(r.height), cards });
  });

  const fonts = Array.from(new Set(['h1', 'h2', 'p', 'a', 'button'].map((t) => document.querySelector(t)).filter(Boolean).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim())));
  return {
    viewport: { width: vw, height: vh },
    scrollWidth: document.documentElement.scrollWidth,
    documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    sections: sections.slice(0, 30), cardGroups, gradients, images, fonts,
    elementsScanned: els.length, truncated: all.length > MAX,
  };
})()`;
