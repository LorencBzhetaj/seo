import { externalLink, html, truncate, type SafeHtml } from './html.js';
import { SEV_LABELS, type IssueView, type Sev } from './model.js';
import { AREA_LABELS, BASIS_LABELS, coverageNote, coverageText, RANKING_NOTE, type BlockedResponse, type Task, type TaskArea, type TaskList } from './tasks.js';

/**
 * "Detyrat e rekomanduara": një detyrë për problem, me faqet unike, provat për faqe dhe gjetjet origjinale.
 * Gjithë teksti nga raporti kalon nga html`` (escape); URL-të e jashtme vetëm përmes externalLink (http/https).
 */

const sevBadge = (s: Sev) => html`<span class="badge sev-${s}">${SEV_LABELS[s]}</span>`;
/** Rëndësia e detyrës; për rëndësinë e trashëguar nga një raport historik, me shënim të dukshëm. */
const taskSev = (t: Task) => html`${sevBadge(t.severity)}${t.historicalSeverity ? html` <span class="badge b-warning">rëndësi historike e raportit; kërkon verifikim</span>` : ''}`;
const AREAS: TaskArea[] = ['homepage', 'site', 'business', 'quality'];
/** Bazat ku tabela "provë për faqe" ka kuptim (në nivel siti prova i përket URL-së problematike, jo faqes). */
const PER_PAGE: Task['basis'][] = ['template', 'linked-pages', 'separate-pages', 'possibly-related'];

export const tasksHref = (file: string, hash = '') => `/report/${encodeURIComponent(file)}/tasks${hash}`;
export const findingHref = (file: string, index: number) => `/report/${encodeURIComponent(file)}#gjetja-${index}`;

function confText(t: Task): string {
  const { min, max } = t.confidence;
  if (min === null || max === null) return "confidence s'është ruajtur";
  return min === max ? `confidence ${min}` : `confidence ${min}–${max}`;
}

function findingBlock(file: string, f: IssueView): SafeHtml {
  const ev = f.evidence.filter((e) => e.type !== 'screenshot');
  const shots = f.evidence.length - ev.length;
  return html`<details class="issue"><summary>${sevBadge(f.severity)} ${f.message || f.code} <span class="code">${f.code}</span>
${f.pages.length > 1 ? html`<span class="note">${f.pages.length} faqe</span>` : ''}${f.confidence !== null ? html` <span class="note">confidence ${f.confidence}</span>` : ''}</summary>
<div class="body"><p class="note"><a href="${findingHref(file, f.index)}">Hap këtë gjetje në raport</a></p>
${ev.map((e) => html`<div class="ev"><b>${e.type || 'provë'}</b>${e.url ? html` · ${truncate(e.url, 120)}` : ''}
${truncate(e.detected, 1200)}${e.expected ? html`
<b>pritej:</b> ${truncate(e.expected, 300)}` : ''}</div>`)}
${shots ? html`<p class="note">${String(shots)} provë screenshot: shihe te gjetja në raport.</p>` : ''}
${f.occurrences.length ? html`<p class="note">Raporti ruan provë për secilën nga ${String(f.occurrences.length)} faqet (tabela "Faqet" më lart).</p>` : f.pages.length > ev.length ? html`<p class="note">Raporti ruan prova vetëm për disa shembuj; lista e plotë e faqeve është te "Faqet".</p>` : ''}
</div></details>`;
}

function pagesBlock(t: Task): SafeHtml {
  if (!PER_PAGE.includes(t.basis)) {
    return html`<h3>URL-të (${String(t.pages.length)})</h3>${t.pages.length
      ? html`<ul class="plain">${t.pages.slice(0, 60).map((p) => html`<li>${externalLink(p)}</li>`)}</ul>${t.pages.length > 60 ? html`<p class="note">… +${String(t.pages.length - 60)} te gjetja në raport</p>` : ''}`
      : html`<p class="note">Pa URL në gjetje.</p>`}`;
  }
  const withEv = t.evidence.filter((e) => e.items.length);
  const missing = t.evidence.filter((e) => !e.items.length);
  return html`<h3>Faqet (${String(t.pages.length)})${missing.length ? ` · provë individuale për ${withEv.length}` : ' dhe prova për secilën'}</h3>
${withEv.length ? html`<table><thead><tr><th>Faqja</th><th>Prova</th></tr></thead><tbody>
${withEv.map((e) => html`<tr><td>${externalLink(e.url)}</td><td class="note">${e.items.map((x, n) => html`${n ? html`<br>` : ''}${truncate(x.detected, 220)}${x.expected ? html` <span class="muted">(pritej: ${truncate(x.expected, 80)})</span>` : ''}`)}</td></tr>`)}
</tbody></table>` : ''}
${missing.length ? html`<h3>Faqe pa provë individuale në këtë raport (${String(missing.length)})</h3>
<p class="note">Motori i gjeti me të njëjtin problem, por raporti ruan vetëm URL-në e tyre: motori i deritanishëm ruante prova për 5 shembuj për gjetje (raportet e reja i ruajnë për çdo faqe).</p>
<ul class="plain cols">${missing.map((e) => html`<li>${externalLink(e.url)}</li>`)}</ul>` : ''}`;
}

