import { externalLink, html, truncate, type SafeHtml } from './html.js';
import type { Obj } from './store.js';
import { SEV_LABELS, type IssueView, type Sev } from './model.js';
import { SEVERITIES } from './model.js';
import { DEMO_BANNER, demoBadge, exposureBreakdown, exposureText, n0, STATE_CHIPS } from './views-gsc.js';
import { crawlMatch, overlayNotes, taskExposure, type GscDataset, type GscIndex, type TaskExposure } from './gsc-model.js';
import { AREA_LABELS, BASIS_LABELS, coverageNote, coverageText, RANKING_NOTE, type BlockedResponse, type Task, type TaskArea, type TaskList } from './tasks.js';

/**
 * "Detyrat e rekomanduara": një detyrë për problem, me faqet unike, provat për faqe dhe gjetjet origjinale.
 * Gjithë teksti nga raporti kalon nga html`` (escape); URL-të e jashtme vetëm përmes externalLink (http/https).
 * Rreshti kryesor: problemi, rëndësia, faqet e prekura dhe ekspozimi; shpjegimet dhe provat janë te detajet.
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
${withEv.length ? html`<div class="tablewrap"><table class="keep"><thead><tr><th>Faqja</th><th>Prova</th></tr></thead><tbody>
${withEv.map((e) => html`<tr><td class="url">${externalLink(e.url)}</td><td class="note">${e.items.map((x, n) => html`${n ? html`<br>` : ''}${truncate(x.detected, 220)}${x.expected ? html` <span class="muted">(pritej: ${truncate(x.expected, 80)})</span>` : ''}`)}</td></tr>`)}
</tbody></table></div>` : ''}
${missing.length ? html`<h3>Faqe pa provë individuale në këtë raport (${String(missing.length)})</h3>
<p class="note">Motori i gjeti me të njëjtin problem, por raporti ruan vetëm URL-në e tyre: motori i deritanishëm ruante prova për 5 shembuj për gjetje (raportet e reja i ruajnë për çdo faqe).</p>
<ul class="plain cols">${missing.map((e) => html`<li>${externalLink(e.url)}</li>`)}</ul>` : ''}`;
}

/** Search Console për faqen e detyrave (opsionale): periudha e zgjedhur dhe mënyra e renditjes. */
export interface TasksGsc {
  /** Periudhat e ruajtura që mbulojnë sitin e raportit (nga më e fundit). */
  datasets: GscDataset[];
  selected: GscIndex | null;
  rank: 'technical' | 'gsc';
  report: Obj;
  /** Llogaria Google është e lidhur tani (për tekstin kur s'ka periudhë të ruajtur). */
  connected?: boolean;
}

/** Filtrat e thjeshtë të faqes (GET): seksioni dhe rëndësia. */
export interface TasksFilter {
  area?: string;
  sev?: string;
}

type Exposure = TaskExposure & { demo?: boolean };

/**
 * Renditja me GSC: rëndësia teknike mbetet kriteri i parë; impressions renditin vetëm brenda së njëjtës rëndësi.
 * "Pa të dhëna të kthyera" del pas detyrave me të dhëna (s'trajtohet si 0 i matur); barazimet ruajnë rendin teknik.
 */
export function orderTasks(ts: Task[], exposureOf: Map<string, Exposure>, rank: 'technical' | 'gsc'): Task[] {
  if (rank !== 'gsc' || !exposureOf.size) return ts;
  const imp = (t: Task) => exposureOf.get(t.id)?.metrics?.impressions ?? -1;
  return ts.map((t, i) => ({ t, i })).sort((x, y) => SEVERITIES.indexOf(x.t.severity) - SEVERITIES.indexOf(y.t.severity) || imp(y.t) - imp(x.t) || x.i - y.i).map((x) => x.t);
}

function exposureBadge(e: Exposure): SafeHtml {
  const v = e.metrics ? (e.withData > 1 ? `Σ ${n0(e.metrics.impressions)} impressions (${e.withData} URL)` : `${n0(e.metrics.impressions)} impressions`) : 'pa të dhëna të kthyera';
  return html`${demoBadge(e.demo)}<span class="badge ${e.metrics ? '' : 'b-skipped'}" title="Ekspozimi i matur në GSC">GSC: ${v}</span>`;
}

