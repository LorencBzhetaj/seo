import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/core/schemas.js';
import { toIssue } from '../src/modules/quality/quality.js';
import { parsePage } from '../src/parse/page.js';
import { textPageFrom } from '../src/quality/pages.js';
import { analyzeText } from '../src/quality/text.js';
import { groupQualityIssues } from '../src/report/quality.js';

/** Si te gjecaj.al: kartat me titull, me "Read more →"/"Details"/"Detaje" në faqe të ndryshme. */
const cards = (link: string, titles: string[], base: string) =>
  titles.map((t, i) => `<div class="card"><h3>${t}</h3><p>Përshkrim i shkurtër.</p><a href="${base}${i}/">${link}</a></div>`).join('');
const page = (url: string, body: string) => textPageFrom(url, parsePage(`<html lang="en"><body><main>${body}</main></body></html>`, url));
const asIssues = (pages: ReturnType<typeof page>[]): Issue[] =>
  analyzeText(pages).signals.map((s) => ({ ...toIssue(s), module: 'content-quality', confidence: s.confidence, affectedPages: [s.target, ...s.related], priority: 4, needsManualReview: true }));

describe('Grupimi i gjetjeve me të njëjtin model (terminal)', () => {
  const issues = asIssues([
    page('https://e.com/', cards('Read more →', ['The Flavors of Theth', 'A Guide to Theth', 'Our Roots'], '/journal/')),
    page('https://e.com/rooms/', cards('Details', ['Deluxe Double', 'Deluxe Triple', 'Traditional Room'], '/rooms/')),
    page('https://e.com/sq/dhomat/', cards('Detaje', ['Dhomë Dopio', 'Dhomë Treshe', 'Dhoma Tradicionale'], '/sq/dhomat/')),
  ]);

  it('3 LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT me emra të ndryshëm → një grup me 3 faqe; JSON mban 3 gjetje me prova veç', () => {
    expect(issues.map((i) => i.code)).toEqual(Array(3).fill('LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT'));
    const g = groupQualityIssues(issues);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ code: 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', count: 3, severity: 'low', pages: ['https://e.com/', 'https://e.com/rooms/', 'https://e.com/sq/dhomat/'] });
    expect(g[0]!.summary).toBe('Linke me emër të përgjithshëm ("Read more →", "Details", "Detaje") brenda kartave me titull — mund të jenë të paqarta kur lexohen veçmas');
    // provat e secilës faqe mbeten te issues (JSON), të pandryshuara
    expect(issues.map((i) => i.evidence[0]!.detected.match(/konteksti pranë: "([^"]+)"/)![1])).toEqual(['The Flavors of Theth', 'Deluxe Double', 'Dhomë Dopio']);
  });

  it('modele të ndryshme s\'bashkohen: kodi tjetër, ose linke pa kontekst (GENERIC_LINK_TEXT_REPEATED)', () => {
    const noContext = asIssues([page('https://e.com/blog/', '<div><a href="/a">Read more</a> <a href="/b">Read more</a> <a href="/c">Read more</a></div>')]);
    expect(noContext.map((i) => i.code)).toEqual(['GENERIC_LINK_TEXT_REPEATED']);
    const g = groupQualityIssues([...issues, ...noContext]);
    expect(g.map((x) => [x.code, x.count])).toEqual([['LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', 3], ['GENERIC_LINK_TEXT_REPEATED', 1]]);
    // grup me një gjetje: mesazhi origjinal, jo përmbledhja
    expect(g[1]!.summary).toBe(noContext[0]!.message);
  });

  it('i njëjti kod, por burim tjetër i emrit (aria-label gjenerik) → grup më vete', () => {
    const aria = asIssues([page('https://e.com/x/', ['A', 'B', 'C'].map((t, i) => `<div><h3>${t}</h3><a href="/x${i}" aria-label="Read more">Read more</a></div>`).join(''))]);
    expect(aria[0]!.evidence[0]!.detected).toContain('burimi: aria-label');
    expect(groupQualityIssues([...issues, ...aria]).map((x) => x.count)).toEqual([3, 1]);
  });
});
