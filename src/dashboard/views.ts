import { BUSINESS_CATEGORY_LABELS, CATEGORY_LABELS, QUALITY_CATEGORY_LABELS, SITE_CATEGORY_LABELS } from '../core/schemas.js';
import { PROVISIONAL_THRESHOLDS, type CompareResult, type IssueChange, type ScoreRow } from './compare.js';
import { externalLink, html, truncate, type SafeHtml } from './html.js';
import { captures, fileRef, SECTION_LABELS, SEV_LABELS, SEVERITIES, sourceFindings, urlIssues, type Capture, type IssueView, type Section, type Sev } from './model.js';
import { arr, kindOf, num, obj, str, summarize, type ListResult, type Obj, type ReportSummary } from './store.js';

/** Qasja te skedarët lokalë (screenshot, LHR): vetëm kontroll ekzistence, pa lexim përmbajtjeje. */
export interface Files {
  shotExists(rel: string): boolean;
  lhrExists(name: string): boolean;
}

export type Query = Record<string, string | undefined>;

const KIND_LABELS = { url: 'Audit URL', folder: 'Dosje lokale', repo: 'Repo' } as const;
const STATUS_LABELS = { complete: 'complete', partial: 'partial', unknown: 'i panjohur' } as const;
/** Statusi i auditit (modulet), i ndarë nga mbulimi i crawl-it. */
const AUDIT_LABELS = { complete: 'i përfunduar', partial: 'i pjesshëm', unknown: 'i panjohur' } as const;

const reportHref = (file: string, q?: Query) => {
  const qs = q ? new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString() : '';
  return `/report/${encodeURIComponent(file)}${qs ? `?${qs}` : ''}`;
};
const shotHref = (rel: string) => `/shot/${rel.split('/').map(encodeURIComponent).join('/')}`;

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const badge = (cls: string, text: string) => html`<span class="badge b-${cls}">${text}</span>`;
const sevBadge = (s: Sev) => html`<span class="badge sev-${s}">${SEV_LABELS[s]}</span>`;
const scoreText = (n: number | null) => (n === null ? '—' : String(n));

/** refreshSeconds: rifreskim me <meta refresh> (pa JavaScript) për punët në ekzekutim. */
export function layout(title: string, body: SafeHtml, refreshSeconds?: number): string {
  return html`<!doctype html>
<html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin">${refreshSeconds ? html`<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}<title>${title} · SEO Tool</title><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><span class="brand">SEO Tool · Dashboard</span><nav><a href="/">Raportet</a><a href="/audit">Nis audit</a><a href="/jobs">Punët</a><a href="/compare">Krahaso</a></nav>
<span class="local">vetëm lokal · 127.0.0.1 · pa llogari, pa cloud</span></header>
<main>${body}</main></body></html>`.value;
}

// ---------------------------------------------------------------- Lista

export function listView(list: ListResult): string {
  const prevOf = (r: ReportSummary) => list.reports.find((x) => x !== r && x.siteKey === r.siteKey && (x.date ?? '') < (r.date ?? ''));
  const rows = list.reports.map((r) => {
    const prev = prevOf(r);
    const cov = r.siteCoverage;
    return html`<tr>
