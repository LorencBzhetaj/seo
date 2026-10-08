import { displayDir } from './gsc-store.js';
import { MAX_DEPTH, MAX_LH_RUNS, MAX_PAGES, URL_DEFAULTS, type FolderCheck } from './forms.js';
import { externalLink, html, truncate, type SafeHtml } from './html.js';
import type { BrowserLookup } from '../core/browser.js';
import type { Job, JobState } from './jobs.js';
import { layout } from './views.js';

/** Vlerat e mëparshme të formularit (pas një gabimi) dhe gabimet për secilin formular. */
export interface FormState {
  kind?: 'url' | 'folder' | 'repo';
  values?: Record<string, string | undefined>;
  errors?: string[];
}

const KIND = { url: 'Audit URL', folder: 'Dosje lokale', repo: 'Repo publike' } as const;
const STATE: Record<JobState, { label: string; cls: string }> = {
  running: { label: 'në punë', cls: 'warning' },
  cancelling: { label: 'po anulohet', cls: 'warning' },
  completed: { label: 'përfunduar', cls: 'complete' },
  failed: { label: 'dështoi', cls: 'fail' },
  cancelled: { label: 'anuluar', cls: 'skipped' },
};
const ENGINE_STATUS: Record<string, string> = {
  initializing: 'nisje',
  crawling: 'mbledhje të dhënash: faqja hyrëse, Lighthouse, crawl',
  auditing: 'auditim: modulet dhe renderimi vizual',
  scoring: 'pikëzim dhe shkrim i raportit',
  completed: 'motori përfundoi',
};

