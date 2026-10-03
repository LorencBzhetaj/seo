import { externalLink, html, truncate, type SafeHtml } from './html.js';
import type { Query } from './views.js';
import { DEVICE_LABELS, fmt, galleryHref, shotHref } from './views-visual.js';
import { BAND_PX, PAIR_STATUS_LABELS, PIXEL_TOLERANCE, renderReason, type Check, type PairStatus, type PixelDiffResult, type VisualCompare, type VisualPair } from './visual-compare.js';

/**
 * Pamja e krahasimit vizual mes dy auditeve: lista e çifteve faqe+pajisje me verifikimin e metadatave,
 * dhe për një çift: kontrollet, ndryshimi i matur i pikselëve, krah-për-krah dhe mbivendosja (diferencë).
 * Pa JavaScript (CSP): mbivendosja bëhet me CSS mix-blend-mode.
 */

const STATUS_CLS: Record<PairStatus, string> = { full: 'complete', limited: 'partial', 'not-comparable': 'not-comparable' };
const STATE_TEXT: Record<Check['state'], SafeHtml> = {
  ok: html`<span class="badge b-complete">✓ verifikuar</span>`,
  limited: html`<span class="badge b-partial">kufizim</span>`,
  blocked: html`<span class="badge b-not-comparable">pengon krahasimin</span>`,
};
const deviceLabel = (d: string) => DEVICE_LABELS[d] ?? (d || 'pajisje e panjohur');
const statusBadge = (s: PairStatus) => html`<span class="badge b-${STATUS_CLS[s]}">${PAIR_STATUS_LABELS[s]}</span>`;

export function visualCompareHref(a: string, b: string, q: { page?: string; device?: string } = {}, hash = ''): string {
  const qs = new URLSearchParams({ a, b });
  if (q.page) qs.set('page', q.page);
  if (q.device) qs.set('device', q.device);
  return `/compare/visual?${qs.toString()}${hash}`;
}

/** Kufizimet e një çifti për tabelën: emri i kontrollit për kufizimet, arsyeja e plotë për pengesat. */
function limitsText(p: VisualPair): string {
  return p.checks.filter((c) => c.state !== 'ok').map((c) => (c.state === 'blocked' ? `${c.label}: ${c.note}` : c.label.toLowerCase())).join(' · ');
}

/** Paneli i shkurtër te krahasimi i raporteve: sa çifte, sa të plota, lidhja. */
export function visualComparePanel(c: VisualCompare): SafeHtml {
  const n = (s: PairStatus) => c.pairs.filter((p) => p.status === s).length;
  return html`<section class="panel signals" id="vizual"><h2>Krahasimi vizual <span class="note">(jashtë Health; matje pikselësh, jo vlerësim)</span></h2>
${c.pairs.length
    ? html`<p>${String(c.pairs.length)} çifte faqe+pajisje: ${statusBadge('full')} ${String(n('full'))} · ${statusBadge('limited')} ${String(n('limited'))} · ${statusBadge('not-comparable')} ${String(n('not-comparable'))}</p>`
    : html`<p class="note">Asnjë pamje për t'u krahasuar.</p>`}
<p><a href="${visualCompareHref(c.a.file, c.b.file)}"><strong>Hap krahasimin vizual</strong></a></p></section>`;
}

function diffBlock(d: PixelDiffResult | undefined, p: VisualPair): SafeHtml | '' {
  if (p.status === 'not-comparable') return html`<div class="warnbox">S'u mat ndryshimi i pikselëve: ${p.checks.filter((c) => c.state === 'blocked').map((c) => c.note.replace(/.+$/, '')).join('; ')}. Pamjet më poshtë janë vetëm për shikim.</div>`;
  if (!d) return '';
  if (!d.ok) return html`<div class="warnbox">S'u mat ndryshimi i pikselëve: ${d.reason}</div>`;
  const top = d.bands.filter((b) => b.pct >= 1).sort((x, y) => y.pct - x.pct).slice(0, 6).sort((x, y) => x.from - y.from);
  const vp = p.checks.find((x) => x.key === 'viewport');
  const unknown = [vp?.a === "s'është ruajtur" ? 'A' : '', vp?.b === "s'është ruajtur" ? 'B' : ''].filter(Boolean).join(' dhe ');
  return html`<h3>Ndryshimi i matur i pikselëve${p.orientative ? html` <span class="badge b-partial">matje orientuese</span>` : ''}</h3>
${p.orientative ? html`<div class="warnbox"><strong>Matje orientuese:</strong> viewport-i i raportit ${unknown} s'është ruajtur (raport i vjetër). Gjerësia e skedarëve përputhet, por madhësia e ekranit dhe emulimi s'mund të vërtetohen; përqindja tregon vetëm drejtimin, jo një krahasim të verifikuar.</div>` : ''}
<p><strong>${String(d.changedPct)}%</strong> e pikselëve kanë diferencë <strong>mbi tolerancën ${String(PIXEL_TOLERANCE)}/255</strong> në të paktën një kanal ngjyre (R, G ose B), në zonën e përbashkët (${String(d.width)} × ${String(d.commonHeight)} px nga maja). Diferenca më e madhe e një kanali: ${String(d.maxChannelDiff)}/255.${d.changedPct === 0 ? " 0% do të thotë që asnjë piksel s'ndryshon përtej tolerancës; diferencat më të vogla (p.sh. zhurma e JPEG) s'numërohen." : ''}${d.heightA !== d.heightB ? html` Lartësia e skedarëve: A ${String(d.heightA)} px → B ${String(d.heightB)} px; pjesa përtej ${String(d.commonHeight)} px s'krahasohet.` : ''}</p>
${top.length ? html`<table><thead><tr><th>Brezi (px CSS nga maja)</th><th class="num">Pikselë të ndryshuar</th></tr></thead><tbody>${top.map((b) => html`<tr><td>${String(b.from)}–${String(b.to)}</td><td class="num">${String(b.pct)}%</td></tr>`)}</tbody></table>` : html`<p class="note">Asnjë brez ${String(BAND_PX)} px me ndryshim ≥ 1%.</p>`}
<p class="note">Toleranca ${String(PIXEL_TOLERANCE)}/255 për kanal (zhurma e JPEG), brezat ${String(BAND_PX)} px: pragje provizore, të pakalibruara. Një ndryshim mund të vijë nga përmbajtje dinamike (slider, banner cookie, imazhe që ngarkohen vonë, data/ora) dhe s'është vetvetiu as përmirësim, as përkeqësim.</p>`;
}