<td class="nowrap">${fmtDate(r.date)}</td>
<td><a href="${reportHref(r.file)}">${truncate(r.target, 48)}</a><div class="code">${r.file}</div></td>
<td>${KIND_LABELS[r.kind]}</td>
<td>${badge(r.status, AUDIT_LABELS[r.status])}</td>
<td class="num">${r.health ? html`${scoreText(r.health.score)} <span class="note">${r.health.status}</span>` : html`<span class="note">s'ka (skedarë)</span>`}</td>
<td>${cov ? html`${cov.checked}/${cov.discovered} faqe ${cov.truncated ? badge('partial', 'crawl i pjesshëm') : badge('complete', 'crawl i plotë')}` : html`<span class="note">${r.kind === 'url' ? 'pa crawl (vetëm faqja hyrëse)' : '—'}</span>`}</td>
<td class="num">${r.issueCount}</td>
<td class="code">${r.schema}</td>
<td class="row-actions"><a href="${reportHref(r.file)}">Hap</a>${prev ? html`<a href="/compare?a=${encodeURIComponent(prev.file)}&amp;b=${encodeURIComponent(r.file)}">Krahaso me të mëparshmin</a>` : ''}</td>
</tr>`;
  });
  const invalid = list.invalid.length
    ? html`<div class="panel"><h2>Skedarë që s'u lexuan (${list.invalid.length})</h2><ul class="plain">${list.invalid.map((i) => html`<li><span class="code">${i.file}</span> — ${i.reason}</li>`)}</ul></div>`
    : '';
  return layout(
    'Raportet',
    html`<h1>Raportet</h1><p class="sub">${list.reports.length} raporte nga dosja e raporteve.</p>
<div class="warnbox"><strong>Auditi</strong> tregon nëse modulet e auditit u kryen: <em>i përfunduar</em>, ose <em>i pjesshëm</em> kur disa module u anashkaluan (p.sh. Lighthouse u bllokua). <strong>Crawl-i</strong> tregon sa nga faqet e zbuluara u kontrolluan brenda kufijve (p.sh. 25 faqe): një audit i përfunduar mund të ketë <em>crawl të pjesshëm</em>. Health Score vlen vetëm për faqen hyrëse.</div>
<div class="panel"><table><thead><tr><th>Data</th><th>Objekti</th><th>Lloji</th><th>Auditi</th><th class="num">Health</th><th>Crawl-i (faqe të kontrolluara)</th><th class="num">Issue</th><th>Schema</th><th></th></tr></thead>
<tbody>${rows.length ? rows : html`<tr><td colspan="9" class="note">S'ka raporte në dosjen e raporteve.</td></tr>`}</tbody></table></div>${invalid}`,
  );
}

// ---------------------------------------------------------------- Prova dhe screenshot-e

function shotFigure(files: Files, rel: string, caption: string, viewport = ''): SafeHtml {
  if (!files.shotExists(rel)) return html`<div class="warnbox">Screenshot-i mungon lokalisht: <span class="code">${rel}</span></div>`;
  return html`<figure class="shot ${viewport === 'mobile' ? 'mobile' : ''}"><a href="${shotHref(rel)}"><img src="${shotHref(rel)}" alt="${caption}" loading="lazy"></a><figcaption>${caption}</figcaption></figure>`;
}

function evidenceBlock(i: IssueView, files: Files): SafeHtml {
  const shots = i.evidence.filter((e) => e.type === 'screenshot' && e.raw);
  const other = i.evidence.filter((e) => !(e.type === 'screenshot' && e.raw));
  return html`${other.map((e) => html`<div class="ev"><b>${e.type || 'provë'}</b>${e.url && e.url !== i.url ? html` · ${e.url}` : ''}
${truncate(e.detected, 1500)}${e.expected ? html`
<b>pritej:</b> ${truncate(e.expected, 400)}` : ''}${e.raw ? html`
<b>raw:</b> ${truncate(e.raw, 1500)}` : ''}</div>`)}
${shots.length ? html`<div class="shots">${shots.map((e) => shotFigure(files, e.raw, `provë: ${e.raw.split('/').pop() ?? ''}`, /-mobile\./.test(e.raw) ? 'mobile' : ''))}</div>` : ''}`;
}

function issueDetails(i: IssueView, files: Files, caps: Capture[], open = false): SafeHtml {
  const evShots = new Set(i.evidence.filter((e) => e.type === 'screenshot').map((e) => e.raw));
  const context = caps.filter((c) => c.status === 'ok' && c.screenshot && i.pages.includes(c.url) && !evShots.has(c.screenshot));
  const isSignal = i.section === 'quality';
  return html`<details class="issue" ${open ? html`open` : ''}><summary>${sevBadge(i.severity)} <strong>${i.message || i.code}</strong>
<span class="code">${i.code}</span> <span class="badge">${SECTION_LABELS[i.section]}</span>
${i.pages.length > 1 ? html`<span class="note">${i.pages.length} faqe</span>` : ''}
${i.confidence !== null && i.confidence < 1 ? html`<span class="note">confidence ${i.confidence}</span>` : ''}
${i.needsManualReview || isSignal ? badge('warning', 'verifiko manualisht') : ''}</summary>
<div class="body"><dl class="kv">
${i.url ? html`<dt>Faqja</dt><dd>${externalLink(i.url)}</dd>` : ''}
${i.whyItMatters ? html`<dt>Pse ka rëndësi</dt><dd>${i.whyItMatters}</dd>` : ''}
${i.fix ? html`<dt>${isSignal ? 'Sugjerim' : 'Rekomandim'}</dt><dd>${i.fix}</dd>` : ''}
</dl>
<h3>Prova</h3>${evidenceBlock(i, files)}
${i.pages.length > 1 ? html`<h3>Faqet (${i.pages.length})</h3><ul class="plain">${i.pages.slice(0, 30).map((p) => html`<li>${externalLink(p)}</li>`)}</ul>${i.pages.length > 30 ? html`<p class="note">… +${i.pages.length - 30} në JSON</p>` : ''}` : ''}
${context.length ? html`<h3>Pamje e faqes <span class="note">(kontekst, jo provë e kësaj gjetjeje)</span></h3><div class="shots">${context.map((c) => shotFigure(files, c.screenshot, `${c.viewport} · ${c.url}`, c.viewport))}</div>` : ''}
</div></details>`;
}

