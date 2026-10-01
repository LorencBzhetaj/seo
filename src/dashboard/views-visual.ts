import { externalLink, html, truncate, type SafeHtml } from './html.js';
import { SEV_LABELS, type IssueView } from './model.js';
import { isShotRel } from './store.js';
import type { Files, Query } from './views.js';
import { filterShots, signalShots, signalsForShot, type Gallery, type Shot, type ShotStateOf } from './visual.js';

/**
 * Galeria e pamjeve të renderuara dhe lidhja sinjal ↔ screenshot. Imazhet shërbehen vetëm nga /shot/…
 * (shtegu validohet nga store.screenshotPath, brenda output/visual). Asgjë s'ndikon në Health Score.
 */
export const DEVICE_LABELS: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile' };
const deviceLabel = (d: string) => DEVICE_LABELS[d] ?? (d || 'pajisje e panjohur');

export const shotHref = (rel: string) => `/shot/${rel.split('/').map(encodeURIComponent).join('/')}`;

export function galleryHref(file: string, q: { page?: string; device?: string; shot?: number } = {}, hash = ''): string {
  const qs = new URLSearchParams();
  if (q.page) qs.set('page', q.page);
  if (q.device) qs.set('device', q.device);
  if (q.shot !== undefined) qs.set('shot', String(q.shot));
  const s = qs.toString();
  return `/report/${encodeURIComponent(file)}/visual${s ? `?${s}` : ''}${hash}`;
}