function taskBlock(file: string, t: Task, list: TaskList, n: number): SafeHtml {
  const byId = new Map(list.tasks.map((x) => [x.id, x]));
  return html`<details class="issue task" id="${t.id}"><summary><span class="note">#${String(n)}</span> ${taskSev(t)} <strong>${truncate(t.problem, 200)}</strong>
${t.area === 'homepage' && t.basis === 'single-page' ? '' : html`<span class="badge">${BASIS_LABELS[t.basis]}</span> `}<span class="note">${coverageText(t, list.coverage)}</span>
${t.needsManualReview ? html`<span class="badge b-warning">verifiko manualisht</span>` : ''}</summary>
<div class="body"><dl class="kv">
<dt>Veprimi i propozuar</dt><dd>${t.action}</dd>
<dt>Pse ${t.findings.length > 1 ? 'u bashkuan' : 'kjo detyrë'}</dt><dd>${t.why}</dd>
<dt>Shtrirja</dt><dd>${coverageText(t, list.coverage)}</dd>
<dt>Rëndësia</dt><dd>${SEV_LABELS[t.severity]} · ${confText(t)}${t.needsManualReview ? ' · kërkon verifikim manual' : ''}${t.historicalSeverity ? html`<div class="note">Rëndësia është e trashëguar nga raporti historik, jo vlerësimi aktual i mjetit; verifikoje me një audit të ri.</div>` : ''}</dd>
<dt>Pse në këtë vend</dt><dd class="note">${t.rankWhy}</dd>
${t.basis === 'template' ? html`<dt>Template (teknik)</dt><dd><span class="code">${truncate(t.templateLabel, 140) || '—'}</span><div class="note">${t.templateKeyStored ? 'çelësi i plotë nga raporti (klasat e body-t)' : "emër i shkurtuar nga mesazhi: template të ndryshme mund të duken njësoj këtu"}</div></dd>` : ''}
</dl>
${t.cautions.length ? html`<div class="warnbox">${t.cautions.map((c, i) => html`${i ? html`<br>` : ''}${c}`)}</div>` : ''}
${pagesBlock(t)}
<h3>Gjetjet origjinale (${String(t.findings.length)})</h3>
${t.findings.map((f) => findingBlock(file, f))}
${t.related.length ? html`<h3>Mund të lidhen <span class="note">(s'u bashkuan)</span></h3><ul class="plain">${t.related.slice(0, 6).map((r) => {
    const o = byId.get(r.id);
    return html`<li><a href="#${r.id}">${o ? truncate(o.problem, 90) : r.id}</a> — <span class="note">${r.why}</span></li>`;
  })}</ul>${t.related.length > 6 ? html`<p class="note">… +${String(t.related.length - 6)}</p>` : ''}` : ''}
</div></details>`;
}

/** Paralajmërim i dukshëm: faqja hyrëse u bllokua dhe kontrollet e saj s'përfaqësojnë faqen reale. */
export function blockedWarning(b: BlockedResponse, n: number): SafeHtml {
  return html`<div class="warnbox errors" id="bllokim"><strong>Faqja hyrëse ktheu HTTP ${String(b.status)} për tool-in: auditi s'pa faqen reale.</strong><br>
Kontrollet e header-ave (HSTS, CSP, X-Frame-Options…), të SEO-s dhe koha e përgjigjes në këtë raport u matën mbi përgjigjen e bllokimit, prandaj ${n ? `${String(n)} gjetje` : 'gjetjet e tyre'} s'paraqiten si detyra. Gjetja e qasjes mbetet si diagnozë. Nis një audit të ri kur faqja i përgjigjet tool-it me HTTP 200.<br>
<span class="note">Burimi: ${b.source}.</span></div>`;
}

