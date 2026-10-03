import { externalLink, html, truncate, type SafeHtml } from './html.js';
import { MAX_PAGES_PER_QUERY, ROW_LIMIT, type GscSite } from './gsc-api.js';
import { compareDatasets, PERIOD_PRESETS, type CrawlMatch, type GscDataset, type Metrics, type TaskExposure } from './gsc-model.js';
import type { Protection, RevokeRecord } from './gsc-store.js';

/**
 * Pamjet e Google Search Console (vetëm lexim). Asnjë token/sekret s'shfaqet; client_id del i shkurtuar.
 * Të dhënat e GSC s'ndryshojnë Health Score as severity-n: tregohen veç si "ekspozim i matur".
 * Pa JavaScript (CSP script-src 'none'): filtrat dhe faqet e tabelave janë formularë/lidhje GET.
 */

export interface GscViewState {
  csrf: string;
  /** Shtegu i ruajtjes për t'u shfaqur (pa emrin e përdoruesit, p.sh. %LOCALAPPDATA%\SEO Tool\gsc). */
  dir: string;
  /** Dashboard-i me Google të simuluar (demonstrim): çdo faqe GSC e thotë dukshëm. */
  demo?: boolean;
  protection: Protection;
  client?: { clientId: string; projectId: string };
  token?: { connectedAt: string; scope: string };
  sites?: GscSite[];
  sitesError?: string;
  datasets: GscDataset[];
  /** Përgjigjja e fundit e Google për revokimin (nga shkëputja e fundit). */
  lastRevoke?: RevokeRecord;
  message?: string;
  error?: string;
}

const token = (csrf: string) => html`<input type="hidden" name="token" value="${csrf}">`;
const PROTECTION_TEXT: Record<Protection, string> = {
  dpapi: 'enkriptuar me Windows DPAPI (vetëm ky përdorues Windows në këtë kompjuter mund t\'i lexojë)',
  'file-permissions': 'pa enkriptim; vetëm leje skedari 0600 (sistem jo-Windows)',
  memory: 'vetëm në memorie (teste)',
};

/** Numër i plotë me ndarës mijëshesh (hapësirë), i njëjtë për çdo madhësi (sq-AL s'grupon numrat 4-shifrorë). */
export const n0 = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const pos = (v: number) => v.toFixed(1);
const utc = (iso: string, len = 16) => `${iso.slice(0, len).replace('T', ' ')} UTC`;

/** Etiketa e dukshme për demonstrimin: Google i simuluar dhe të dhëna fiktive. */
export const DEMO_BANNER: SafeHtml = html`<div class="warnbox errors"><strong>DEMO</strong>: Google i simuluar dhe të dhëna fiktive (sit demonstrues), jo nga Search Console. Asnjë llogari reale s'është lidhur.</div>`;
export const demoBadge = (on: boolean | undefined): SafeHtml | '' => (on ? html`<span class="badge b-fail">Demo</span> ` : '');

/** Gjendjet e dallueshme të GSC (etiketë e njëjtë kudo). */
export const STATE_CHIPS = {
  connected: html`<span class="badge b-complete">● E lidhur</span>`,
  disconnected: html`<span class="badge b-skipped">○ E shkëputur</span>`,
  noClient: html`<span class="badge b-skipped">○ Pa klient OAuth</span>`,
  local: (n: number) => html`<span class="badge b-info">${String(n)} ${n === 1 ? 'periudhë e ruajtur' : 'periudha të ruajtura'} lokalisht</span>`,
  noData: html`<span class="badge b-warning">pa të dhëna të kthyera</span>`,
};

function metricsCells(m: Metrics): SafeHtml {
  return html`<td class="num">${n0(m.clicks)}</td><td class="num">${n0(m.impressions)}</td><td class="num">${pct(m.ctr)}</td><td class="num">${pos(m.position)}</td>`;
}

