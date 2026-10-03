import { html, type SafeHtml } from './html.js';
import { SERIES_KEYS, SERIES_VERDICT_LABELS, type SeriesCompare, type SeriesKey, type SeriesView, type StatView } from './lh-series.js';

/**
 * Seria e matjeve Lighthouse (faza 4): çdo matje veç, përmbledhja (mediana, min–max, n) dhe krahasimi i dy
 * serive. Variacioni shfaqet gjithmonë; asnjë ndryshim s'quhet "përmirësim i konfirmuar".
 */

const UNIT: Record<SeriesKey, 'score' | 'ms' | 'cls'> = Object.fromEntries(SERIES_KEYS.map((k) => [k.key, k.unit])) as Record<SeriesKey, 'score' | 'ms' | 'cls'>;

export function fmtValue(key: SeriesKey, v: number | null | undefined): string {
  if (typeof v !== 'number') return '—';
  if (UNIT[key] === 'cls') return v.toFixed(3);
  if (UNIT[key] === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const statText = (key: SeriesKey, s: StatView) => (s.n ? `${fmtValue(key, s.median)} (${fmtValue(key, s.min)}–${fmtValue(key, s.max)})` : '—');
const time = (iso: string) => (iso ? iso.slice(11, 19) : '—');
const secs = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 1000)} s`);

/** Paneli në raport: vetëm kur raporti ka seri (≥ 2 matje të planifikuara). */
export function seriesPanel(s: SeriesView, lhrHref: (name: string) => string | null): SafeHtml {
  const shown: SeriesKey[] = ['performance', 'accessibility', 'bestPractices', 'seo', 'lcpMs', 'cls', 'tbtMs'];
  return html`<section class="panel scope" id="lighthouse-seria"><h2>Lighthouse: seri matjesh <span class="note">(${String(s.valid)} të vlefshme nga ${String(s.planned)} të planifikuara${s.totalMs !== null ? ` · ${secs(s.totalMs)} gjithsej` : ''})</span></h2>
${s.insufficient ? html`<div class="warnbox errors"><strong>${insufficientText(s)}</strong> — rezultati ruhet, por s'ka interval; s'trajtohet si seri me variacion të matur.</div>` : ''}
${s.valid < s.planned ? html`<div class="warnbox">${String(s.planned - s.valid)} matje dështuan dhe s'hyjnë në statistika. Përmbledhja vlen vetëm për ${String(s.valid)} matjet e vlefshme${s.valid === 0 ? ' — asnjë rezultat, asgjë s\'u shpik' : ''}.</div>` : ''}
${s.configConsistent ? '' : html`<div class="warnbox">Konfigurim i ndryshëm brenda serisë: ${s.configNotes.join('; ')}</div>`}
<p class="note"><strong>Burimi i vlerave:</strong> ${s.rule || "Health dhe issue-t vijnë nga matja përfaqësuese."}${s.representativeRun !== null ? html` Matja përfaqësuese: <strong>#${String(s.representativeRun)}</strong>.` : ''}</p>
<table><thead><tr><th>Statistika</th>${shown.map((k) => html`<th class="num">${SERIES_KEYS.find((x) => x.key === k)!.label}</th>`)}</tr></thead><tbody>
<tr><td>Mediana</td>${shown.map((k) => html`<td class="num"><strong>${fmtValue(k, s.stats[k].median)}</strong></td>`)}</tr>
<tr><td>Min–max</td>${shown.map((k) => html`<td class="num">${s.stats[k].n ? `${fmtValue(k, s.stats[k].min)}–${fmtValue(k, s.stats[k].max)}` : '—'}</td>`)}</tr>
<tr><td>Matje të vlefshme</td>${shown.map((k) => html`<td class="num">${String(s.stats[k].n)}</td>`)}</tr>
</tbody></table>
<h3>Çdo matje</h3>
<table><thead><tr><th>#</th><th>Ora (UTC)</th><th>Statusi</th>${shown.map((k) => html`<th class="num">${SERIES_KEYS.find((x) => x.key === k)!.label}</th>`)}<th>Riprovime teknike</th><th class="num">Kohëzgjatja</th><th>LHR</th></tr></thead><tbody>
${s.runs.map((r) => {
    const lhr = r.lhrFile ? lhrHref(r.lhrFile) : null;
    return html`<tr><td>${String(r.run)}${r.run === s.representativeRun ? html` <span class="badge b-complete">përfaqësuese</span>` : ''}</td><td class="nowrap">${time(r.startedAt)}</td>
<td>${r.status === 'ok' ? html`<span class="badge b-complete">e vlefshme</span>` : html`<span class="badge b-fail">dështoi</span><div class="note">${r.errorCode || 'gabim'}: ${r.error.slice(0, 160)}</div>`}</td>
${shown.map((k) => html`<td class="num">${fmtValue(k, r.values[k])}</td>`)}
<td class="note">${r.technicalRetries.length ? `${r.technicalRetries.length}× ${r.technicalRetries.map((t) => t.code || 'gabim').join(', ')} (brenda së njëjtës matje)` : '—'}</td>
<td class="num">${secs(r.durationMs)}</td><td>${r.lhrFile ? (lhr ? html`<a href="${lhr}">shkarko</a>` : html`<span class="note">mungon lokalisht</span>`) : html`<span class="note">—</span>`}</td></tr>`;
  })}