const badge = (cls: string, text: string) => html`<span class="badge b-${cls}">${text}</span>`;
const token = (t: string) => html`<input type="hidden" name="token" value="${t}">`;
const errorsBox = (errors?: string[]) => (errors?.length ? html`<div class="warnbox errors"><strong>S'u nis:</strong><ul class="plain">${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : '');

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function checkbox(name: string, label: string, checked: boolean, note?: string): SafeHtml {
  return html`<label class="check"><input type="checkbox" name="${name}" ${checked ? html`checked` : ''}> ${label}${note ? html` <span class="note">${note}</span>` : ''}</label>`;
}

/** Mjedisi i kësaj nisjeje: shfletuesi për Lighthouse dhe ku ruhen raportet/konfigurimi. */
export interface AuditEnv {
  browser: BrowserLookup;
  /** Git në PATH (për auditin e repo-ve). */
  git: boolean;
  outputDir: string;
  configPath: string;
}

function browserBox(env: AuditEnv): SafeHtml {
  const b = env.browser.browser;
  if (b) {
    return html`<div class="note">Lighthouse dhe pamja vizuale përdorin <b>${b.name}</b> (<span class="code">${b.path}</span>)${b.source === 'edge' ? " — Chrome s'u gjet, u përdor Edge." : '.'}</div>`;
  }
  return html`<div class="warnbox" id="pa-shfletues"><b>${env.browser.disabled ? 'Shfletuesi është çaktivizuar (SEO_TOOL_BROWSER=none).' : "S'u gjet Chrome ose Edge në këtë kompjuter."}</b>${env.browser.invalidConfigured ? html` Shtegu në config.json s'ekziston: <span class="code">${env.browser.invalidConfigured}</span>.` : ''}
<ul>
<li>Auditi i URL-së vazhdon pa Lighthouse dhe pa pamjen vizuale. Performance, Accessibility dhe Best Practices dalin "skipped", ndaj Health Score s'gjenerohet. Kontrollet e tjera kryhen normalisht.</li>
<li>Auditet e dosjes dhe të repo-s s'kanë nevojë për shfletues.</li>
<li>Për Lighthouse: instalo Google Chrome ose Microsoft Edge, pastaj rifresko këtë faqe.</li>
<li>Nëse shfletuesi është në një vend tjetër, shkruaje te <span class="code">${env.configPath}</span>: <span class="code">{"lighthouse": {"chromePath": "C:\\\\Rruga\\\\chrome.exe"}}</span> (në JSON, çdo <span class="code">\\</span> shkruhet dy herë).</li>
</ul></div>`;
}

/** Butoni "Hap dosjen e raporteve" (POST me token; serveri hap vetëm dosjen e vet të raporteve). */
export function openReportsForm(csrf: string, back: '/reports' | '/audit'): SafeHtml {
  return html`<form method="post" action="/open-reports" class="inline">${token(csrf)}<input type="hidden" name="back" value="${back}"><button type="submit" class="secondary">Hap dosjen e raporteve</button></form>`;
}

export function auditFormsView(csrf: string, running: Job[], limit: number, state: FormState = {}, env?: AuditEnv): string {
  const v = state.values ?? {};
  const urlChecked = (k: keyof typeof URL_DEFAULTS) => (state.kind === 'url' ? v[k] === 'on' : (URL_DEFAULTS[k] as boolean));
  const full = running.length >= limit;
  return layout(
    'Nis audit',
    html`<h1>Nis audit</h1>
<p class="sub">Auditet ekzekutohen nga i njëjti motor si CLI-ja (<span class="code">npm run audit</span> / <span class="code">seo-audit.cmd</span>), në këtë kompjuter. Raporti ruhet te dosja e raporteve dhe del te lista.</p>
<div class="${full ? 'warnbox' : 'note'}">Në punë: ${running.length}/${limit} audite njëkohësisht.${full ? ' Kufiri u arrit: prit ose anulo një punë.' : ''} ${running.length ? html`<a href="/jobs">Shiko punët</a>` : ''}</div>
${env ? browserBox(env) : ''}
${env ? html`<div class="row-actions"><span class="note">Raportet ruhen te <span class="code">${displayDir(env.outputDir)}</span> (butoni e hap në Explorer).</span> ${openReportsForm(csrf, '/audit')}</div>` : ''}
<div class="grid forms">
<section class="panel" id="url"><h2>Audit URL</h2>
${state.kind === 'url' ? errorsBox(state.errors) : ''}
<form method="post" action="/audit/url">${token(csrf)}
<label class="field">URL e sitit<input type="text" name="url" value="${state.kind === 'url' ? v.url ?? '' : ''}" placeholder="https://siti-yt.al" required maxlength="2048"></label>
<div class="row"><label class="field">Faqe maksimale (crawl)<input type="number" name="maxPages" min="1" max="${MAX_PAGES}" value="${state.kind === 'url' ? v.maxPages ?? URL_DEFAULTS.maxPages : URL_DEFAULTS.maxPages}"></label>
<label class="field">Thellësia e linkeve<input type="number" name="maxDepth" min="0" max="${MAX_DEPTH}" value="${state.kind === 'url' ? v.maxDepth ?? URL_DEFAULTS.maxDepth : URL_DEFAULTS.maxDepth}"></label></div>
${checkbox('crawl', 'Crawl i kufizuar i sitit', urlChecked('crawl'), `(parazgjedhje: po; maks. ${MAX_PAGES} faqe)`)}
${checkbox('lighthouse', 'Lighthouse mobile', urlChecked('lighthouse'), '(parazgjedhje: po; kërkon Chrome ose Edge)')}
<label class="field">Matje Lighthouse (faqja hyrëse)<input type="number" name="lighthouseRuns" min="1" max="${MAX_LH_RUNS}" value="${state.kind === 'url' ? v.lighthouseRuns ?? URL_DEFAULTS.lighthouseRuns : URL_DEFAULTS.lighthouseRuns}"></label>
<p class="note">Parazgjedhje 1, maks. ${MAX_LH_RUNS}. Përsëritet vetëm Lighthouse (~30–60 s secila matje); crawl-i dhe kontrollet e tjera bëhen një herë. Health dhe issue-t vijnë nga matja përfaqësuese (Performance mediane).</p>
${checkbox('business', 'Biznes & privatësi', urlChecked('business'), '(parazgjedhje: po)')}
${checkbox('quality', 'Cilësia e përmbajtjes', urlChecked('quality'), '(parazgjedhje: po; sinjale, jashtë Health)')}
${checkbox('visual', 'Pamja desktop + mobile', urlChecked('visual'), '(parazgjedhje: po; kërkon Chrome ose Edge)')}
${checkbox('saveLhr', 'Ruaj LHR-në e plotë', urlChecked('saveLhr'), '(parazgjedhje: jo; mund të përmbajë të dhëna të faqes)')}
${checkbox('ignoreRobots', 'Anashkalo robots.txt', urlChecked('ignoreRobots'), '(parazgjedhje: jo; vetëm për site që i kontrollon vetë)')}
<p class="note">Kufijtë e rrjetit mbeten ata të motorit: robots.txt, ≥ 500 ms mes kërkesave për host, pa login/cart/checkout, pa dërguar formularë.</p>
<button type="submit" ${full ? html`disabled` : ''}>Nis auditin e URL-së</button></form></section>

<section class="panel" id="folder"><h2>Dosje lokale</h2>
${state.kind === 'folder' ? errorsBox(state.errors) : ''}
<form method="post" action="/audit/folder/check">${token(csrf)}
<label class="field">Shtegu i plotë i dosjes<input type="text" name="path" value="${state.kind === 'folder' ? v.path ?? '' : ''}" placeholder="C:\\Projekte\\siti-im" required maxlength="1000"></label>
<p class="note">Hapi tjetër tregon dosjen reale që do të lexohet (pas symlink/junction) dhe kërkon konfirmim. Vetëm lexim skedarësh: s'ekzekutohet asnjë skript, build apo <span class="code">npm install</span>. S'lejohen shtigje rrjeti, rrënja e diskut, dosja e përdoruesit si e tërë, dosjet e sistemit.</p>
<button type="submit" ${full ? html`disabled` : ''}>Kontrollo dosjen</button></form></section>

<section class="panel" id="repo"><h2>Repo publike</h2>
${state.kind === 'repo' ? errorsBox(state.errors) : ''}
${env && !env.git ? html`<div class="warnbox" id="pa-git"><b>S'u gjet Git në këtë kompjuter.</b> Auditi i repo-ve ka nevojë për Git (klon i cekët), që s'paketohet me programin. Instalo Git for Windows (https://git-scm.com/download/win), pastaj mbyll dhe rihap SEO Tool. Auditet e URL-së dhe të dosjeve s'kanë nevojë për Git.</div>` : ''}
<form method="post" action="/audit/repo">${token(csrf)}
<label class="field">URL e repo-s (https)<input type="text" name="repo" value="${state.kind === 'repo' ? v.repo ?? '' : ''}" placeholder="https://github.com/emri/repo" required maxlength="500"></label>
<p class="note">Klon i cekët i përkohshëm me kufijtë ekzistues (madhësia, koha), pa skripte, hooks, LFS, submodule apo kredenciale; fshihet pas auditit. Repo private s'mbështeten.</p>
<button type="submit" ${full || (env && !env.git) ? html`disabled` : ''}>Nis auditin e repo-s</button></form></section>
</div>`,
  );
}

export function folderConfirmView(csrf: string, check: FolderCheck, input: string): string {
  const e = check.entries!;
  return layout(
    'Konfirmo dosjen',
    html`<h1>Konfirmo dosjen</h1>
<section class="panel scope"><h2>Do të lexohet kjo dosje</h2>
<p class="bigpath code">${check.realPath}</p>
${input.trim() !== check.realPath ? html`<p class="note">U shkrua: <span class="code">${input}</span> — shtegu real (pas symlink/junction) është ai më sipër.</p>` : ''}
<p class="note">${e.count} hyrje në nivelin e parë${e.sample.length ? html`, p.sh.: ${e.sample.map((n, i) => html`${i ? ', ' : ''}<span class="code">${n}</span>`)}${e.count > e.sample.length ? ' …' : ''}` : ''}</p>
<p class="note">Vetëm lexim skedarësh me kufijtë ekzistues. S'ekzekutohet kod i projektit. Dosjet si <span class="code">node_modules</span> dhe <span class="code">.git</span> anashkalohen; symlink-et s'ndiqen.</p>
<form method="post" action="/audit/folder/start">${token(csrf)}<input type="hidden" name="path" value="${check.realPath}">
<button type="submit">Po, audito këtë dosje</button> <a href="/audit#folder">Anulo</a></form></section>`,
  );
}

export function jobsListView(jobs: Job[], limit: number): string {
  const now = Date.now();
  return layout(
    'Punët',
    html`<h1>Punët e auditit</h1><p class="sub">Në punë: ${jobs.filter((j) => j.state === 'running' || j.state === 'cancelling').length}/${limit}. Lista mbahet vetëm sa është hapur dashboard-i; raportet mbeten te dosja e raporteve.</p>
<div class="panel"><table><thead><tr><th>Nisur</th><th>Lloji</th><th>Objekti</th><th>Gjendja</th><th class="num">Kohëzgjatja</th><th>Raporti</th></tr></thead><tbody>
${jobs.length ? jobs.map((j) => html`<tr><td class="nowrap"><a href="/jobs/${j.id}">${new Date(j.startedAt).toLocaleTimeString('sq-AL', { hour12: false })}</a></td><td>${KIND[j.kind]}</td><td>${truncate(j.target, 60)}</td>
<td>${badge(STATE[j.state].cls, STATE[j.state].label)}</td><td class="num">${duration((j.endedAt ?? now) - j.startedAt)}</td>
<td>${j.state === 'completed' && j.reportFile ? html`<a href="/report/${encodeURIComponent(j.reportFile)}">Hap raportin</a>` : html`<span class="note">—</span>`}</td></tr>`) : html`<tr><td colspan="6" class="note">S'ka punë ende. <a href="/audit">Nis një audit</a>.</td></tr>`}
</tbody></table></div>`,
  );
}

export function jobView(job: Job, csrf: string): string {
  const active = job.state === 'running' || job.state === 'cancelling';
  const st = STATE[job.state];
  const elapsed = duration((job.endedAt ?? Date.now()) - job.startedAt);
  // Më të rejat në krye: hapi aktual duket pa lëvizur faqen.
  const events = job.events.slice(-40).reverse();
  return layout(
    `${STATE[job.state].label} · ${truncate(job.target, 40)}`,
    html`<h1>${KIND[job.kind]}: ${job.kind === 'url' || job.kind === 'repo' ? externalLink(job.target) : html`<span class="code">${job.target}</span>`}</h1>
<p class="sub">${badge(st.cls, st.label)} · nisur ${new Date(job.startedAt).toLocaleString('sq-AL', { hour12: false })} · ${elapsed}${active ? ' · faqja rifreskohet çdo 2 s' : ''}</p>
${job.state === 'completed' ? html`<div class="panel scope"><h2>Raporti u krijua</h2>
<p><a href="/report/${encodeURIComponent(job.reportFile ?? '')}">Hap raportin: ${job.reportFile}</a> ${job.reportStatus ? badge(job.reportStatus === 'completed' ? 'complete' : 'partial', job.reportStatus === 'completed' ? 'audit i përfunduar' : job.reportStatus === 'partial' ? 'audit i pjesshëm' : `audit ${job.reportStatus}`) : ''}</p>
${job.note ? html`<p class="note">${job.note}</p>` : ''}</div>` : ''}
${job.state === 'failed' ? html`<div class="panel"><h2>Auditi dështoi <span class="note">(kodi i daljes ${job.exitCode ?? '—'})</span></h2><pre>${truncate(job.error ?? 'Pa mesazh gabimi.', 3000)}</pre><p class="note">S'u krijua raport.</p></div>` : ''}
${job.state === 'cancelled' ? html`<div class="panel"><h2>Auditi u anulua</h2><p class="note">Procesi u ndal para se të shkruante raport: <strong>s'u krijua raport</strong> dhe kjo punë s'numërohet si audit i përfunduar. Mund të kenë mbetur screenshot-e të pjesshme te <span class="code">output/visual/</span>.</p></div>` : ''}
${active ? html`<div class="panel"><h2>Progresi</h2>
<dl class="kv"><dt>Faza e motorit</dt><dd>${job.engineStatus ? ENGINE_STATUS[job.engineStatus] ?? job.engineStatus : job.kind === 'url' ? 'nisje…' : 'sipas hapave më poshtë'}</dd>
${job.crawl ? html`<dt>Crawl</dt><dd>faqja ${job.crawl.done} nga maks. ${job.crawl.max} <span class="note">(kufiri; totali i sitit s'dihet paraprakisht)</span><div class="note">${truncate(job.crawl.url, 100)}</div></dd>` : ''}</dl>
${job.state === 'running' ? html`<form method="post" action="/jobs/${job.id}/cancel">${token(csrf)}<button type="submit" class="danger">Anulo auditin</button></form>` : html`<p class="note">Po ndalet procesi…</p>`}</div>` : ''}
<div class="panel"><h2>Opsionet</h2><ul class="plain">${job.options.map((o) => html`<li>${o}</li>`)}</ul><p class="note">Ekuivalenti në CLI: <span class="code">${job.command}</span></p></div>
<div class="panel"><h2>Hapat që raportoi motori <span class="note">(${job.events.length}, më i fundit në krye)</span></h2>
${events.length ? html`<pre>${events.map((e) => `${new Date(e.at).toLocaleTimeString('sq-AL', { hour12: false })}  ${e.text}`).join('\n')}</pre>` : html`<p class="note">Ende pa hapa.</p>`}</div>`,
    active ? 2 : undefined,
  );
}