// ---------------------------------------------------------------- Raporti URL

function statusOfModules(r: Obj): Map<string, Obj> {
  return new Map(arr(r.modules).map(obj).map((m) => [str(m.category), m]));
}

function coverageText(c: Obj): string {
  const checked = num(c.checked);
  const discovered = num(c.discovered);
  return checked !== null && discovered !== null ? `${checked}/${discovered}` : '—';
}

export function urlReportView(file: string, r: Obj, q: Query, files: Files): string {
  const s = summarize(file, r);
  const issues = urlIssues(r);
  const caps = captures(r);
  const mods = statusOfModules(r);
  const health = obj(r.health);
  const site = obj(r.site);
  const crawl = obj(site.crawl);
  const hasSite = !!r.site && site.status !== 'skipped';

  // --- Faqja hyrëse ---
  const homeRows = Object.entries(CATEGORY_LABELS).map(([k, label]) => {
    const m = mods.get(k) ?? {};
    const score = num(obj(r.categories)[k]);
    return html`<tr><td>${label}</td><td class="num"><strong>${scoreText(score)}</strong></td><td>${badge(str(m.status) || 'unknown', str(m.status) || '—')}${m.partial === true ? html` ${badge('partial', 'partial')}` : ''}</td></tr>`;
  });
  const missing = arr(health.missingCategories).map(str);
  const homePanel = html`<section class="panel scope"><h2>Faqja hyrëse — Health Score</h2>
<div class="score">${scoreText(num(health.score))} <small>${str(health.status)}</small></div>
<p class="note">Llogaritet <strong>vetëm nga faqja hyrëse</strong> (availability, SEO teknik, security, Lighthouse). Siti, biznesi dhe sinjalet e cilësisë s'hyjnë në të.
${missing.length ? html` Kategori që mungojnë: ${missing.join(', ')}.` : ''}</p>
<table><thead><tr><th>Kategoria</th><th class="num">Pikë</th><th>Statusi</th></tr></thead><tbody>${homeRows}</tbody></table>
${lhrBlock(r, files)}</section>`;

  // --- Siti: mbulim i pjesshëm ---
  const sitePanel = hasSite
    ? html`<section class="panel scope"><h2>Gjithë siti — mbulim ${crawl.truncated === true || (num(crawl.urlsDiscovered) ?? 0) > (num(crawl.pagesAnalyzed) ?? 0) ? 'i pjesshëm' : 'i plotë brenda kufijve'}</h2>
<dl class="kv"><dt>Faqe të kontrolluara</dt><dd><strong>${scoreText(num(crawl.pagesAnalyzed))}</strong> nga ${scoreText(num(crawl.urlsDiscovered))} URL të zbuluara</dd>
<dt>Pa u kontrolluar</dt><dd>${Object.entries(obj(crawl.notCheckedByReason)).map(([k, v]) => html`${num(obj(v).count) ?? 0} ${str(obj(v).meaning) || k}`).map((x, i) => (i ? html`; ${x}` : x))}</dd>
<dt>Kufijtë</dt><dd>${Object.entries(obj(crawl.limits)).map(([k, v]) => `${k}=${str(v)}`).join(' · ')}</dd></dl>
<p class="note">Këto pikë vlejnë <strong>vetëm për faqet e kontrolluara</strong>, jo për gjithë sitin, dhe s'hyjnë në Health Score.</p>
<table><thead><tr><th>Kategoria</th><th class="num">Pikë</th><th>Mbulimi</th></tr></thead><tbody>
${Object.entries(SITE_CATEGORY_LABELS).map(([k, label]) => {
  const c = obj(obj(site.categoryCoverage)[k]);
  return html`<tr><td>${label}</td><td class="num"><strong>${scoreText(num(obj(site.categories)[k]))}</strong></td><td>${coverageText(c)} ${c.partial === true ? badge('partial', 'i pjesshëm') : ''}</td></tr>`;
})}</tbody></table></section>`
    : html`<section class="panel scope"><h2>Gjithë siti</h2><p class="note">Ky raport (schema ${s.schema}) s'ka crawl të sitit${site.status === 'skipped' ? html`: ${str(site.reason)}` : ''}. Vetëm faqja hyrëse u auditua.</p></section>`;

  // --- Biznes ---
  const business = obj(r.business);
  const businessPanel = r.business && business.status !== 'skipped'
    ? html`<section class="panel"><h2>Biznes & privatësi <span class="note">(jashtë Health Score)</span></h2>
<table><thead><tr><th>Kategoria</th><th class="num">Pikë</th><th>Mbulimi</th><th>Fusha</th></tr></thead><tbody>
${Object.entries(BUSINESS_CATEGORY_LABELS).map(([k, label]) => {
  const c = obj(obj(business.categoryCoverage)[k]);
  return html`<tr><td>${label}</td><td class="num"><strong>${scoreText(num(obj(business.categories)[k]))}</strong></td><td>${coverageText(c)} ${c.partial === true ? badge('partial', 'i pjesshëm') : ''}</td><td class="note">${str(c.scope)}</td></tr>`;
})}</tbody></table>${str(business.privacyDisclaimer) ? html`<p class="note">${str(business.privacyDisclaimer)}</p>` : ''}</section>`
    : '';

  return layout(
    s.target,
    html`<h1>${s.target}</h1>
<p class="sub">${externalLink(str(r.url))} · ${fmtDate(s.date)} · ${badge(s.status, STATUS_LABELS[s.status])} · schema ${s.schema} · rregullat ${str(r.ruleSetVersion)} · <span class="code">${file}</span></p>
${arr(r.partialModules).length ? html`<div class="warnbox">Module të pjesshme/të anashkaluara: ${arr(r.partialModules).map((m) => str(obj(m).module) || str(m)).join(', ')}</div>` : ''}
<div class="grid">${homePanel}${sitePanel}</div>
${businessPanel}
${qualityPanel(r, issues, caps, files)}
${issuesPanel(file, issues, caps, q, files)}
${recommendationsPanel(r)}
${limitationsPanel(arr(r.limitations).map(str))}`,
  );
}