</tbody></table>
<p class="note">Riprovimi teknik (p.sh. NO_NAVSTART: gabim i trace-it në Chrome) ndodh brenda së njëjtës matje të planifikuar dhe s'numërohet si matje e re. Mediana dhe min–max janë informative: Health Score dhe issue-t s'përzihen mes matjeve.</p></section>`;
}

/** Teksti i dukshëm për seri me < 2 matje të vlefshme. */
export const insufficientText = (s: SeriesView) => `seri me prova të pamjaftueshme: ${s.valid}/${s.planned} matje të vlefshme`;

const DIR: Record<string, string> = { up: 'rritje', down: 'ulje', same: 'e njëjtë' };

/** Krahasimi i dy serive në faqen e krahasimit. */
export function seriesComparePanel(c: SeriesCompare): SafeHtml {
  const kind = (s: SeriesView) => (s.real ? `seri: ${s.valid}/${s.planned} të vlefshme` : 'raport me 1 matje');
  const weak = ([['A', c.a], ['B', c.b]] as const).filter(([, s]) => s.insufficient);
  return html`<section class="panel scope" id="lighthouse-seria"><h2>Lighthouse: krahasimi i serive <span class="note">(A ${kind(c.a)} → B ${kind(c.b)})</span></h2>
${c.comparable ? '' : html`<div class="warnbox"><strong>S'krahasohen:</strong> konfigurim i ndryshëm i Lighthouse — ${c.differences.join('; ')}. Vlerat shfaqen vetëm për informacion.</div>`}
${weak.length ? html`<div class="warnbox errors">${weak.map(([n, s], i) => html`${i ? html`<br>` : ''}<strong>${n}: ${insufficientText(s)}</strong>`)} — pa interval; rreshtat e saj krahasohen si matje të vetme.</div>` : ''}
${c.machineWarning ? html`<div class="warnbox"><strong>Kujdes:</strong> ${c.machineWarning}</div>` : ''}
${c.notes.length ? html`<ul class="plain">${c.notes.map((n) => html`<li class="note">${n}</li>`)}</ul>` : ''}
${c.comparable ? html`<table><thead><tr><th>Metrika</th><th class="num">A: mediana (min–max)</th><th class="num">B: mediana (min–max)</th><th>Mediana</th><th>Vlerësimi</th><th>Shënim</th></tr></thead><tbody>
${c.rows.map((r) => html`<tr><td>${r.label}</td><td class="num">${statText(r.key, r.a)} <span class="note">n=${String(r.a.n)}</span></td><td class="num">${statText(r.key, r.b)} <span class="note">n=${String(r.b.n)}</span></td>
<td>${r.direction ? DIR[r.direction] : '—'}</td><td><span class="badge b-${r.verdict === 'outside' ? 'warning' : r.verdict === 'overlap' ? 'noise' : 'not-comparable'}">${SERIES_VERDICT_LABELS[r.verdict]}</span></td><td class="note">${r.note}</td></tr>`)}
</tbody></table>
<p class="note">Intervalet min–max janë orientuese: 3–5 matje s'mjaftojnë për përfundim statistikor. Asnjë ndryshim s'quhet "përmirësim i konfirmuar": seritë janë të vogla, laboratorike dhe në kohë të ndryshme. "Rritje/ulje" përshkruan vetëm medianën; për LCP/CLS/TBT/FCP/Speed Index vlera më e ulët është më e mirë.</p>` : ''}
</section>`;
}
