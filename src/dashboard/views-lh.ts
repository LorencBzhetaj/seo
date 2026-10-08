import { html, truncate, type SafeHtml } from './html.js';
import { arr, num, obj, str, type Obj } from './store.js';

/**
 * Rezultatet e Lighthouse të faqes hyrëse, secila me emrin dhe burimin e vet:
 * Performance / Accessibility / Best Practices (në Health), "Lighthouse SEO" (veç nga SEO teknik i mjetit)
 * dhe "Agentic Browsing" (eksperimentale, si thyesë kontrollesh; jashtë Health, s'mat trafik, renditje apo AI).
 * Raportet e vjetra pa këto fusha thonë "s'u mat në këtë raport", jo 0.
 */

const RESULT_LABELS: Record<string, [string, string]> = {
  pass: ['kaloi', 'complete'],
  fail: ["s'kaloi", 'fail'],
  'not-applicable': ['N/A', 'skipped'],
  informative: ['informative', 'info'],
  manual: ['manual', 'skipped'],
  error: ['gabim', 'warning'],
};

/** Përshkrimi i matjes: version, pajisja, data dhe sa matje (seri ose e vetme). */
export function lhSourceText(r: Obj): string {
  const lh = obj(r.lighthouse);
  if (!str(lh.version)) return '';
  const series = obj(lh.series);
  const runs = num(series.planned) && (num(series.planned) ?? 0) > 1 ? `seri ${num(series.valid) ?? 0}/${num(series.planned)} matje, vlerat nga matja përfaqësuese` : 'një matje';
  return `Lighthouse ${str(lh.version)} · ${str(lh.formFactor) || 'mobile'} · lab (${str(lh.throttlingMethod) || 'simulate'}) · ${str(lh.fetchTime).slice(0, 10)} · ${runs}`;
}

export interface AgenticView {
  status: 'ok' | 'skipped' | 'absent';
  text: string;
  sub: string;
}

/** Agentic Browsing për një kartë: "N/M kontrolle të kaluara", "skipped" me arsye, ose "s'u mat" (raport i vjetër). */
export function agenticView(r: Obj): AgenticView {
  const a = obj(obj(r.lighthouse).agenticBrowsing);
  if (!r.lighthouse || !a.status) return { status: 'absent', text: "s'u mat", sub: 'raport para Agentic Browsing' };
  if (a.status !== 'ok') return { status: 'skipped', text: 'skipped', sub: truncate(str(a.reason), 160) };
  const na = num(a.notApplicable) ?? 0;
  return { status: 'ok', text: `${num(a.passed) ?? 0}/${num(a.passable) ?? 0}`, sub: `kontrolle të kaluara${na ? ` · ${na} N/A` : ''}` };
}

function cell(k: string, v: SafeHtml | string, d: string, exp = false): SafeHtml {
  return html`<div class="lh${exp ? ' exp' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="note">${d}</div></div>`;
}

const score = (n: number | null) => (n === null ? html`<span class="v none">s'ka pikë</span>` : html`${String(n)}<small>/100</small>`);