function lhrBlock(r: Obj, files: Files): SafeHtml | '' {
  const lh = obj(r.lighthouse);
  const name = str(lh.lhrFile);
  const meta = str(lh.version) ? html`<p class="note">Lighthouse ${str(lh.version)} · ${str(lh.formFactor)} · throttling ${str(lh.throttlingMethod)}${arr(lh.failedAttempts).length ? html` · ${arr(lh.failedAttempts).length} përpjekje e dështuar para rezultatit` : ''}</p>` : html`<p class="note">Pa rezultat Lighthouse në këtë raport.</p>`;
  if (!name) return meta;
  return html`${meta}<p class="note">LHR i plotë: ${files.lhrExists(name) ? html`<a href="/lhr/${encodeURIComponent(name)}">${name}</a> (shkarkim lokal; mund të përmbajë URL, kërkesa rrjeti dhe screenshot-e — mos e ndaj pa e kontrolluar)` : html`<span class="code">${name}</span> (mungon lokalisht)`}</p>`;
}

function qualityPanel(r: Obj, issues: IssueView[], caps: Capture[], files: Files): SafeHtml | '' {
  const q = obj(r.quality);
  if (!r.quality) return '';
  if (q.status === 'skipped') return html`<section class="panel signals"><h2>Cilësia & pamja</h2><p class="note">skipped: ${str(q.reason)}</p></section>`;
  const qIssues = issues.filter((i) => i.section === 'quality');
  // Grupet nga raporti (quality.groups); raportet pa groups: një grup për kod.
  const groups = arr(q.groups).length
    ? arr(q.groups).map(obj).map((g) => ({ code: str(g.code), summary: str(g.summary), pages: arr(g.pages).map(str), severity: str(g.severity) }))
    : [...new Set(qIssues.map((i) => i.code))].map((code) => {
        const l = qIssues.filter((i) => i.code === code);
        return { code, summary: l.length > 1 ? `${l.length}× ${code}` : l[0]!.message, pages: l.flatMap((i) => i.pages), severity: l[0]!.severity };
      });
  const statuses = obj(q.statuses);
  const okCaps = caps.filter((c) => c.status === 'ok' && c.screenshot);
  const byPage = [...new Set(okCaps.map((c) => c.url))];
  return html`<section class="panel signals"><h2>Cilësia e përmbajtjes & identiteti vizual <span class="note">(sinjale, pa score)</span></h2>
<div class="warnbox">Sinjale për shqyrtim njerëzor. <strong>S'janë provë se faqja është krijuar nga AI</strong> dhe <strong>s'hyjnë në Health Score</strong>. "AI slop" është vetëm emërtim për sinjale që kërkojnë verifikim.</div>
<p class="note">${Object.entries(QUALITY_CATEGORY_LABELS).map(([k, label]) => {
  const st = obj(statuses[k]);
  return html`${label}: ${badge(str(st.status) || 'unknown', str(st.status) || '—')}${st.partial === true ? html` ${badge('partial', 'partial')}` : ''} `;
})}</p>
${groups.length ? groups.map((g) => {
  const members = qIssues.filter((i) => i.code === g.code && (g.pages.length === 0 || i.pages.some((p) => g.pages.includes(p))));
  return html`<details class="issue"><summary>${sevBadge((SEVERITIES.includes(g.severity as Sev) ? g.severity : 'low') as Sev)} <strong>${g.summary}</strong> <span class="code">${g.code}</span>
<span class="note">${members.length} gjetje · ${new Set(g.pages).size} faqe</span></summary>
<div class="body"><p class="note">Hap secilën gjetje për provën e saj të plotë (URL, provë, screenshot).</p>${members.map((i) => issueDetails(i, files, caps))}</div></details>`;
}) : html`<p class="note">Asnjë sinjal cilësie në këtë raport.</p>`}
${byPage.length ? html`<details class="gallery"><summary>Pamjet e renderuara (${okCaps.length}, desktop + mobile)</summary>${byPage.map((u) => html`<div><span class="note">${u}</span><div class="shots">${okCaps.filter((c) => c.url === u).map((c) => shotFigure(files, c.screenshot, `${c.viewport}${c.pageType ? ` · ${c.pageType}` : ''}`, c.viewport))}</div></div>`)}</details>` : ''}
${caps.filter((c) => c.status !== 'ok').map((c) => html`<div class="warnbox">Pamje e pa-renderuar: ${c.viewport} ${c.url} — ${c.reason}</div>`)}
</section>`;
}

