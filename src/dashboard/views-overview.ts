import { html, truncate, type SafeHtml } from './html.js';
import { SEV_LABELS } from './model.js';
import { arr, num, obj, str, type Obj, type ReportSummary } from './store.js';
import { coverageText, type Task, type TaskList } from './tasks.js';
import { crawlMatch, indexDataset, overlayNotes, taskExposure, type GscDataset } from './gsc-model.js';
import { n0, pct, pos } from './views-gsc.js';
import { tasksHref } from './views-tasks.js';
import { lhRows, lhSourceText } from './views-lh.js';
import { fmtDate, layout } from './views.js';

/**
 * Përmbledhja (faqja kryesore): për një sit, nga raporti i tij më i fundit — Health i faqes hyrëse, mbulimi i
 * crawl-it, Search Console (me periudhën) dhe detyrat. Çdo numër ka etiketën dhe burimin e vet; s'ka grafikë
 * apo prirje (s'kemi seri kohore), dhe "pa të dhëna të kthyera" s'paraqitet si zero.
 */

export interface OverviewInput {
  /** Sitet me raport URL (nga më i fundit). */
  sites: { key: string; target: string }[];
  site?: { key: string; target: string };
  latest?: { summary: ReportSummary; report: Obj };
  tasks?: TaskList;
  gsc?: { dataset: GscDataset | null; connected: boolean };
  /** Raporte dosjeje/repo (s'kanë Health/GSC), vetëm për lidhje. */
  otherReports: number;
}

const pctBar = (v: number, warn = false) => html`<div class="meter" aria-hidden="true"><i class="w${String(Math.max(0, Math.min(100, Math.round(v / 5) * 5)))}${warn ? ' warn' : ''}"></i></div>`;
const sevBadge = (t: Task) => html`<span class="badge sev-${t.severity}">${SEV_LABELS[t.severity]}</span>`;
const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}` || '/';
  } catch {
    return u;
  }
};

/** Kërkimet e periudhës, të bashkuara sipas tekstit (një kërkim mund të shfaqë disa faqe). */
function topQueries(ds: GscDataset, n: number) {
  const m = new Map<string, { query: string; clicks: number; impressions: number; posW: number }>();
  for (const q of ds.queries) {
    const e = m.get(q.query) ?? { query: q.query, clicks: 0, impressions: 0, posW: 0 };
    e.clicks += q.clicks;
    e.impressions += q.impressions;
    e.posW += q.position * q.impressions;
    m.set(q.query, e);
  }
  return [...m.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, n).map((e) => ({ ...e, position: e.impressions ? e.posW / e.impressions : 0 }));
}

export function overviewView(o: OverviewInput): string {
  if (!o.site || !o.latest) {
    return layout('Përmbledhje', html`<p class="crumb">Përmbledhje</p><h1>SEO Tool</h1>