/** Katër kartat e totalit; pa rresht nga API-ja → "pa të dhëna të kthyera" (jo 0). */
export function metricCards(m: Metrics | null): SafeHtml {
  const labels = ['Klikime', 'Impressions', 'CTR', 'Pozicioni mesatar'];
  const values = m ? [n0(m.clicks), n0(m.impressions), pct(m.ctr), pos(m.position)] : null;
  return html`<div class="cards">${labels.map((l, i) => html`<div class="card"><div class="l">${l}</div>${values ? html`<div class="v">${values[i]!}</div>` : html`<div class="v none">pa të dhëna të kthyera</div>`}</div>`)}</div>`;
}

const SETUP: SafeHtml = html`<ol class="plain steps">
<li>Hap <a class="ext" href="https://console.cloud.google.com/" rel="noreferrer" target="_blank">Google Cloud Console</a> me llogarinë që ka akses në Search Console dhe krijo një projekt (p.sh. "SEO Tool lokal").</li>
<li><strong>APIs &amp; Services → Library</strong>: aktivizo <strong>Google Search Console API</strong>.</li>
<li><strong>Google Auth Platform</strong> (OAuth consent screen): Audience <strong>External</strong>, statusi <strong>Testing</strong>; te "Test users" shto adresën tënde. Te "Data access" shto vetëm scope-in <span class="code">…/auth/webmasters.readonly</span>.</li>
<li><strong>Clients → Create client</strong>: tipi <strong>Desktop app</strong>. Shkarko JSON-in (<span class="code">client_secret_….json</span>).</li>
<li>Hape JSON-in me Notepad, kopjo gjithë përmbajtjen dhe ngjite më poshtë → <strong>Importo klientin</strong>. Pastaj fshije skedarin e shkarkuar ose ruaje në vend të sigurt.</li>
<li>Kliko <strong>Lidh llogarinë Google</strong> → <strong>Vazhdo te Google</strong>, zgjidh llogarinë dhe lejo vetëm "View Search Console data". Për projektin tënd në Testing, Google mund të paralajmërojë "Google hasn't verified this app" → Continue (aplikacioni je ti).</li>
<li>Në statusin Testing, Google e skadon autorizimin pas <strong>7 ditësh</strong>: atëherë lidhu sërish.</li>
</ol>`;

function revokeText(r: RevokeRecord): SafeHtml {
  const detail = r.httpStatus ? `HTTP ${r.httpStatus}${r.error ? ` ${r.error}` : ''}` : r.error === 'network' ? "Google s'u arrit" : 'pa përgjigje';
  return r.confirmed
    ? html`${utc(r.at)}: Google konfirmoi revokimin (${detail}).`
    : html`${utc(r.at)}: revokimi <strong>s'u konfirmua</strong> (${detail}); token-i lokal u fshi. Kontrollo aksesin te myaccount.google.com/permissions.`;
}