function issuesPanel(file: string, issues: IssueView[], caps: Capture[], q: Query, files: Files): SafeHtml {
  const section = (Object.keys(SECTION_LABELS) as Section[]).includes(q.section as Section) ? (q.section as Section) : undefined;
  const sev = SEVERITIES.includes(q.sev as Sev) ? (q.sev as Sev) : undefined;
  const pages = [...new Set(issues.flatMap((i) => i.pages))].sort();
  const page = q.page && pages.includes(q.page) ? q.page : undefined;
  const shown = issues
    .filter((i) => (!section || i.section === section) && (!sev || i.severity === sev) && (!page || i.pages.includes(page)))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.priority - a.priority);
  const opt = (value: string, label: string, sel?: string) => html`<option value="${value}" ${sel === value ? html`selected` : ''}>${label}</option>`;
  return html`<section class="panel" id="issues"><h2>Issue dhe sinjale</h2>
<form class="filters" method="get" action="${reportHref(file)}#issues">
<label>Seksioni<select name="section">${opt('', 'Të gjitha')}${(Object.keys(SECTION_LABELS) as Section[]).map((k) => opt(k, SECTION_LABELS[k], section))}</select></label>
<label>Rëndësia<select name="sev">${opt('', 'Të gjitha')}${SEVERITIES.map((k) => opt(k, SEV_LABELS[k], sev))}</select></label>
<label>Faqja<select name="page">${opt('', `Të gjitha (${pages.length})`)}${pages.slice(0, 500).map((p) => opt(p, truncate(p, 70), page))}</select></label>
<button type="submit">Filtro</button> <a href="${reportHref(file)}#issues">pastro</a></form>
<p class="note">${shown.length} nga ${issues.length}. Renditja: rëndësia, pastaj prioriteti.</p>
${shown.map((i) => issueDetails(i, files, caps))}</section>`;
}