<section class="panel empty"><h2>Ende pa raport auditi për një sit</h2><p class="note">Përmbledhja ndërtohet nga raporti i fundit i auditit të një URL-je: Health i faqes hyrëse, mbulimi i crawl-it, detyrat dhe, kur e lidh, Search Console.</p>
<p><a class="btn" href="/audit">+ Nis auditin e parë</a></p>${o.otherReports ? html`<p class="note"><a href="/reports">${String(o.otherReports)} raporte dosjeje/repo</a> janë te Raportet.</p>` : ''}</section>`, undefined, 'overview');
  }
  const { summary: s, report: r } = o.latest;
  const health = obj(r.health);
  const hScore = num(health.score);
  const crawl = obj(obj(r.site).crawl);
  const checked = num(crawl.pagesAnalyzed);
  const discovered = num(crawl.urlsDiscovered);
  const hasCrawl = !!r.site && obj(r.site).status !== 'skipped' && checked !== null;
  const partial = hasCrawl && (crawl.truncated === true || (discovered ?? 0) > (checked ?? 0));
  const tasks = o.tasks;
  const ds = o.gsc?.dataset ?? null;
  const ix = ds ? indexDataset(ds) : null;
  const m = ix ? crawlMatch(r, ix) : null;
  const reportHref = `/report/${encodeURIComponent(s.file)}`;
  const top = tasks?.tasks.slice(0, 3) ?? [];
  const lhSeries = obj(obj(r.lighthouse).series);
  const lhRuns = num(lhSeries.planned) ?? 1;
  const period = ds ? `${ds.startDate} – ${ds.endDate}` : '';

  // --- katër treguesit: secili me fushën e vet (faqja hyrëse / siti / property GSC / faqet e kontrolluara) ---
  // Numri dhe fusha (p.sh. "Vetëm faqja hyrëse", "I pjesshëm") janë gjithmonë të dukshme; një rresht i shkurtër
  // poshtë numrit; sqarimi i gjatë shfaqet në desktop dhe në ekran të ngushtë kalon te "Sqarim" (details).
  const hStatus = str(health.status);
  const healthCard =
    hScore === null
      ? kpi('Health Score', html`<span class="scope">Vetëm faqja hyrëse</span>`, html`<p class="v none">s'ka pikë</p>`, 'Pa pikë në këtë raport', '')
      : kpi('Health Score', html`<span class="scope">Vetëm faqja hyrëse</span>`, html`<p class="v">${String(hScore)}<small>/100</small></p>${pctBar(hScore, hScore < 80)}`, HEALTH_LABELS[hStatus] ?? (hStatus || '—'), "S'është pikë e gjithë sitit: vlen vetëm për faqen hyrëse; sinjalet e cilësisë dhe të biznesit janë jashtë saj.");
  const crawlCard = hasCrawl
    ? kpi(
        'Crawl i sitit',
        html`<span class="scope${partial ? ' warn' : ''}">${partial ? 'I pjesshëm' : 'Brenda kufijve'}</span>`,
        html`<p class="v">${String(checked)}<small>/${String(discovered ?? '—')} URL</small></p>${pctBar(discovered ? ((checked ?? 0) / discovered) * 100 : 100, partial)}`,
        partial ? `${checked} nga ${discovered} URL të zbuluara` : 'Të gjitha u kontrolluan',
        partial ? `U kontrolluan ${checked} nga ${discovered} URL të zbuluara (kufiri i crawl-it); numrat e sitit vlejnë vetëm për faqet e kontrolluara.` : '',
      )
    : kpi('Crawl i sitit', html`<span class="scope">Pa crawl</span>`, html`<p class="v none">pa crawl</p>`, 'Vetëm faqja hyrëse', '');
  const days = ds ? Math.round((Date.parse(ds.endDate) - Date.parse(ds.startDate)) / 86_400_000) + 1 : 0;
  const gscScope = html`<span class="scope">${ds ? html`GSC · <span class="pfull">${period}</span><span class="pshort">${String(days)} ditë</span>` : 'Search Console'}</span>`;
  const gscCard = !ds
    ? kpi('Klikime në Google', gscScope, html`<p class="v none">pa periudhë GSC</p>`, o.gsc?.connected ? html`<a href="/gsc#merr">Merr një periudhë</a>` : html`<a href="/gsc">Lidh Search Console</a>`, 'Search Console lidhet vetëm për lexim; pa periudhë, detyrat renditen vetëm teknikisht.')
    : ds.totals
      ? kpi('Klikime në Google', gscScope, html`<p class="v">${n0(ds.totals.clicks)}</p>`, `${n0(ds.totals.impressions)} shfaqje · CTR ${pct(ds.totals.ctr)}`, `${period} (PT) · totali i property-t, web · të dhëna të matura, jo parashikim trafiku.`)
      : kpi('Klikime në Google', gscScope, html`<p class="v none">pa të dhëna të kthyera</p>`, "S'është 0 klikime", `${period} (PT): API s'ktheu rresht për këtë periudhë; kjo s'do të thotë zero klikime.`);
  const pagesCard = m
    ? kpi('Faqe me të dhëna GSC', html`<span class="scope">Të kontrolluara</span>`, html`<p class="v">${String(m.withData.length)}<small>/${String(m.withData.length + m.noData.length)} faqe</small></p>`, `${m.noData.length} pa të dhëna ≠ 0 trafik`, `${m.noData.length} nga faqet e kontrolluara s'kanë të dhëna të kthyera nga GSC për ${period}; kjo s'do të thotë zero trafik (p.sh. kufiri i rreshtave ose kërkime anonime).`)
    : kpi('Faqe me të dhëna GSC', html`<span class="scope">Të kontrolluara</span>`, html`<p class="v none">—</p>`, 'Kërkon periudhë GSC', '');

  // --- besueshmëria ---
  const trust: [string, string][] = [];
  trust.push(hasCrawl ? (partial ? ['warn', `Crawl i pjesshëm: ${checked} nga ${discovered} URL të zbuluara; numrat e sitit vlejnë vetëm për faqet e kontrolluara.`] : ['ok', `Crawl brenda kufijve: ${checked} faqe të kontrolluara.`]) : ['info', 'Pa crawl: u auditua vetëm faqja hyrëse.']);
  const lhSrc = lhSourceText(r);
  trust.push(lhSrc ? (lhRuns > 1 ? ['ok', `${lhSrc}.`] : ['warn', 'Lighthouse: 1 matje mobile (lab); konfirmoje me disa matje para se të nxjerrësh përfundime.']) : ['warn', "Lighthouse s'dha rezultat në këtë raport."]);
  if (ds) {
    trust.push(['ok', `GSC: të dhëna përfundimtare, ${period} (PT), web${o.gsc?.connected ? '' : '; e ruajtur lokalisht, llogaria e shkëputur'}.`]);
    for (const n of overlayNotes(r, ds)) trust.push(['warn', n]);
  } else trust.push(['info', 'GSC: pa periudhë për këtë sit; detyrat renditen vetëm teknikisht.']);
  trust.push(['info', 'Health Score vlen vetëm për faqen hyrëse; sinjalet e cilësisë dhe të biznesit janë jashtë tij.']);

  const queries = ds ? topQueries(ds, 6) : [];
  const fewQueries = queries.filter((q) => q.impressions < 100).length;
  const pages = ds ? [...ds.pages].sort((a, b) => b.impressions - a.impressions).slice(0, 5) : [];

  return layout(
    `Përmbledhje · ${o.site.target}`,
    html`<header class="ovhead"><div class="ovtitle"><p class="crumb">Përmbledhje</p><h1>${o.site.target}</h1>
<p class="ovmeta"><span class="dot${partial || s.status === 'partial' ? ' warn' : ''}" aria-hidden="true"></span>Raporti i fundit <strong>${fmtDate(s.date)}</strong>${s.status === 'partial' ? ' · auditi i pjesshëm' : ''} · <a href="${reportHref}">Hap raportin →</a></p></div>
<div class="ovact">${o.sites.length > 1 ? html`<form class="sitepick" method="get" action="/"><label for="site-pick">Siti</label><select id="site-pick" name="site">${o.sites.map((x) => html`<option value="${x.key}" ${x.key === o.site!.key ? html`selected` : ''}>${x.target}</option>`)}</select><button type="submit" class="secondary">Shfaq</button></form>` : ''}<a class="btn" href="/audit">+ Nis audit të ri</a></div></header>

<section class="kpis" aria-label="Treguesit kryesorë">
${healthCard}${crawlCard}${gscCard}${pagesCard}
</section>

<div class="split">
<section class="panel" aria-labelledby="h-fokus"><h2 id="h-fokus">Ku të përqendrohesh tani</h2><p class="hint">Sipas rëndësisë teknike${ds ? ' · me shfaqjet e matura në GSC' : ''}</p>
${top.length ? html`<ol class="focus">${top.map((t) => focusRow(t, tasks!, s.file, ix))}</ol>` : html`<p class="note">Ky raport s'ka gjetje.</p>`}
<a class="more" href="${tasksHref(s.file)}">Të gjitha detyrat (${String(tasks?.tasks.length ?? 0)}) me provat për çdo faqe →</a></section>

<section class="panel" aria-labelledby="h-kerkimet"><h2 id="h-kerkimet">Kërkimet ku shfaqesh</h2><p class="hint">${ds ? `GSC · ${period} · të matura, jo parashikim trafiku` : 'Search Console'}</p>
${!ds ? html`<p class="note">Pa periudhë Search Console për këtë sit.</p>` : queries.length ? html`<div class="tablewrap"><table class="keep qtable"><thead><tr><th scope="col">Kërkimi</th><th scope="col" class="num">Shfaqje</th><th scope="col" class="num">Klikime</th><th scope="col" class="num"><abbr title="Pozicioni mesatar">Poz.</abbr></th></tr></thead>
<tbody>${queries.map((q) => html`<tr${q.impressions < 100 ? html` class="few"` : ''}><th scope="row">${truncate(q.query, 60)}</th><td class="num">${n0(q.impressions)}</td><td class="num">${n0(q.clicks)}</td><td class="num">${pos(q.position)}</td></tr>`)}</tbody></table></div>
<p class="note">${fewQueries ? `${fewQueries === queries.length ? 'Të gjitha kanë' : `${fewQueries} kanë`} nën 100 shfaqje: mostër e vogël. ` : ''}S'janë të gjitha kërkimet: GSC s'kthen kërkimet anonime.</p>` : html`<p class="note">GSC s'ktheu rreshta kërkimesh për këtë periudhë (pa të dhëna të kthyera).</p>`}
${ds ? html`<a class="more" href="/gsc/data/${ds.id}?report=${encodeURIComponent(s.file)}#kerkimet">Hap faqet dhe kërkimet →</a>` : ''}</section>
</div>

<div class="split even">
<section class="panel" aria-labelledby="h-faqet"><h2 id="h-faqet">Faqet që shfaqen në Google</h2><p class="hint">${ds ? `GSC · ${period} · vetëm URL të kthyera nga API` : 'Pa periudhë Search Console'}</p>
${pages.length ? html`<div class="tablewrap"><table class="keep qtable"><thead><tr><th scope="col">Faqja</th><th scope="col" class="num">Shfaqje</th><th scope="col" class="num">Klikime</th></tr></thead><tbody>${pages.map((p) => html`<tr><th scope="row" class="url">${truncate(pathOf(p.page), 60)}</th><td class="num">${n0(p.impressions)}</td><td class="num">${n0(p.clicks)}</td></tr>`)}</tbody></table></div>
<p class="note">Shuma sipas faqeve s'është totali unik i property-t.</p>` : ds ? html`<p class="note">Pa të dhëna të kthyera për faqet në këtë periudhë.</p>` : ''}</section>
<section class="panel" aria-labelledby="h-lh"><h2 id="h-lh">Lighthouse · faqja hyrëse</h2><p class="hint">${lhSrc || 'Pa rezultat Lighthouse'}</p>${lhRows(r)}<a class="more" href="${reportHref}#lighthouse">Hap kontrollet →</a></section>
</div>

<section class="panel" aria-labelledby="h-besueshmeria"><h2 id="h-besueshmeria">Mbulimi dhe besueshmëria</h2><ul class="dots">${trust.map(([c, t]) => html`<li class="${c}">${t}</li>`)}</ul>
${arr(r.partialModules).length ? html`<p class="note">Module të pjesshme: ${arr(r.partialModules).map((x) => str(obj(x).module) || str(x)).join(', ')}.</p>` : ''}</section>`,
    undefined,
    'overview',
  );
}

const HEALTH_LABELS: Record<string, string> = { EXCELLENT: 'Shkëlqyeshëm', GOOD: 'Mirë', NEEDS_WORK: 'Kërkon punë', POOR: 'Dobët', PARTIAL: 'I pjesshëm' };

function kpi(label: string, scope: SafeHtml, value: SafeHtml, short: SafeHtml | string, long: string): SafeHtml {
  return html`<article class="kpi"><div class="kpi-h"><h2>${label}</h2>${scope}</div>${value}<p class="d">${short}</p>${long
    ? html`<p class="d2 klong">${long}</p><details class="kmore"><summary>Sqarim<span class="sr"> për ${label}</span></summary><p>${long}</p></details>`
    : ''}</article>`;
}

/**
 * Titulli në shqip për disa gjetje të Lighthouse në listën kryesore. Numri merret nga mesazhi i gjetjes
 * ("… (12 elemente)"); kodi, rëndësia dhe pikëzimi s'ndryshojnë. Titulli origjinal mbetet te detajet dhe te raporti.
 */
function displayTitle(t: Task): { title: string; original?: string } {
  if (t.code !== 'A11Y_COLOR_CONTRAST') return { title: t.problem };
  const original = t.findings[0]?.message ?? t.problem;
  const n = Number(original.match(/\((\d+) elemente?\)\s*$/)?.[1] ?? NaN);
  const title = Number.isFinite(n) ? `Kontrast i pamjaftueshëm në ${n} ${n === 1 ? 'element' : 'elemente'}` : 'Kontrast i pamjaftueshëm i ngjyrave';
  return { title, original: original.replace(/\s*\(\d+ elemente?\)\s*$/, '') };
}

/**
 * Një detyrë në listë: rëndësia, titulli (lidhje te detyra) dhe një fakt (ku prek · shfaqjet në GSC).
 * Shënimet e kujdesit (p.sh. matja e vetme e Lighthouse), titulli origjinal i Lighthouse dhe provat për faqet
 * janë te detajet e hapshme. Provat jepen të plota, si blloqe kodi (thyhen vetëm te hapësirat; vlerat e gjata
 * lëvizin brenda bllokut), me lidhjen te detyra për të gjitha faqet.
 */
function focusRow(t: Task, tasks: TaskList, file: string, ix: ReturnType<typeof indexDataset> | null): SafeHtml {
  const e = ix ? taskExposure(ix, t.pages) : null;
  const gsc = e ? (e.metrics ? ` · ${e.withData > 1 ? 'Σ ' : ''}${n0(e.metrics.impressions)} shfaqje në GSC` : ' · GSC: pa të dhëna të kthyera') : '';
  const ev = t.evidence.filter((x) => x.items.length).slice(0, 3);
  const { title, original } = displayTitle(t);
  const more = t.cautions.length || ev.length || original;
  const href = tasksHref(file, `#${t.id}`);
  return html`<li><div class="frow">${sevBadge(t)}<a class="t" href="${href}">${truncate(title, 110)}</a></div>
<p class="fact">${coverageText(t, tasks.coverage)}${gsc}</p>
${more ? html`<details class="fdet"><summary>Shënime dhe prova${t.cautions.length ? html` <span class="n">(${String(t.cautions.length)} shënim${t.cautions.length > 1 ? 'e' : ''})</span>` : ''}</summary>
${original ? html`<p class="orig">Titulli në Lighthouse: <span lang="en">${original}</span></p>` : ''}
${t.cautions.length ? html`<ul class="plain">${t.cautions.map((c) => html`<li>${c}</li>`)}</ul>` : ''}
${ev.map((x) => html`<div class="fev"><p class="fev-page">${pathOf(x.url) === '/' ? 'Faqja hyrëse (/)' : pathOf(x.url)}</p>
${x.items.map((i) => html`<pre class="code-block" tabindex="0" aria-label="Prova"><code>${tokens(i.detected)}</code></pre>${i.expected ? html`<p class="fev-exp">Pritet:</p><pre class="code-block" tabindex="0" aria-label="Vlera e pritur"><code>${tokens(i.expected)}</code></pre>` : ''}`)}</div>`)}
<a href="${href}">Provat e plota${t.pages.length > 1 ? ` për ${t.pages.length} faqe` : ''} te detyra →</a></details>` : ''}</li>`;
}

/** Teksti i provës si fjalë/vlera të pandashme (span me nowrap): thyhet vetëm te hapësirat, jo te "-" apo "/"; kopjimi jep të njëjtin tekst. */
function tokens(text: string): SafeHtml {
  return html`${text.split(/(\s+)/).map((p) => (p === '' || /^\s+$/.test(p) ? p : html`<span>${p}</span>`))}`;
}