export function gscBody(s: GscViewState): SafeHtml {
  const connected = !!s.token;
  const conn = connected ? STATE_CHIPS.connected : s.client ? STATE_CHIPS.disconnected : STATE_CHIPS.noClient;
  return html`<h1>${demoBadge(s.demo)}Google Search Console</h1>
${s.demo ? DEMO_BANNER : ''}
<p class="chips">${conn}${s.datasets.length ? STATE_CHIPS.local(s.datasets.length) : ''}</p>
<p class="sub">Vetëm lexim (scope <span class="code">webmasters.readonly</span>). Të dhënat merren direkt nga Google në këtë kompjuter; s'dërgohen askund tjetër dhe s'ndryshojnë Health Score ose rëndësinë e gjetjeve.</p>
${s.message ? html`<div class="warnbox" role="status">${s.message}</div>` : ''}
${s.error ? html`<div class="warnbox errors" role="alert">${s.error}</div>` : ''}
${connected ? fetchPanel(s) : ''}
${datasetsPanel(s.datasets, connected)}
<div class="grid">
<section class="panel"><h2>Gjendja</h2><dl class="kv">
<dt>Klienti OAuth</dt><dd>${s.client ? html`importuar: <span class="code">${s.client.clientId}</span>${s.client.projectId ? html` · projekti <span class="code">${s.client.projectId}</span>` : ''}` : html`<span class="miss">s'është importuar</span>`}</dd>
<dt>Llogaria</dt><dd>${connected ? html`${STATE_CHIPS.connected} që nga ${utc(s.token!.connectedAt)}` : STATE_CHIPS.disconnected}</dd>
${s.lastRevoke ? html`<dt>Shkëputja e fundit</dt><dd>${revokeText(s.lastRevoke)}</dd>` : ''}
<dt>Ruajtja lokale</dt><dd><span class="code">${s.dir}</span><div class="note">Sekretet: ${PROTECTION_TEXT[s.protection]}. Jashtë Git dhe jashtë dosjes së raporteve.</div></dd>
<dt>Të dhëna të ruajtura</dt><dd>${String(s.datasets.length)} periudha${s.datasets.length ? html` · <a href="#periudhat">shiko</a>` : ''}</dd>
</dl>
<div class="row-actions">
${s.client && !connected ? html`<form class="inline" method="post" action="/gsc/connect">${token(s.csrf)}<button type="submit">Lidh llogarinë Google</button></form>` : ''}
${connected ? html`<form class="inline" method="post" action="/gsc/disconnect">${token(s.csrf)}<button type="submit" class="danger">Shkëput llogarinë</button></form>` : ''}
${s.datasets.length ? html`<form class="inline" method="post" action="/gsc/delete-data">${token(s.csrf)}<button type="submit" class="secondary">Fshi të dhënat e GSC</button></form>` : ''}
${s.client || connected || s.datasets.length ? html`<form class="inline" method="post" action="/gsc/delete-all">${token(s.csrf)}<button type="submit" class="secondary">Fshi gjithçka të GSC</button></form>` : ''}
</div>
<p class="note">"Shkëput" i kërkon Google-it revokimin e token-it dhe e fshin token-in lokalisht; mesazhi pas veprimit thotë nëse Google e konfirmoi revokimin. Periudhat e ruajtura mbeten dhe hapen pa lidhje. "Fshi të dhënat" heq periudhat e ruajtura. "Fshi gjithçka" heq edhe klientin OAuth (me të njëjtën kërkesë revokimi, nëse ka token).</p></section>

<section class="panel"><details class="setup" ${s.client ? '' : html`open`}><summary><h2>Konfigurimi (një herë)</h2>${s.client ? html` <span class="note">klienti është importuar; hape për ta zëvendësuar</span>` : ''}</summary>${SETUP}
<form method="post" action="/gsc/client">${token(s.csrf)}
<label class="field">Përmbajtja e client_secret_….json (Desktop app)<textarea name="json" rows="5" maxlength="4000" spellcheck="false" autocomplete="off"></textarea></label>
<button type="submit">Importo klientin</button></form></details></section>
</div>`;
}

function fetchPanel(s: GscViewState): SafeHtml | '' {
  if (s.sitesError) return html`<section class="panel"><h2>Property-t</h2><div class="warnbox errors">${s.sitesError}</div></section>`;
  const sites = s.sites ?? [];
  return html`<section class="panel" id="merr"><h2>Merr të dhëna nga Search Console</h2>
${sites.length ? html`<form class="filters" method="post" action="/gsc/fetch">${token(s.csrf)}
<label>Property<select name="property">${sites.map((x) => html`<option value="${x.siteUrl}">${x.siteUrl} (${x.permissionLevel})</option>`)}</select></label>
<label>Periudha<select name="preset">${PERIOD_PRESETS.map((d) => html`<option value="${String(d)}" ${d === 28 ? html`selected` : ''}>${String(d)} ditët e fundit me të dhëna përfundimtare</option>`)}<option value="custom">E zgjedhur (më poshtë)</option></select></label>
<label>Nga (YYYY-MM-DD)<input type="text" name="start" maxlength="10" placeholder="2026-09-01"></label>
<label>Deri (YYYY-MM-DD)<input type="text" name="end" maxlength="10" placeholder="2026-09-28"></label>
<button type="submit">Merr të dhënat</button></form>
<p class="note">Kërkesa: lloji "web", gjendja <strong>final</strong> (pa të dhënat e paplota të ditëve të fundit), pa filtra vendi/pajisjeje/query. Faqet dhe faqe+query merren me deri në ${n0(MAX_PAGES_PER_QUERY * ROW_LIMIT)} rreshta secila (${String(MAX_PAGES_PER_QUERY)} × ${n0(ROW_LIMIT)}, kufiri i API-së për kërkesë); data e fundit me të dhëna përfundimtare gjendet automatikisht.</p>`
    : html`<p class="note">Llogaria s'ka asnjë property në Search Console (ose s'ka leje për to).</p>`}
</section>`;
}

function datasetsPanel(list: GscDataset[], connected: boolean): SafeHtml | '' {
  if (!list.length) return '';
  const sorted = [...list].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  return html`<section class="panel" id="periudhat"><h2>Të dhëna të ruajtura lokalisht <span class="note">(${String(list.length)} periudha)</span></h2>
<p class="note">${connected ? 'Të marra më parë nga Search Console dhe të ruajtura në këtë kompjuter.' : "Llogaria s'është e lidhur: këto periudha u morën më parë dhe hapen pa lidhje; s'përditësohen derisa të lidhesh sërish."}</p>
<div class="tablewrap"><table class="keep"><thead><tr><th>Property</th><th>Periudha</th><th>Marrë më</th><th class="num">Klikime</th><th class="num">Impressions</th><th class="num">Faqe</th><th>Krahasimi me të mëparshmen</th><th><span class="sr">Veprimi</span></th></tr></thead><tbody>
${sorted.map((d) => {
    const prev = sorted.find((x) => x !== d && x.property === d.property && x.endDate < d.startDate);
    const cmp = prev ? compareDatasets(prev, d) : null;
    return html`<tr><td>${demoBadge(d.demo)}<span class="code">${d.property}</span></td><td class="nowrap">${d.startDate} – ${d.endDate}</td><td class="nowrap">${utc(d.fetchedAt)}</td>
<td class="num">${d.totals ? n0(d.totals.clicks) : html`<span class="note">pa të dhëna</span>`}</td><td class="num">${d.totals ? n0(d.totals.impressions) : html`<span class="note">pa të dhëna</span>`}</td><td class="num">${String(d.pages.length)}${d.pagesTruncated ? '+' : ''}</td>
<td class="note">${cmp ? (cmp.comparable ? 'krahasohet' : `s'krahasohet: ${cmp.reasons.join('; ')}`) : '—'}</td><td><a href="/gsc/data/${d.id}">Hap<span class="sr"> ${d.property} ${d.startDate} – ${d.endDate}</span></a></td></tr>`;
  })}
</tbody></table></div></section>`;
}

/** Faqja "Vazhdo te Google": lidhje e zakonshme (CSP form-action s'lejon ridrejtim të formularit jashtë). */
export function connectBody(authUrl: string, demo = false): SafeHtml {
  return html`<h1>${demoBadge(demo)}Lidhja me Google</h1>
${demo ? DEMO_BANNER : ''}
<div class="panel"><p>Do të hapet faqja e Google për të lejuar <strong>vetëm leximin</strong> e të dhënave të Search Console (<span class="code">webmasters.readonly</span>). Pas pëlqimit, Google të kthen këtu (<span class="code">127.0.0.1</span>).</p>
<p><a class="button" href="${authUrl}" rel="noreferrer">Vazhdo te Google →</a></p>
<p class="note">Lidhja vlen 10 minuta dhe një herë. Nëse e mbyll, nise sërish nga faqja Search Console.</p></div>`;
}

export interface DatasetQuery {
  page?: string;
  query?: string;
  /** Faqja e tabelës së faqeve / të kërkimeve (nga 1) dhe rreshta për faqe. */
  pp?: string;
  qp?: string;
  n?: string;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** Copa e tabelës sipas faqes, me numrat e saktë të rreshtave të shfaqur. */
export function paginate<T>(rows: T[], pageParam: string | undefined, size: number): { slice: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1));
  const from = rows.length ? (page - 1) * size + 1 : 0;
  const to = Math.min(rows.length, page * size);
  return { slice: rows.slice(Math.max(0, from - 1), to), page, pages, from, to };
}

/** "API ktheu N rreshta · pas filtrit M · po shfaqen a–b": s'nënkupton kurrë që API ktheu gjithçka. */
export function countText(returned: number, filtered: number, isFiltered: boolean, from: number, to: number): string {
  return `API ktheu ${n0(returned)} rreshta${isFiltered ? ` · pas filtrit ${n0(filtered)}` : ''} · po shfaqen ${filtered ? `${n0(from)}–${n0(to)}` : '0'}`;
}

/** Pamja e një periudhe: kreu (property, periudha, gjendja), kartat e totalit, faqet dhe kërkimet me filtra dhe faqe. */
export function datasetBody(d: GscDataset, q: DatasetQuery, match?: { report: string; m: CrawlMatch }, connected = false): SafeHtml {
  const pf = (q.page ?? '').trim().toLowerCase();
  const qf = (q.query ?? '').trim().toLowerCase();
  const size = PAGE_SIZES.find((s) => String(s) === q.n) ?? DEFAULT_PAGE_SIZE;
  const pagesAll = d.pages.filter((p) => !pf || p.page.toLowerCase().includes(pf)).sort((a, b) => b.impressions - a.impressions);
  const queriesAll = d.queries.filter((x) => (!pf || x.page.toLowerCase().includes(pf)) && (!qf || x.query.toLowerCase().includes(qf))).sort((a, b) => b.impressions - a.impressions);
  const P = paginate(pagesAll, q.pp, size);
  const Q = paginate(queriesAll, q.qp, size);
  const days = Math.round((Date.parse(`${d.endDate}T00:00:00Z`) - Date.parse(`${d.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  const base: Record<string, string> = { report: match?.report ?? '', page: q.page ?? '', query: q.query ?? '', n: size === DEFAULT_PAGE_SIZE ? '' : String(size), pp: String(P.page), qp: String(Q.page) };
  const href = (over: Record<string, string>, hash: string) => {
    const p = new URLSearchParams(Object.entries({ ...base, ...over }).filter(([k, v]) => v !== '' && !((k === 'pp' || k === 'qp') && v === '1')));
    const s = p.toString();
    return `/gsc/data/${d.id}${s ? `?${s}` : ''}${hash}`;
  };
  const pager = (pg: { page: number; pages: number }, key: 'pp' | 'qp', hash: string, label: string) => (pg.pages > 1
    ? html`<nav class="pager" aria-label="${label}">${pg.page > 1 ? html`<a href="${href({ [key]: String(pg.page - 1) }, hash)}">← Më parë</a>` : html`<span class="note">← Më parë</span>`}<span class="note">faqja ${String(pg.page)} nga ${String(pg.pages)}</span>${pg.page < pg.pages ? html`<a href="${href({ [key]: String(pg.page + 1) }, hash)}">Më pas →</a>` : html`<span class="note">Më pas →</span>`}</nav>`
    : '');
  return html`<p class="sub"><a href="/gsc">← Search Console</a></p>
<h1>${demoBadge(d.demo)}<span class="code big">${d.property}</span></h1>
${d.demo ? DEMO_BANNER : ''}
<p class="chips"><span class="badge">${d.startDate} – ${d.endDate} · ${String(days)} ditë (PT)</span><span class="badge">web · final</span>${connected ? STATE_CHIPS.connected : STATE_CHIPS.disconnected}<span class="badge b-info">e ruajtur lokalisht · ${utc(d.fetchedAt)}</span>${d.totals ? '' : STATE_CHIPS.noData}</p>
<h2 class="cards-title">Totali i property-t</h2>
${metricCards(d.totals)}
<p class="note">Nga një kërkesë agregate më vete (pa dimensione, sipas property-t), jo nga mbledhja e rreshtave të faqeve ose kërkimeve: një kërkim mund të shfaqë disa faqe, dhe rreshtat mund të jenë të kufizuar ose pa kërkimet anonime.${d.totals ? '' : " \"Pa të dhëna të kthyera\" s'është e njëjtë me 0 klikime."}</p>

<details class="panel meta"><summary><h2>Çfarë përmbajnë këto të dhëna</h2> <span class="note">property, filtrat, data e fundit, kufijtë</span></summary><dl class="kv">
<dt>Property</dt><dd><span class="code">${d.property}</span> (${d.propertyType === 'domain' ? 'domain: të gjitha protokollet dhe nën-domenet' : 'URL-prefix: vetëm URL-të nën këtë prefiks'}) · leja ${d.permissionLevel}</dd>
<dt>Periudha</dt><dd>${d.startDate} – ${d.endDate} (${String(days)} ditë, ora e Paqësorit/PT)</dd>
<dt>Data e fundit me të dhëna</dt><dd>${d.latestFinalDate ?? html`<span class="miss">s'u gjet (asnjë ditë me të dhëna përfundimtare në 10 ditët e fundit)</span>`}</dd>
<dt>Filtrat</dt><dd>lloji: web · gjendja: final · ${d.filters.length ? d.filters.join(', ') : 'pa filtra vendi/pajisjeje/query'}</dd>
<dt>Marrë më</dt><dd>${utc(d.fetchedAt, 19)} · ${String(d.requests)} kërkesa API</dd>
</dl>
<div class="warnbox"><strong>Kufijtë:</strong> API-ja kthen deri në 25 000 rreshta për kërkesë dhe ekspozon deri në 50 000 rreshta në ditë për çdo lloj kërkimi, të renditur sipas klikimeve; me dimensionet faqe/query, një pjesë e të dhënave hiqet. Kërkimet anonime (privatësia) s'shfaqen te tabela e kërkimeve, prandaj shuma e tyre është më e vogël se totali.${d.pagesTruncated ? ` Lista e faqeve u kufizua te ${d.pages.length} rreshta.` : ''}${d.queriesTruncated ? ` Lista faqe+query u kufizua te ${d.queries.length} rreshta.` : ''} Një URL që s'është në listë shfaqet si "pa të dhëna të kthyera", jo si zero trafik.</div></details>
${match ? html`<section class="panel"><h2>Faqet e kontrolluara nga auditi</h2><p class="note">Raporti <span class="code">${match.report}</span>: ${String(match.m.withData.length)} faqe me të dhëna (përputhje e saktë e URL-së përfundimtare), ${String(match.m.noData.length)} pa të dhëna të kthyera${match.m.notCovered ? `, ${match.m.notCovered} jashtë property-t` : ''}.${match.m.redirectSources.length ? ` ${match.m.redirectSources.length} URL të GSC ridrejtojnë (sipas crawl-it) te faqe të kontrolluara; s'u bashkuan me to.` : ''}</p></section>` : ''}

<form class="filters panel" method="get" action="/gsc/data/${d.id}" role="search" aria-label="Filtro faqet dhe kërkimet">
${match ? html`<input type="hidden" name="report" value="${match.report}">` : ''}
<label>Faqja përmban<input type="search" name="page" value="${q.page ?? ''}" maxlength="200"></label>
<label>Kërkimi përmban<input type="search" name="query" value="${q.query ?? ''}" maxlength="200"></label>
<label>Rreshta për faqe<select name="n">${PAGE_SIZES.map((s) => html`<option value="${String(s)}" ${s === size ? html`selected` : ''}>${String(s)}</option>`)}</select></label>
<button type="submit">Filtro</button> <a href="${href({ page: '', query: '', n: '', pp: '1', qp: '1' }, '')}">Pastro filtrat</a></form>

<section class="panel" id="faqet"><h2>Faqet</h2>
<p class="note counts">${countText(d.pages.length, pagesAll.length, !!pf, P.from, P.to)}${d.pagesTruncated ? html` <span class="badge b-warning">lista e kufizuar nga API</span>` : ''}</p>
<div class="tablewrap"><table class="keep"><thead><tr><th>Faqja</th><th class="num">Klikime</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Poz. mes.</th></tr></thead><tbody>
${P.slice.map((p) => html`<tr><td class="url">${externalLink(p.page)}</td>${metricsCells(p)}</tr>`)}
</tbody></table></div>${pager(P, 'pp', '#faqet', 'Faqet e tabelës së faqeve')}</section>

<section class="panel" id="kerkimet"><h2>Kërkimet sipas faqes</h2>
<p class="note counts">${countText(d.queries.length, queriesAll.length, !!(pf || qf), Q.from, Q.to)}${d.queriesTruncated ? html` <span class="badge b-warning">lista e kufizuar nga API</span>` : ''}</p>
<p class="note">S'janë të gjitha kërkimet: API-ja s'kthen kërkimet anonime dhe kufizon rreshtat. Renditja këtu: sipas impressions.</p>
<div class="tablewrap"><table class="keep"><thead><tr><th>Kërkimi</th><th>Faqja</th><th class="num">Klikime</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Poz. mes.</th></tr></thead><tbody>
${Q.slice.map((x) => html`<tr><td>${truncate(x.query, 80)}</td><td class="note url">${truncate(x.page, 70)}</td>${metricsCells(x)}</tr>`)}
</tbody></table></div>${pager(Q, 'qp', '#kerkimet', 'Faqet e tabelës së kërkimeve')}</section>`;
}

/** Rreshti i ekspozimit për një detyrë (te "Detyrat e rekomanduara"). */
export function exposureText(e: TaskExposure): SafeHtml {
  const parts: SafeHtml[] = [];
  if (e.metrics) parts.push(html`<strong>${n0(e.metrics.impressions)}</strong> impressions · ${n0(e.metrics.clicks)} klikime · CTR ${pct(e.metrics.ctr)} · poz. ${pos(e.metrics.position)} <span class="note">(${e.withData > 1 ? `shuma e ${e.withData} URL-ve me të dhëna` : '1 URL me të dhëna'})</span>`);
  if (e.noData) parts.push(html`<span class="note">${String(e.noData)} URL: pa të dhëna të kthyera</span>`);
  if (e.notCovered) parts.push(html`<span class="note">${String(e.notCovered)} URL jashtë property-t</span>`);
  return parts.length ? html`${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}` : html`<span class="note">pa URL</span>`;
}

/** Zbërthimi i shumës: cilat URL dhe me çfarë vlerash e formojnë ekspozimin e detyrës. */
export function exposureBreakdown(e: TaskExposure, propertyTotal: Metrics | null): SafeHtml | '' {
  const rows = e.pages.filter((p) => p.status === 'data' && p.row).sort((a, b) => b.row!.impressions - a.row!.impressions);
  if (!rows.length || !e.metrics) return '';
  return html`<p class="note">${rows.length > 1 ? `Shuma e impressions të ${rows.length} URL-ve të detyrës që kanë të dhëna. ` : ''}S'është totali unik i property-t${propertyTotal ? ` (${n0(propertyTotal.impressions)} impressions për periudhën)` : ''}: një kërkim mund të shfaqë disa faqe, prandaj shuma e faqeve mund ta kalojë totalin. Mat faqet e listuara në detyrë; kur detyra lidhet me një URL tjetër (p.sh. URL që ridrejton, e linkuar nga këto faqe), s'mat trafikun e asaj URL-je.</p>
<div class="tablewrap"><table class="keep"><thead><tr><th>URL</th><th class="num">Klikime</th><th class="num">Impressions</th><th class="num">CTR</th><th class="num">Poz. mes.</th></tr></thead><tbody>
${rows.map((p) => html`<tr><td class="url">${externalLink(p.url)}</td>${metricsCells(p.row!)}</tr>`)}
${rows.length > 1 ? html`<tr class="sum"><td>Shuma (${String(rows.length)} URL)</td>${metricsCells(e.metrics)}</tr>` : ''}
</tbody></table></div>`;
}