function recommendationsPanel(r: Obj): SafeHtml {
  const rows = [
    ...arr(r.topImprovements).map((x) => ({ ...obj(x), section: 'homepage' as Section }) as Obj & { section: Section }),
    ...arr(obj(r.site).topImprovements).map((x) => ({ ...obj(x), section: 'site' as Section }) as Obj & { section: Section }),
    ...arr(obj(r.business).topImprovements).map((x) => ({ ...obj(x), section: 'business' as Section }) as Obj & { section: Section }),
  ];
  if (!rows.length) return html``;
  return html`<section class="panel"><h2>Rekomandimet kryesore</h2><table><thead><tr><th class="num">Prioriteti</th><th>Rëndësia</th><th>Çfarë</th><th>Si rregullohet</th><th>Seksioni</th></tr></thead><tbody>
${rows.map((x) => html`<tr><td class="num">${scoreText(num(x.priority))}</td><td>${sevBadge((SEVERITIES.includes(x.severity as Sev) ? x.severity : 'low') as Sev)}</td><td>${str(x.message)} <div class="code">${str(x.code)}</div></td><td>${str(x.fix)}</td><td class="note">${SECTION_LABELS[x.section]}</td></tr>`)}
</tbody></table></section>`;
}

function limitationsPanel(items: string[]): SafeHtml {
  return html`<section class="panel"><h2>Kufizime</h2>${items.length ? html`<ul class="plain">${items.map((l) => html`<li>${l}</li>`)}</ul>` : html`<p class="note">Asnjë kufizim i shënuar.</p>`}</section>`;
}

// ---------------------------------------------------------------- Raporti i skedarëve