export function tasksBody(file: string, target: string, list: TaskList): SafeHtml {
  const back = html`<a href="/report/${encodeURIComponent(file)}">← Raporti</a>`;
  const counts = AREAS.map((a) => [a, list.tasks.filter((t) => t.area === a).length] as const);
  const findings = list.tasks.reduce((s, t) => s + t.findings.length, 0);
  let n = 0;
  return html`<h1>Detyrat e rekomanduara</h1>
<p class="sub">${target} · ${back} · ${String(list.tasks.length)} detyra nga ${String(findings)} gjetje</p>
<div class="warnbox">Gjetjet bashkohen në një detyrë kur motori i grupoi faqet (strukturë e ngjashme faqeje, ose faqe që i lidh vetë gjetja); faqet dhe provat mbeten individuale. Struktura e ngjashme s'provon një komponent ose një rregullim të vetëm: rregullim i përbashkët sugjerohet vetëm kur çdo faqe ka provë për të njëjtin element. Kur shkaku s'mund të vërtetohet, detyra thotë "verifiko" ose mbahet e ndarë. Health Score dhe gjetjet origjinale s'ndryshojnë.</div>
${list.blocked ? blockedWarning(list.blocked, list.measuredOnBlock.length) : ''}
<p class="note">${coverageNote(list.coverage)}</p>
<p class="note">${RANKING_NOTE}</p>
<nav class="quick">${counts.map(([a, c]) => (c ? html`<a href="#zona-${a}">${AREA_LABELS[a]} (${String(c)})</a>` : html`<span class="note">${AREA_LABELS[a]} (0)</span>`))}</nav>
${list.tasks.length ? '' : html`<p class="note">Ky raport s'ka gjetje.</p>`}
${AREAS.map((a) => {
    const ts = list.tasks.filter((t) => t.area === a);
    if (!ts.length) return '';
    return html`<section class="panel ${a === 'quality' ? 'signals' : ''}" id="zona-${a}"><h2>${AREA_LABELS[a]} <span class="note">(${String(ts.length)})</span></h2>
${a === 'quality' ? html`<p class="note">Sinjale për shqyrtim njerëzor, jashtë Health Score. S'janë shkelje të konfirmuara të WCAG dhe s'vlerësojnë autorësinë e përmbajtjes.</p>` : ''}
${a === 'homepage' ? (list.lighthouseSeries ? html`<p class="note">Gjetjet e Lighthouse vijnë nga matja përfaqësuese #${String(list.lighthouseSeries.representativeRun ?? '—')} e një serie me ${String(list.lighthouseSeries.valid)} matje të vlefshme nga ${String(list.lighthouseSeries.planned)} (mobile); variacioni është te paneli i serisë në raport.</p>` : html`<p class="note">Gjetjet e Lighthouse vijnë nga një matje e vetme në mobile; konfirmoji me disa ekzekutime.</p>`) : ''}
${ts.map((t) => taskBlock(file, t, list, ++n))}</section>`;
  })}
${list.measuredOnBlock.length ? html`<section class="panel" id="matur-te-bllokimi"><h2>Matur te përgjigjja e bllokimit — s'janë detyra <span class="note">(${String(list.measuredOnBlock.length)})</span></h2>
<p class="note">Këto gjetje u matën mbi përgjigjen HTTP ${String(list.blocked?.status ?? '')}, jo mbi faqen reale. Mund të jenë të vërteta ose jo për faqen e arritshme; vlerësoji te një audit i ri.</p>
<ul class="plain">${list.measuredOnBlock.map((f) => html`<li><span class="code">${f.code}</span> ${f.message} — <a href="${findingHref(file, f.index)}">gjetja në raport</a></li>`)}</ul></section>` : ''}`;
}

/** Përmbledhje e shkurtër në raport: 5 detyrat e para dhe lidhja te faqja e plotë. */
export function tasksPanel(file: string, list: TaskList): SafeHtml {
  const top = list.tasks.slice(0, 5);
  return html`<section class="panel" id="detyrat"><h2>Detyrat e rekomanduara <span class="note">(${String(list.tasks.length)} detyra)</span></h2>
${top.length ? html`<ol class="plain">${top.map((t) => html`<li>${taskSev(t)} <a href="${tasksHref(file, `#${t.id}`)}">${truncate(t.problem, 110)}</a> <span class="note">· ${BASIS_LABELS[t.basis]} · ${coverageText(t, list.coverage)}</span></li>`)}</ol>` : html`<p class="note">Asnjë gjetje.</p>`}
<p><a href="${tasksHref(file)}"><strong>Hap të gjitha detyrat</strong></a> <span class="note">— të grupuara sipas problemit, me faqet dhe provat për secilën.</span></p></section>`;
}