function taskBlock(file: string, t: Task, list: TaskList, n: number, exposure: Exposure | undefined, propertyTotal: GscDataset['totals']): SafeHtml {
  const byId = new Map(list.tasks.map((x) => [x.id, x]));
  return html`<details class="issue task" id="${t.id}"><summary><span class="note">#${String(n)}</span> ${taskSev(t)} <strong>${truncate(t.problem, 200)}</strong>
<span class="note">${coverageText(t, list.coverage)}</span>${exposure ? html` ${exposureBadge(exposure)}` : ''}</summary>
<div class="body">${t.needsManualReview || !(t.area === 'homepage' && t.basis === 'single-page') ? html`<p class="chips">${t.area === 'homepage' && t.basis === 'single-page' ? '' : html`<span class="badge">${BASIS_LABELS[t.basis]}</span>`}${t.needsManualReview ? html`<span class="badge b-warning">verifiko manualisht</span>` : ''}</p>` : ''}
<dl class="kv">
<dt>Veprimi i propozuar</dt><dd>${t.action}</dd>
<dt>Pse ${t.findings.length > 1 ? 'u bashkuan' : 'kjo detyrë'}</dt><dd>${t.why}</dd>
<dt>Shtrirja</dt><dd>${coverageText(t, list.coverage)}</dd>
${exposure ? html`<dt>Ekspozimi në GSC</dt><dd>${exposureText(exposure)}<div class="note">I matur në Google Search për faqet e detyrës; s'ndryshon rëndësinë teknike.</div>${exposureBreakdown(exposure, propertyTotal)}</dd>` : ''}
<dt>Rëndësia teknike</dt><dd>${SEV_LABELS[t.severity]} · ${confText(t)}${t.needsManualReview ? ' · kërkon verifikim manual' : ''}${t.historicalSeverity ? html`<div class="note">Rëndësia është e trashëguar nga raporti historik, jo vlerësimi aktual i mjetit; verifikoje me një audit të ri.</div>` : ''}</dd>
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

/** Teksti i Search Console kur s'ka periudhë të zgjedhur ose të ruajtur (gjendja e saktë, pa "mjeti s'ka të dhëna"). */
function gscStateText(g: TasksGsc): SafeHtml {
  if (g.datasets.length) return html`Pa periudhë Search Console të zgjedhur: detyrat tregohen pa ekspozim dhe renditja është vetëm teknike.`;
  return g.connected
    ? html`${STATE_CHIPS.connected} S'ka periudhë të ruajtur për një property që mbulon këtë sit. Renditja është vetëm teknike. <a href="/gsc#merr">Merr një periudhë</a> te Search Console.`
    : html`${STATE_CHIPS.disconnected} Search Console s'është lidhur dhe s'ka periudhë të ruajtur për këtë sit. Renditja është vetëm teknike. Për ekspozimin e matur në Google: <a href="/gsc">lidh Search Console</a> dhe merr një periudhë.`;
}

/** Paneli i kontrolleve: periudha GSC, renditja dhe filtrat (një formular GET, pa JavaScript). */
function controlsPanel(file: string, g: TasksGsc | undefined, f: TasksFilter, counts: Record<TaskArea, number>): SafeHtml {
  const d = g?.selected?.dataset;
  const m = g?.selected ? crawlMatch(g.report, g.selected) : null;
  const opt = (v: string, label: string, sel: boolean) => html`<option value="${v}" ${sel ? html`selected` : ''}>${label}</option>`;
  return html`<section class="panel" id="gsc"><h2>${demoBadge(d?.demo)}Filtrat dhe Search Console</h2>
${d?.demo ? DEMO_BANNER : ''}
<form class="filters" method="get" action="/report/${encodeURIComponent(file)}/tasks">
<label>Seksioni<select name="area">${opt('', 'të gjitha', !f.area)}${AREAS.map((a) => opt(a, `${AREA_LABELS[a]} (${counts[a]})`, f.area === a))}</select></label>
<label>Rëndësia<select name="sev">${opt('', 'të gjitha', !f.sev)}${SEVERITIES.map((s) => opt(s, SEV_LABELS[s], f.sev === s))}</select></label>
${g?.datasets.length ? html`<label>Periudha GSC<select name="gsc">${opt('none', 'pa GSC', !d)}${g.datasets.map((x) => opt(x.id, `${x.demo ? 'DEMO · ' : ''}${x.property} · ${x.startDate} – ${x.endDate}`, x.id === d?.id))}</select></label>
<label>Renditja<select name="rank">${opt('technical', 'teknike (parazgjedhje)', g.rank === 'technical')}${opt('gsc', 'teknike, pastaj ekspozimi në GSC', g.rank === 'gsc')}</select></label>` : ''}
<button type="submit">Apliko</button> <a href="/report/${encodeURIComponent(file)}/tasks">Pastro</a></form>
${g ? (d && m ? html`<p class="note">Search Console: property <span class="code">${d.property}</span>, ${d.startDate} – ${d.endDate} (PT), web, final${g.connected ? '' : ' · e ruajtur lokalisht (llogaria e shkëputur)'}. Faqet e kontrolluara: ${String(m.withData.length)} me të dhëna (përputhje e saktë e URL-së), ${String(m.noData.length)} pa të dhëna të kthyera${m.notCovered ? `, ${m.notCovered} jashtë property-t` : ''}. <a href="/gsc/data/${d.id}?report=${encodeURIComponent(file)}">Shiko të dhënat</a></p>
${overlayNotes(g.report, d).map((x) => html`<div class="warnbox">${x}</div>`)}
<p class="note">${g.rank === 'gsc' ? "Renditja: brenda së njëjtës rëndësi teknike, detyrat me më shumë impressions të matura dalin më lart; një detyrë me rëndësi më të ulët s'kalon përpara nga impressions. Impressions s'janë provë e fitimit nga rregullimi." : 'Renditja mbetet teknike; ekspozimi tregohet veç për çdo detyrë.'} Ekspozimi i një detyre me disa URL është shuma e tyre, jo totali unik i property-t. "Pa të dhëna të kthyera" s'do të thotë zero trafik: faqja s'u kthye nga API-ja për këtë periudhë/kufij.</p>` : html`<p class="note">${gscStateText(g)}</p>`) : ''}
</section>`;
}

export function tasksBody(file: string, target: string, list: TaskList, gsc?: TasksGsc, filter: TasksFilter = {}): SafeHtml {
  const back = html`<a href="/report/${encodeURIComponent(file)}">← Raporti</a>`;
  const f: TasksFilter = { area: AREAS.includes(filter.area as TaskArea) ? filter.area : undefined, sev: SEVERITIES.includes(filter.sev as Sev) ? filter.sev : undefined };
  const exposureOf = new Map<string, Exposure>(gsc?.selected ? list.tasks.map((t) => [t.id, { ...taskExposure(gsc.selected!, t.pages), demo: gsc.selected!.dataset.demo === true }]) : []);
  const propertyTotal = gsc?.selected?.dataset.totals ?? null;
  const counts = Object.fromEntries(AREAS.map((a) => [a, list.tasks.filter((t) => t.area === a).length])) as Record<TaskArea, number>;
  const visible = list.tasks.filter((t) => (!f.area || t.area === f.area) && (!f.sev || t.severity === f.sev));
  const findings = list.tasks.reduce((s, t) => s + t.findings.length, 0);
  const hasLighthouse = list.tasks.some((t) => t.area === 'homepage');
  let n = 0;
  return html`<h1>Detyrat e rekomanduara</h1>
<p class="sub">${target} · ${back} · ${String(list.tasks.length)} detyra nga ${String(findings)} gjetje</p>
${list.blocked ? blockedWarning(list.blocked, list.measuredOnBlock.length) : ''}
<div class="warnbox${list.coverage.partial ? ' errors' : ''}" id="mbulimi">${coverageNote(list.coverage)}${hasLighthouse ? html`<br>${list.lighthouseSeries ? `Gjetjet e Lighthouse vijnë nga matja përfaqësuese #${list.lighthouseSeries.representativeRun ?? '—'} e një serie me ${list.lighthouseSeries.valid} matje të vlefshme nga ${list.lighthouseSeries.planned} (mobile); variacioni është te paneli i serisë në raport.` : 'Gjetjet e Lighthouse vijnë nga një matje e vetme në mobile; konfirmoji me disa ekzekutime.'}` : ''}</div>
${controlsPanel(file, gsc, f, counts)}
<details class="panel howto"><summary><h2>Si grupohen dhe renditen detyrat</h2></summary>
<p class="note">Gjetjet bashkohen në një detyrë kur motori i grupoi faqet (strukturë e ngjashme faqeje, ose faqe që i lidh vetë gjetja); faqet dhe provat mbeten individuale. Struktura e ngjashme s'provon një komponent ose një rregullim të vetëm: rregullim i përbashkët sugjerohet vetëm kur çdo faqe ka provë për të njëjtin element. Kur shkaku s'mund të vërtetohet, detyra thotë "verifiko" ose mbahet e ndarë. Health Score dhe gjetjet origjinale s'ndryshojnë.</p>
<p class="note">${RANKING_NOTE}</p></details>
${f.area || f.sev ? html`<p class="note" role="status">Po shfaqen ${String(visible.length)} nga ${String(list.tasks.length)} detyra (filtri: ${f.area ? AREA_LABELS[f.area as TaskArea] : 'të gjitha seksionet'}, ${f.sev ? SEV_LABELS[f.sev as Sev] : 'çdo rëndësi'}). Paralajmërimet më lart vlejnë për gjithë raportin.</p>` : ''}
<nav class="quick" aria-label="Seksionet">${AREAS.map((a) => (counts[a] && (!f.area || f.area === a) ? html`<a href="#zona-${a}">${AREA_LABELS[a]} (${String(visible.filter((t) => t.area === a).length)})</a>` : html`<span class="note">${AREA_LABELS[a]} (${String(f.area && f.area !== a ? 0 : counts[a])})</span>`))}</nav>
${list.tasks.length ? (visible.length ? '' : html`<p class="note">Asnjë detyrë s'përputhet me filtrin.</p>`) : html`<p class="note">Ky raport s'ka gjetje.</p>`}
${AREAS.map((a) => {
    const ts = orderTasks(visible.filter((t) => t.area === a), exposureOf, gsc?.rank ?? 'technical');
    if (!ts.length) return '';
    return html`<section class="panel ${a === 'quality' ? 'signals' : ''}" id="zona-${a}"><h2>${AREA_LABELS[a]} <span class="note">(${String(ts.length)})</span></h2>
${a === 'quality' ? html`<p class="note">Sinjale për shqyrtim njerëzor, jashtë Health Score. S'janë shkelje të konfirmuara të WCAG dhe s'vlerësojnë autorësinë e përmbajtjes.</p>` : ''}
${ts.map((t) => taskBlock(file, t, list, ++n, exposureOf.get(t.id), propertyTotal))}</section>`;
  })}
${list.measuredOnBlock.length ? html`<section class="panel" id="matur-te-bllokimi"><h2>Matur te përgjigjja e bllokimit — s'janë detyra <span class="note">(${String(list.measuredOnBlock.length)})</span></h2>
<p class="note">Këto gjetje u matën mbi përgjigjen HTTP ${String(list.blocked?.status ?? '')}, jo mbi faqen reale. Mund të jenë të vërteta ose jo për faqen e arritshme; vlerësoji te një audit i ri.</p>
<ul class="plain">${list.measuredOnBlock.map((x) => html`<li><span class="code">${x.code}</span> ${x.message} — <a href="${findingHref(file, x.index)}">gjetja në raport</a></li>`)}</ul></section>` : ''}`;
}

/** Përmbledhje e shkurtër në raport: 5 detyrat e para dhe lidhja te faqja e plotë. */
export function tasksPanel(file: string, list: TaskList): SafeHtml {
  const top = list.tasks.slice(0, 5);
  return html`<section class="panel" id="detyrat"><h2>Detyrat e rekomanduara <span class="note">(${String(list.tasks.length)} detyra)</span></h2>
${top.length ? html`<ol class="plain">${top.map((t) => html`<li>${taskSev(t)} <a href="${tasksHref(file, `#${t.id}`)}">${truncate(t.problem, 110)}</a> <span class="note">· ${BASIS_LABELS[t.basis]} · ${coverageText(t, list.coverage)}</span></li>`)}</ol>` : html`<p class="note">Asnjë gjetje.</p>`}
<p><a href="${tasksHref(file)}"><strong>Hap të gjitha detyrat</strong></a> <span class="note">— të grupuara sipas problemit, me faqet dhe provat për secilën.</span></p></section>`;
}