function pairDetail(c: VisualCompare, p: VisualPair, d: PixelDiffResult | undefined): SafeHtml {
  const img = (side: 'A' | 'B') => {
    const s = side === 'A' ? p.a : p.b;
    const g = side === 'A' ? c.a : c.b;
    const head = html`<figcaption><strong>${side}</strong> · ${fmt(g.date)}${s ? html` · <a href="${galleryHref(g.file, { shot: s.index }, '#pamja')}">në galeri</a>` : ''}</figcaption>`;
    if (!s) return html`<figure class="cmp">${head}<div class="warnbox">S'ka pamje për këtë faqe/pajisje te ${side}.</div></figure>`;
    if (s.status !== 'ok') return html`<figure class="cmp">${head}<div class="warnbox">S'u renderua: ${renderReason(s)}</div></figure>`;
    if (s.state !== 'ok') return html`<figure class="cmp">${head}<div class="warnbox">${s.state === 'invalid' ? 'Shteg i pavlefshëm screenshot-i (s\'shërbehet)' : 'Screenshot-i mungon lokalisht'}: <span class="code">${truncate(s.screenshot, 120)}</span></div></figure>`;
    return html`<figure class="cmp"><a href="${shotHref(s.screenshot)}"><img src="${shotHref(s.screenshot)}" alt="${side} · ${deviceLabel(p.device)} · ${p.url}"></a>${head}</figure>`;
  };
  const both = p.a?.state === 'ok' && p.b?.state === 'ok' && p.a.status === 'ok' && p.b.status === 'ok';
  const sameWidth = !!p.fileA && !!p.fileB && p.fileA.width === p.fileB.width;
  return html`<section class="panel" id="krahasimi"><h2>${deviceLabel(p.device)} · ${truncate(p.url, 90)} ${statusBadge(p.status)}</h2>
<p class="note">${externalLink(p.url)}</p>
<h3>Verifikimi para krahasimit</h3>
<table><thead><tr><th>Kontrolli</th><th>A</th><th>B</th><th>Gjendja</th><th>Shënim</th></tr></thead><tbody>
${p.checks.map((x) => html`<tr><td>${x.label}</td><td class="note">${truncate(x.a, 70)}</td><td class="note">${truncate(x.b, 70)}</td><td>${STATE_TEXT[x.state]}</td><td class="note">${x.note}</td></tr>`)}
</tbody></table>
${diffBlock(d, p)}
<h3>Krah për krah</h3>
<div class="cmp-grid ${p.device === 'mobile' ? 'mobile' : ''}">${img('A')}${img('B')}</div>
${both && sameWidth && p.status !== 'not-comparable'
    ? html`<h3>Mbivendosje (diferencë)</h3>
<p class="note">B vendoset mbi A me "difference": çdo piksel tregon diferencën |B − A|. <strong>E zeza</strong> do të thotë që A dhe B kanë të njëjtën ngjyrë në atë pikë; gri shumë e errët janë diferenca të vogla (zakonisht zhurmë JPEG, nën tolerancë, s'numërohen te përqindja); zonat <strong>e ndriçuara ose me ngjyrë</strong> janë ndryshime. Paneli është i kufizuar në lartësi: lëviz brenda tij, ose hap pamjet origjinale: <a href="${shotHref(p.a!.screenshot)}">A origjinale</a> · <a href="${shotHref(p.b!.screenshot)}">B origjinale</a>.</p>
<div class="ovl ${p.device === 'mobile' ? 'mobile' : ''}"><img src="${shotHref(p.a!.screenshot)}" alt="A"><img class="top" src="${shotHref(p.b!.screenshot)}" alt="B (diferencë)"></div>`
    : both
      ? html`<p class="note">Mbivendosja s'shfaqet: skedarët kanë gjerësi të ndryshme.</p>`
      : ''}
</section>`;
}

export function visualCompareBody(c: VisualCompare, q: Query, diff?: PixelDiffResult): SafeHtml {
  const head = html`<h1>Krahasimi vizual: ${c.sa.target}</h1>
<p class="sub">A: <a href="${galleryHref(c.a.file)}">${fmt(c.a.date)}</a> → B: <a href="${galleryHref(c.b.file)}">${fmt(c.b.date)}</a> · <a href="/compare?a=${encodeURIComponent(c.a.file)}&amp;b=${encodeURIComponent(c.b.file)}">← krahasimi i raporteve</a></p>`;
  if (!c.sameTarget) return html`${head}<div class="warnbox">${c.reason ?? ''}</div>`;
  const devices = [...new Set(c.pairs.map((p) => p.device))];
  const pages = [...new Set(c.pairs.map((p) => p.url))];
  const device = q.device && devices.includes(q.device) ? q.device : undefined;
  const page = q.page && pages.includes(q.page) ? q.page : undefined;
  const sel = page && device ? c.pairs.find((p) => p.url === page && p.device === device) : undefined;
  const shown = c.pairs.filter((p) => (!device || p.device === device) && (!page || p.url === page));
  const opt = (value: string, label: string, cur?: string) => html`<option value="${value}" ${cur === value ? html`selected` : ''}>${label}</option>`;
  const n = (s: PairStatus) => c.pairs.filter((p) => p.status === s).length;
  return html`${head}
<div class="warnbox">Krahasohet e njëjta faqe (URL e njëjtë) në të njëjtën pajisje. Para matjes verifikohen URL-ja, pajisja, madhësia e viewport-it, prerja dhe përmasat reale të skedarëve. Ndryshimi i pikselëve është matje për shqyrtim njerëzor: <strong>s'hyn në Health Score</strong> dhe s'quhet përmirësim ose përkeqësim.</div>
${c.caveats.length ? html`<div class="panel"><h2>Kujdes para leximit</h2><ul class="plain">${c.caveats.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
<p>${String(c.pairs.length)} çifte: ${statusBadge('full')} ${String(n('full'))} · ${statusBadge('limited')} ${String(n('limited'))} · ${statusBadge('not-comparable')} ${String(n('not-comparable'))}</p>
<form class="filters" method="get" action="/compare/visual">
<input type="hidden" name="a" value="${c.a.file}"><input type="hidden" name="b" value="${c.b.file}">
<label>Faqja<select name="page">${opt('', `Të gjitha (${pages.length})`)}${pages.map((p) => opt(p, truncate(p, 80), page))}</select></label>
<label>Pajisja<select name="device">${opt('', 'Të dyja')}${devices.map((d) => opt(d, deviceLabel(d), device))}</select></label>
<button type="submit">Filtro</button> <a href="${visualCompareHref(c.a.file, c.b.file)}">pastro</a></form>
${page && device && !sel ? html`<div class="warnbox">S'ka çift për këtë faqe në ${deviceLabel(device)}.</div>` : ''}
${sel ? pairDetail(c, sel, diff) : ''}
<section class="panel"><h2>${String(shown.length)} çifte faqe + pajisje</h2>
${shown.length
    ? html`<table><thead><tr><th>Faqja</th><th>Pajisja</th><th>Statusi</th><th>Kufizimet</th><th></th></tr></thead><tbody>
${shown.map((p) => html`<tr><td><span class="code">${truncate(p.url, 70)}</span></td><td>${deviceLabel(p.device)}</td><td>${statusBadge(p.status)}${p.orientative ? html`<div class="tag">matje orientuese</div>` : ''}</td><td class="note">${limitsText(p) || 'asnjë'}</td><td class="row-actions"><a href="${visualCompareHref(c.a.file, c.b.file, { page: p.url, device: p.device }, '#krahasimi')}">Krahaso</a></td></tr>`)}
</tbody></table>`
    : html`<p class="note">Asnjë çift për këtë filtër.</p>`}</section>`;
}