/** Kartat e Lighthouse (pa tabelën e kontrolleve). */
export function lhCards(r: Obj): SafeHtml {
  const cats = obj(r.categories);
  const seo = obj(obj(r.lighthouse).seoCategory);
  const ag = agenticView(r);
  return html`<div class="lhgrid">
${cell('Performance', score(num(cats.performance)), 'mobile, lab · në Health')}
${cell('Accessibility', score(num(cats.accessibility)), 'kontrolle automatike · në Health')}
${cell('Best Practices', score(num(cats.bestPractices)), 'në Health')}
${obj(r.lighthouse).seoCategory ? cell('Lighthouse SEO', score(num(seo.score)), 'kategoria e Lighthouse · jashtë Health') : cell('Lighthouse SEO', html`<span class="v none">s'u ruajt</span>`, 'raport para kësaj fushe')}
${cell('Agentic Browsing', ag.status === 'ok' ? ag.text : html`<span class="v none">${ag.text}</span>`, `eksperimentale · ${ag.sub} · jashtë Health`, true)}
</div>`;
}

/**
 * Përmbledhja: të njëjtat pesë rezultate si një tabelë kompakte me etiketa shqip. Emri origjinal i kategorisë
 * së Lighthouse mbetet në `title` (dhe te raporti, me kontrollet).
 */
export function lhRows(r: Obj): SafeHtml {
  const cats = obj(r.categories);
  const seo = obj(obj(r.lighthouse).seoCategory);
  const ag = agenticView(r);
  const rowScore = (n: number | null) => (n === null ? html`<span class="none">s'ka pikë</span>` : html`<strong>${String(n)}</strong><small>/100</small>`);
  const row = (label: string, orig: string, v: SafeHtml, d: string) => html`<tr><th scope="row"><abbr title="Lighthouse: ${orig}">${label}</abbr></th><td class="num">${v}</td><td class="note">${d}</td></tr>`;
  return html`<div class="tablewrap"><table class="keep lhtable"><thead><tr><th scope="col">Kategoria</th><th scope="col" class="num">Rezultati</th><th scope="col">Shënim</th></tr></thead><tbody>
${row('Performanca', 'Performance', rowScore(num(cats.performance)), 'mobile, lab · në Health')}
${row('Aksesueshmëria', 'Accessibility', rowScore(num(cats.accessibility)), 'kontrolle automatike · në Health')}
${row('Praktikat e mira', 'Best Practices', rowScore(num(cats.bestPractices)), 'në Health')}
${row('SEO sipas Lighthouse', 'Lighthouse SEO', obj(r.lighthouse).seoCategory ? rowScore(num(seo.score)) : html`<span class="none">s'u ruajt</span>`, obj(r.lighthouse).seoCategory ? 'jashtë Health · ndryshe nga SEO teknik i mjetit' : 'raport para kësaj fushe')}
${row('Shfletimi nga agjentë AI', 'Agentic Browsing', ag.status === 'ok' ? html`<strong>${ag.text}</strong>` : html`<span class="none">${ag.text}</span>`, `eksperimentale · ${ag.sub} · jashtë Health`)}
</tbody></table></div>`;
}

/** Paneli i plotë i raportit: kartat + kontrollet e Agentic Browsing me statusin dhe provat e secilit. */
export function lhPanel(r: Obj): SafeHtml {
  const a = obj(obj(r.lighthouse).agenticBrowsing);
  const src = lhSourceText(r);
  const audits = arr(a.audits).map(obj);
  return html`<section class="panel" id="lighthouse"><h2>Lighthouse — faqja hyrëse</h2>
<p class="hint">${src ? `${src}.` : "Pa rezultat Lighthouse në këtë raport."} SEO teknik i mjetit (te Health) dhe "Lighthouse SEO" janë matje të ndryshme.</p>
${lhCards(r)}
${a.status === 'ok' ? html`<details class="issue" id="agentic"><summary><strong>Agentic Browsing</strong> <span class="badge b-warning">eksperimentale</span> <span class="note">${num(a.passed) ?? 0}/${num(a.passable) ?? 0} kontrolle të kaluara · ${String(audits.length)} kontrolle gjithsej</span></summary>
<div class="body"><p class="note">Kategori eksperimentale e Lighthouse ${str(a.lighthouseVersion)}: kontrollon nëse faqja është e lexueshme dhe e përdorshme për agjentë AI në browser (pema e aksesueshmërisë, WebMCP, llms.txt, katalogu i burimeve). Rezultati është në formën që e jep Lighthouse (kaluar / të vlerësueshme; N/A dhe informative jashtë thyesës). <strong>S'hyn në Health Score</strong> dhe s'mat trafik, renditje në Google apo përmendje nga AI. Kur Lighthouse e quan një kontroll N/A (p.sh. llms.txt mungon), s'është defekt.</p>
<div class="tablewrap"><table class="keep"><thead><tr><th>Kontrolli</th><th>Grupi</th><th>Statusi</th><th>Rezultati / prova</th></tr></thead><tbody>
${audits.map((x) => {
    const [label, cls] = RESULT_LABELS[str(x.result)] ?? [str(x.result), 'unknown'];
    const items = arr(x.items).map(str);
    return html`<tr><td>${str(x.title)}<div class="code">${str(x.id)}</div></td><td class="note">${str(x.group) || '—'}</td><td><span class="badge b-${cls}">${label}</span></td>
<td class="note">${str(x.displayValue)}${str(x.explanation) ? html`<div>${str(x.explanation)}</div>` : ''}${str(x.errorMessage) ? html`<div class="miss">${str(x.errorMessage)}</div>` : ''}${items.length ? html`<ul class="plain">${items.map((i) => html`<li>${i}</li>`)}</ul>${(num(x.itemsTotal) ?? 0) > items.length ? html`<div>… +${String((num(x.itemsTotal) ?? 0) - items.length)} në LHR</div>` : ''}` : ''}</td></tr>`;
  })}
</tbody></table></div></div></details>` : a.status ? html`<p class="note">Agentic Browsing: <strong>skipped</strong> — ${str(a.reason)}</p>` : ''}
</section>`;
}