/** Gjendja e një shtegu screenshot-i: i pavlefshëm (s'shërbehet kurrë), mungon, ose ok. */
export function shotStateOf(files: Files): ShotStateOf {
  return (rel) => (!isShotRel(rel) ? 'invalid' : files.shotExists(rel) ? 'ok' : 'missing');
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "s'është ruajtur";
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function missingText(s: { state: string; screenshot?: string; rel?: string }): SafeHtml {
  const rel = s.screenshot ?? s.rel ?? '';
  if (s.state === 'invalid') return html`<span class="miss">Shteg i pavlefshëm screenshot-i (s'shërbehet): <span class="code">${truncate(rel, 120)}</span></span>`;
  return html`<span class="miss">Screenshot-i mungon lokalisht${rel ? html`: <span class="code">${rel}</span>` : ''}</span>`;
}

/** Kartë e vogël e një pamjeje (lidhet te pamja e madhe në galeri). */
function shotCard(file: string, s: Shot, label: string, keep: { page?: string; device?: string } = {}): SafeHtml {
  const caption = html`<figcaption><strong>${deviceLabel(s.device)}</strong>${s.pageType ? html` · ${s.pageType}` : ''}<br><span class="code">${truncate(s.url, 60)}</span>${label ? html`<br><span class="tag">${label}</span>` : ''}</figcaption>`;
  if (s.status !== 'ok') return html`<figure class="shot ${s.device === 'mobile' ? 'mobile' : ''} none"><div class="ph">S'u renderua: ${truncate(s.reason, 160) || 'pa arsye në raport'}</div>${caption}</figure>`;
  if (s.state !== 'ok') return html`<figure class="shot ${s.device === 'mobile' ? 'mobile' : ''} none"><div class="ph">${missingText(s)}</div>${caption}</figure>`;
  return html`<figure class="shot ${s.device === 'mobile' ? 'mobile' : ''}"><a href="${galleryHref(file, { ...keep, shot: s.index }, '#pamja')}"><img src="${shotHref(s.screenshot)}" alt="${deviceLabel(s.device)} · ${s.url}" loading="lazy"></a>${caption}</figure>`;
}

// ---------------------------------------------------------------- Paneli në raport

export function visualPanel(file: string, g: Gallery): SafeHtml {
  if (!g.available) return html`<section class="panel" id="pamjet"><h2>Pamjet e renderuara</h2><p class="note">${g.reason}</p></section>`;
  const ok = g.shots.filter((s) => s.status === 'ok');
  const counts = g.devices.map((d) => `${g.shots.filter((s) => s.device === d && s.status === 'ok').length} ${deviceLabel(d).toLowerCase()}`).join(' + ');
  return html`<section class="panel" id="pamjet"><h2>Pamjet e renderuara <span class="note">(${ok.length} pamje · ${g.pages.length} faqe${counts ? ` · ${counts}` : ''})</span></h2>
<p class="note">Auditi: ${fmt(g.auditDate)}. Pamjet janë për shqyrtim njerëzor dhe s'hyjnë në Health Score. <a href="${galleryHref(file)}"><strong>Hap galerinë</strong></a> për filtrim sipas faqes/pajisjes dhe pamje të madhe.</p>
${g.shots.length ? html`<div class="shots">${g.shots.map((s) => shotCard(file, s, ''))}</div>` : html`<p class="note">Seksioni i pamjes ekziston, por pa asnjë pamje të renderuar.</p>`}
</section>`;
}

// ---------------------------------------------------------------- Te secili sinjal

/** Provë e sinjalit (screenshot i vërtetuar) dhe pamje për kontekst; mungesat thuhen shprehimisht. */
export function signalShotsBlock(file: string, i: IssueView, g: Gallery): SafeHtml | '' {
  if (!g.available) return i.section === 'quality' ? html`<h3>Pamjet</h3><p class="note">${g.reason}</p>` : '';
  const s = signalShots(i, g);
  const isSignal = i.section === 'quality';
  if (!isSignal && !s.proof.length && !s.context.length) return '';
  const proof = s.proof.length
    ? html`<h3>Provë e sinjalit <span class="note">(screenshot që raporti e lidh me këtë sinjal)</span></h3><div class="shots">${s.proof.map((p) =>
        p.shot && p.state === 'ok'
          ? shotCard(file, p.shot, 'provë e sinjalit')
          : html`<div class="warnbox">${p.state === 'ok' && p.unverified ? html`${p.unverified} <span class="code">${p.rel}</span>` : missingText({ state: p.state, rel: p.rel })}${p.state !== 'ok' && p.unverified ? html`<br>${p.unverified}` : ''}</div>`,
      )}</div>`
    : isSignal
      ? html`<p class="note">Ky sinjal s'ka screenshot si provë (prova është në DOM/tekst më sipër).</p>`
      : '';
  const context = s.context.length
    ? html`<h3>Pamje për kontekst <span class="note">(e njëjta faqe; jo provë e këtij sinjali)</span></h3><div class="shots">${s.context.map((c) => shotCard(file, c, 'kontekst'))}</div>`
    : '';
  const without = isSignal && s.pagesWithoutShots.length
    ? html`<p class="note">S'ka screenshot për ${s.pagesWithoutShots.length === 1 ? 'këtë faqe' : `${s.pagesWithoutShots.length} nga faqet`} në këtë raport (renderohen vetëm disa faqe përfaqësuese): ${s.pagesWithoutShots.slice(0, 5).map((p, n) => html`${n ? ', ' : ''}<span class="code">${truncate(p, 70)}</span>`)}${s.pagesWithoutShots.length > 5 ? ' …' : ''}</p>`
    : '';
  return html`${proof}${context}${without}`;
}

// ---------------------------------------------------------------- Faqja e galerisë

export function galleryBody(file: string, target: string, g: Gallery, issues: IssueView[], q: Query): SafeHtml {
  const back = html`<a href="/report/${encodeURIComponent(file)}">← Raporti</a>`;
  if (!g.available) return html`<h1>Pamjet vizuale</h1><p class="sub">${target} · ${back}</p><div class="warnbox">${g.reason}</div>`;
  const page = q.page && g.pages.includes(q.page) ? q.page : undefined;
  const device = q.device && g.devices.includes(q.device) ? q.device : undefined;
  const shown = filterShots(g, page, device);
  const idx = q.shot !== undefined && /^\d{1,4}$/.test(q.shot) ? Number(q.shot) : undefined;
  const sel = idx !== undefined ? g.shots[idx] : undefined;
  const opt = (value: string, label: string, cur?: string) => html`<option value="${value}" ${cur === value ? html`selected` : ''}>${label}</option>`;
  const pos = sel ? shown.findIndex((s) => s.index === sel.index) : -1;
  const prev = pos > 0 ? shown[pos - 1] : undefined;
  const next = pos >= 0 && pos < shown.length - 1 ? shown[pos + 1] : undefined;

  let detail: SafeHtml | '' = '';
  if (idx !== undefined && !sel) detail = html`<div class="warnbox">Pamja nr. ${String(idx)} s'ekziston në këtë raport.</div>`;
  if (sel) {
    const linked = signalsForShot(sel, issues, g);
    const cut = sel.documentHeight !== null && g.maxScreenshotHeight !== null && sel.documentHeight > g.maxScreenshotHeight;
    const reportPage = (u: string) => `/report/${encodeURIComponent(file)}?section=quality&page=${encodeURIComponent(u)}#issues`;
    detail = html`<section class="panel" id="pamja"><h2>${deviceLabel(sel.device)} · ${truncate(sel.url, 90)}</h2>
<div class="viewer">
<div class="big ${sel.device === 'mobile' ? 'mobile' : ''}">${sel.status !== 'ok'
      ? html`<div class="warnbox">S'u renderua: ${sel.reason || 'pa arsye në raport'}</div>`
      : sel.state === 'ok'
        ? html`<a href="${shotHref(sel.screenshot)}"><img src="${shotHref(sel.screenshot)}" alt="${deviceLabel(sel.device)} · ${sel.url}"></a>`
        : html`<div class="warnbox">${missingText(sel)}</div>`}</div>
<div class="meta"><dl class="kv">
<dt>Faqja</dt><dd>${externalLink(sel.url)}${sel.finalUrl && sel.finalUrl !== sel.url ? html`<div class="note">URL përfundimtare: ${sel.finalUrl}</div>` : ''}</dd>
<dt>Lloji i faqes</dt><dd>${sel.pageType || html`<span class="note">s'është ruajtur</span>`}</dd>
<dt>Pajisja</dt><dd>${deviceLabel(sel.device)}</dd>
<dt>Viewport</dt><dd><span class="note">madhësia s'është ruajtur në këtë raport (vetëm desktop/mobile)</span></dd>
<dt>Lartësia e faqes</dt><dd>${sel.documentHeight !== null ? `${sel.documentHeight} px` : html`<span class="note">s'është ruajtur</span>`}${cut ? html`<div class="note">Screenshot-i është prerë te ${String(g.maxScreenshotHeight)} px (kufiri i raportit).</div>` : ''}</dd>
<dt>Data e auditit</dt><dd>${fmt(g.auditDate)}</dd>
<dt>Skedari</dt><dd><span class="code">${sel.screenshot || '—'}</span>${sel.state === 'ok' ? html` · <a href="${shotHref(sel.screenshot)}">hap në madhësinë origjinale</a>` : ''}</dd>
</dl>
<p class="pager">${prev ? html`<a href="${galleryHref(file, { page, device, shot: prev.index }, '#pamja')}">← e mëparshmja</a>` : ''} ${next ? html`<a href="${galleryHref(file, { page, device, shot: next.index }, '#pamja')}">e radhës →</a>` : ''}</p>
<h3>Sinjale ku kjo pamje është provë</h3>
${linked.proof.length ? html`<ul class="plain">${linked.proof.map((i) => html`<li><span class="badge sev-${i.severity}">${SEV_LABELS[i.severity]}</span> ${i.message || i.code} <span class="code">${i.code}</span></li>`)}</ul>` : html`<p class="note">Asnjë: s'ka sinjal që e përdor këtë screenshot si provë.</p>`}
<h3>Sinjale të së njëjtës faqe <span class="note">(kjo pamje është vetëm kontekst për to)</span></h3>
${linked.samePage.length ? html`<ul class="plain">${linked.samePage.map((i) => html`<li><span class="badge sev-${i.severity}">${SEV_LABELS[i.severity]}</span> ${i.message || i.code} <span class="code">${i.code}</span></li>`)}</ul><p class="note"><a href="${reportPage(sel.url)}">Shiko këto sinjale në raport</a></p>` : html`<p class="note">Asnjë sinjal cilësie për këtë faqe.</p>`}
</div></div></section>`;
  }

  return html`<h1>Pamjet vizuale</h1>
<p class="sub">${target} · auditi ${fmt(g.auditDate)} · ${String(g.shots.length)} pamje · ${back}</p>
<div class="warnbox">Pamjet dhe sinjalet janë për shqyrtim njerëzor. <strong>S'hyjnë në Health Score</strong> dhe s'janë provë se një faqe është krijuar nga AI.</div>
<form class="filters" method="get" action="${galleryHref(file)}">
<label>Faqja<select name="page">${opt('', `Të gjitha (${g.pages.length})`)}${g.pages.map((p) => opt(p, truncate(p, 80), page))}</select></label>
<label>Pajisja<select name="device">${opt('', 'Të dyja')}${g.devices.map((d) => opt(d, deviceLabel(d), device))}</select></label>
<button type="submit">Filtro</button> <a href="${galleryHref(file)}">pastro</a></form>
${detail}
<section class="panel"><h2>${String(shown.length)} pamje${page || device ? ' (të filtruara)' : ''}</h2>
${shown.length ? html`<div class="shots">${shown.map((s) => shotCard(file, s, sel?.index === s.index ? 'e hapur' : '', { page, device }))}</div>` : html`<p class="note">Asnjë pamje për këtë filtër.</p>`}</section>`;
}