export function sourceReportView(file: string, r: Obj, q: Query): string {
  const s = summarize(file, r);
  const source = obj(r.source);
  const repo = obj(source.repo);
  const project = obj(r.project);
  const cov = obj(r.coverage);
  const acc = obj(cov.accounting);
  const checks = arr(r.checks).map(obj);
  const skippedChecks = checks.filter((c) => c.status === 'skipped' || c.status === 'not_applicable');
  const findings = sourceFindings(r);
  const sev = SEVERITIES.includes(q.sev as Sev) ? (q.sev as Sev) : undefined;
  const files = [...new Set(findings.map((f) => f.file))].sort();
  const fileSel = q.file && files.includes(q.file) ? q.file : undefined;
  const shown = findings.filter((f) => (!sev || f.severity === sev) && (!fileSel || f.file === fileSel)).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const opt = (value: string, label: string, sel?: string) => html`<option value="${value}" ${sel === value ? html`selected` : ''}>${label}</option>`;
  const skipped = Object.entries(obj(cov.skipped));

  return layout(
    s.target,
    html`<h1>${str(source.name) || s.target}</h1>
<p class="sub">${KIND_LABELS[kindOf(r)]} · ${fmtDate(s.date)} · ${badge(s.status, STATUS_LABELS[s.status])} · schema ${s.schema} · <span class="code">${file}</span></p>
${str(repo.url) ? html`<p class="sub">${externalLink(str(repo.url))} · commit <span class="code">${truncate(str(repo.commit), 12)}</span> · ${str(repo.branch)} · ${str(repo.clone)}</p>` : ''}
<div class="warnbox">Audit i skedarëve: <strong>pa Health Score, pa Lighthouse, pa header-a HTTP</strong> — kodi i projektit s'u ekzekutua.</div>
<div class="grid">
<section class="panel"><h2>Projekti</h2><dl class="kv"><dt>Lloji</dt><dd>${str(project.label) || str(project.type)} <span class="note">(${str(project.type)}, confidence ${scoreText(num(project.confidence))})</span></dd>
<dt>Skedarë HTML</dt><dd>${scoreText(num(project.htmlFiles))}</dd></dl></section>
<section class="panel"><h2>Mbulimi</h2><dl class="kv"><dt>Skedarë</dt><dd>${str(acc.equation) || `${scoreText(num(cov.filesSeen))} të parë, ${scoreText(num(cov.filesRead))} të lexuar`}</dd>
<dt>HTML</dt><dd>${scoreText(num(cov.htmlRead))}/${scoreText(num(cov.htmlFiles))} të lexuar</dd>
<dt>I ndërprerë</dt><dd>${cov.truncated === true ? badge('partial', 'po — kufijtë u arritën') : 'jo'}</dd>
${skipped.length ? html`<dt>Të anashkaluara</dt><dd>${skipped.map(([k, v]) => html`<div>${num(obj(v).count) ?? 0} × ${k} <span class="note">${str(obj(v).meaning)}${arr(obj(v).examples).length ? ` (p.sh. ${arr(obj(v).examples).map(str).slice(0, 3).join(', ')})` : ''}</span></div>`)}</dd>` : ''}
</dl></section></div>
<section class="panel"><h2>Kontrollet</h2>
${skippedChecks.length ? html`<div class="warnbox"><strong>${skippedChecks.length} kontrolle u anashkaluan:</strong> ${skippedChecks.map((c) => html`<div>${str(c.label) || str(c.id)} — ${str(c.reason)}</div>`)}</div>` : ''}
<table><thead><tr><th>Kontrolli</th><th>Statusi</th><th>Shënime</th></tr></thead><tbody>
${checks.map((c) => html`<tr><td>${str(c.label) || str(c.id)}</td><td>${badge(str(c.status) || 'unknown', str(c.status) || '—')}</td><td class="note">${str(c.reason) || arr(c.observations).map(str).join(' · ')}</td></tr>`)}
</tbody></table></section>
<section class="panel" id="findings"><h2>Gjetjet</h2>
<form class="filters" method="get" action="${reportHref(file)}#findings">
<label>Rëndësia<select name="sev">${opt('', 'Të gjitha')}${SEVERITIES.map((k) => opt(k, SEV_LABELS[k], sev))}</select></label>
<label>Skedari<select name="file">${opt('', `Të gjithë (${files.length})`)}${files.map((f) => opt(f, f, fileSel))}</select></label>
<button type="submit">Filtro</button> <a href="${reportHref(file)}#findings">pastro</a></form>
<p class="note">${shown.length} nga ${findings.length}. Rreshti shfaqet vetëm kur dihet me siguri.</p>
${shown.map((f) => html`<details class="issue"><summary>${sevBadge(f.severity)} <strong>${f.message}</strong> <span class="code">${fileRef(f)}</span> <span class="code">${f.code}</span>${f.needsManualReview ? html` ${badge('warning', 'verifiko manualisht')}` : ''}</summary>
<div class="body"><dl class="kv"><dt>Vendi</dt><dd><span class="code">${fileRef(f)}</span></dd>${f.whyItMatters ? html`<dt>Pse ka rëndësi</dt><dd>${f.whyItMatters}</dd>` : ''}<dt>Sugjerim</dt><dd>${f.suggestion}</dd>
${f.related.length ? html`<dt>Edhe në</dt><dd>${f.related.slice(0, 20).join(', ')}</dd>` : ''}</dl>
<h3>Prova</h3><div class="ev">${truncate(f.evidence, 2000)}</div></div></details>`)}
</section>
<section class="panel"><h2>Çfarë s'kontrollohet nga skedarët</h2><ul class="plain">${arr(r.notFromFiles).map(obj).map((n) => html`<li><strong>${str(n.check)}</strong> — ${str(n.reason)}</li>`)}</ul></section>
${limitationsPanel(arr(r.limitations).map(str))}`,
  );
}

// ---------------------------------------------------------------- Krahasimi

const VERDICT_LABELS: Record<string, string> = { improved: 'u përmirësua', worsened: 'u përkeqësua', 'measured-increase': 'rritje e matur, kërkon konfirmim', 'measured-decrease': 'rënie e matur, kërkon konfirmim', same: 'pa ndryshim', noise: 'brenda variacionit', 'not-comparable': "s'krahasohet" };

export function comparePickerView(list: ListResult, q: Query, error?: string): string {
  const opt = (r: ReportSummary, sel?: string) => html`<option value="${r.file}" ${sel === r.file ? html`selected` : ''}>${r.target} · ${fmtDate(r.date)} · ${KIND_LABELS[r.kind]}</option>`;
  return layout(
    'Krahaso',
    html`<h1>Krahaso dy raporte</h1><p class="sub">Vetëm raporte të të njëjtit sit/burim. A = më i vjetri, B = më i riu.</p>
${error ? html`<div class="warnbox">${error}</div>` : ''}
<div class="panel"><form class="filters" method="get" action="/compare">
<label>Raporti A<select name="a">${list.reports.map((r) => opt(r, q.a))}</select></label>
<label>Raporti B<select name="b">${list.reports.map((r) => opt(r, q.b))}</select></label>
<button type="submit">Krahaso</button></form></div>`,
  );
}

function changeList(title: string, items: IssueChange[], cls: string, withReason = false): SafeHtml {
  return html`<section class="panel"><h2>${title} <span class="badge b-${cls}">${items.length}</span></h2>
${items.length ? html`<table><thead><tr><th>Rëndësia</th><th>Gjetja</th><th>Faqja</th><th>Seksioni</th>${withReason ? html`<th>Pse s'krahasohet</th>` : ''}</tr></thead><tbody>
${items.map((i) => html`<tr><td>${sevBadge(i.severity as Sev)}</td><td>${i.message} <div class="code">${i.code}</div></td><td class="note">${truncate(i.url, 60)}</td><td class="note">${SECTION_LABELS[i.section]}</td>${withReason ? html`<td class="note">${i.reason ?? ''}</td>` : ''}</tr>`)}
</tbody></table>` : html`<p class="note">Asnjë.</p>`}</section>`;
}

function scoreTable(rows: ScoreRow[]): SafeHtml {
  return html`<table><thead><tr><th>Kategoria</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th><th>Vlerësimi</th><th>Shënim</th></tr></thead><tbody>
${rows.map((r) => html`<tr><td>${r.label}</td><td class="num">${scoreText(r.a)}</td><td class="num">${scoreText(r.b)}</td><td class="num">${r.delta === null ? '—' : r.delta > 0 ? `+${r.delta}` : String(r.delta)}</td><td>${badge(r.verdict, VERDICT_LABELS[r.verdict] ?? r.verdict)}</td><td class="note">${r.note ?? ''}</td></tr>`)}
</tbody></table>`;
}

export function compareView(c: CompareResult): string {
  const head = html`<h1>Krahasimi: ${c.a.target}</h1>
<p class="sub">A: <a href="${reportHref(c.a.file)}">${fmtDate(c.a.date)}</a> ${badge(c.a.status, STATUS_LABELS[c.a.status])} → B: <a href="${reportHref(c.b.file)}">${fmtDate(c.b.date)}</a> ${badge(c.b.status, STATUS_LABELS[c.b.status])}</p>`;
  if (!c.sameTarget) return layout('Krahasimi', html`${head}<div class="warnbox">${c.reason ?? ''}</div>`);
  const home = c.scores.filter((r) => r.group !== 'site');
  const site = c.scores.filter((r) => r.group === 'site');
  return layout(
    'Krahasimi',
    html`${head}
<div class="panel"><h2>Kujdes para leximit</h2><ul class="plain">${c.caveats.map((x) => html`<li>${x}</li>`)}<li>${PROVISIONAL_THRESHOLDS}</li></ul></div>
${home.length ? html`<section class="panel scope"><h2>Faqja hyrëse</h2>
<p class="note">Lighthouse: ${c.lighthouse.comparable ? 'konfigurim i njëjtë' : html`<strong>i pakrahasueshëm</strong>`}${c.lighthouse.differences.length ? html` — ${c.lighthouse.differences.join('; ')}` : ''}. Performance ndryshon mes ekzekutimeve edhe pa ndryshim në sit.</p>
${scoreTable(home)}</section>` : ''}
${site.length ? html`<section class="panel scope"><h2>Siti (faqet e kontrolluara)</h2><p class="note">Krahasohen vetëm kur faqet e kontrolluara janë pothuajse të njëjta (≥ 90%).</p>${scoreTable(site)}</section>` : ''}
${changeList('U zgjidhën (në A, jo në B)', c.resolved, 'improved')}
${changeList('Nuk u rilevua në matjen e fundit, kërkon konfirmim', c.notRedetected, 'noise')}
${changeList('Të reja (në B, jo në A)', c.added, 'worsened')}
${changeList("S'krahasohen", c.notComparable, 'not-comparable', true)}
${changeList('Mbetën', c.persisted, 'same')}
${c.quality ? html`<section class="panel signals"><h2>Sinjalet e cilësisë <span class="note">(jashtë Health; s'janë provë autorësie AI)</span></h2>
<table><thead><tr><th>Kodi</th><th class="num">A</th><th class="num">B</th></tr></thead><tbody>${c.quality.map((x) => html`<tr><td class="code">${x.code}</td><td class="num">${x.a}</td><td class="num">${x.b}</td></tr>`)}</tbody></table></section>` : ''}`,
  );
}

export function errorView(title: string, message: string): string {
  return layout(title, html`<h1>${title}</h1><div class="warnbox">${message}</div><p><a href="/">← Raportet</a></p>`);
}

