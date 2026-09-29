import { describe, expect, it } from 'vitest';
import type { AuditContext } from '../src/core/context.js';
import { runModules, MVP1_MODULES, BUSINESS_MODULES, type AuditRun } from '../src/core/run.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { runConversion } from '../src/modules/business/conversion.js';
import { runPrivacy } from '../src/modules/business/privacy.js';
import { buildReport } from '../src/report/json.js';
import { renderTerminal } from '../src/report/terminal.js';
import { parsePage } from '../src/parse/page.js';
import { sortIssues } from '../src/intelligence/priority.js';
import { categoryScores, computeHealth } from '../src/scoring/scorer.js';
import { lighthouseFixture } from './helpers.js';
import { htmlPage, siteCtx } from './site-helpers.js';

const B = 'https://e.com';
const bookingForm = '<form id="gjbForm" class="gjb-form" novalidate><label>Emri <input name="name" required></label><label>Email <input type="email" name="email" required></label><label>In <input type="date" name="checkin"></label><button>Dërgo</button></form>';
const newsletter = '<form action="https://x.sibforms.com/serve/TOKEN" method="post"><label>Email <input type="email" name="EMAIL" required></label><button>Subscribe</button></form>';
const withFooter = (main: string) => htmlPage({ title: 'T', main: `<a class="btn" href="/book">Book a table</a><a href="tel:+355671234567">Thirr</a>${main}`, extra: '<footer><a href="/privacy/">Privacy Policy</a><a href="https://www.tripadvisor.com/x">Tripadvisor</a></footer>' });

function makeRun(ctx: AuditContext): AuditRun {
  const results = runModules(ctx, [...MVP1_MODULES, ...BUSINESS_MODULES]);
  const home = results.filter((r) => r.section === 'homepage');
  return {
    id: 'r', url: ctx.url, startedAt: '2026-09-29T12:00:00.000Z', completedAt: '2026-09-29T12:01:00.000Z', status: 'completed', config: ctx.config, context: ctx, results,
    issues: sortIssues(home.flatMap((r) => r.issues)), siteIssues: [], qualityIssues: [], businessIssues: sortIssues(results.filter((r) => r.section === 'business').flatMap((r) => r.issues)),
    categories: categoryScores(home), health: computeHealth(home, home.flatMap((r) => r.issues)), scoringVersion: '1.0', ruleSetVersion: 'test',
  };
}

describe('Rishikimi i MVP-3: identiteti i formularëve', () => {
  it('i njëjti komponent në shumë faqe = 1 formular, me numrin e faqeve', () => {
    const pages = [1, 2, 3].map((i) => ({ url: `${B}/p${i}/`, html: withFooter(bookingForm) }));
    const r = runConversion(siteCtx([{ url: `${B}/`, html: withFooter(bookingForm) }, ...pages]));
    const obs = r.checks.find((c) => c.id === 'forms')!.observations!;
    expect(obs[0]).toBe('1 formularë të ndryshëm (identitet: id/klasat + action + fushat), nga të cilët 1 të përsëritur në shumë faqe');
    expect(obs[1]).toMatch(/^1 formular i përsëritur në 4 faqe \(i njëjti komponent\): rezervim #gjbForm — 3 fusha/);
  });

  it('add-to-cart me action = vetë faqja → i njëjti komponent në faqe produktesh të ndryshme', () => {
    const cart = (i: number) => parsePage(`<html><body><form class="cart" action="${B}/product/p${i}/" method="post"><label>Sasia <input type="number" name="quantity"></label><button name="add-to-cart" value="${i}">Add to cart</button></form></body></html>`, `${B}/product/p${i}/`);
    expect(cart(1).business.forms[0]!.identity).toBe(cart(2).business.forms[0]!.identity);
  });

  it('false positive: fusha të njëjta por komponentë të ndryshëm (id/action tjetër) s\'bashkohen', () => {
    const a = parsePage(`<form id="contact-a" action="/send-a"><input type="email" name="email"></form>`, `${B}/`).business.forms[0]!;
    const b = parsePage(`<form id="contact-b" action="/send-b"><input type="email" name="email"></form>`, `${B}/`).business.forms[0]!;
    expect(a.signature).toBe(b.signature); // e njëjta strukturë
    expect(a.identity).not.toBe(b.identity); // komponentë të ndryshëm
  });

  it('JSON: inventari i formularëve me pageCount/repeated; terminali "i përsëritur në N faqe"', () => {
    const ctx = siteCtx([{ url: `${B}/`, html: withFooter(bookingForm) }, { url: `${B}/a/`, html: withFooter(bookingForm) }]);
    const report = buildReport(makeRun(ctx));
    const forms = (report.business as { forms: { purpose: string; pageCount: number; repeated: boolean; id?: string }[] }).forms;
    expect(forms).toEqual([expect.objectContaining({ purpose: 'booking', id: 'gjbForm', pageCount: 2, repeated: true })]);
    expect(renderTerminal(report)).toContain('Formularë: 1 komponentë (1 booking #gjbForm i përsëritur në 2 faqe)');
  });
});

describe('Rishikimi i MVP-3: kuptimi i Conversion 100', () => {
  it('pranë score-it në terminal dhe JSON: vetëm HTML statik, jo provë se rrjedha funksionon', () => {
    const ctx = siteCtx([{ url: `${B}/`, html: withFooter(bookingForm) }, { url: `${B}/contact/`, html: withFooter('') }]);
    const report = buildReport(makeRun(ctx));
    const b = report.business as { categories: { conversion: number | null }; categoryCoverage: Record<string, { scope: string }>; scoreScope: { conversion: { scope: string; notTested: string[] } } };
    expect(b.categories.conversion).toBe(100);
    expect(b.categoryCoverage.conversion!.scope).toMatch(/^Pikët vlejnë vetëm për sinjalet e kontrolluara në HTML statik .* jo provë se rrjedha e konvertimit funksionon\.$/);
    expect(b.scoreScope.conversion.notTested).toEqual(expect.arrayContaining([
      'rezervimi / blerja nga fillimi në fund',
      'dërgimi i formularëve (SAFE mode: asnjë submit), validimi dhe mesazhet e gabimit',
      'pozicioni real i CTA-ve në viewport (above the fold)',
      'përmbajtja e iframe-ve ndër-domain',
    ]));
    const text = renderTerminal(report);
    const i = text.indexOf('Conversion (CTA/kontakt/forma)');
    expect(text.slice(i, i + 400)).toMatch(/100[\s\S]*↳ vetëm sinjale në HTML statik — jo provë se rrjedha e konvertimit funksionon[\s\S]*s'u testuan: rezervimi/);
    expect(runConversion(ctx).limitations[0]).toMatch(/^Conversion: Pikët vlejnë vetëm .* S'u testuan: /);
  });
});

describe('Rishikimi i MVP-3: newsletter pa shpjegim për bazë kontraktore', () => {
  it('newsletter: vetëm sinjali teknik + verifikim manual; rezervimi ruan shënimin e vet', () => {
    const r = runPrivacy(siteCtx([{ url: `${B}/`, html: withFooter(`${bookingForm}${newsletter}`) }]));
    const obs = r.checks.find((c) => c.id === 'forms-personal-data')!.observations!;
    const nl = obs.find((o) => o.startsWith('Formë newsletter'))!;
    expect(nl).toMatch(/checkbox pëlqimi në HTML statik: nuk u gjet; mënyra e abonimit\/pëlqimit .* kërkon verifikim manual$/);
    expect(nl).not.toMatch(/kontrat|baza ligjore|bazë ligjore|në përputhje/i);
    expect(obs.find((o) => o.startsWith('Formë rezervim'))).toMatch(/baza ligjore mund të jetë kontrata\/kërkesa/);
  });
});

describe('Rishikimi i MVP-3: g/collect me confidence dhe verifikim manual', () => {
  const lh = (): LighthouseData => {
    const base = lighthouseFixture();
    return {
      ...base,
      entities: [{ name: 'e.com', isFirstParty: true, origins: [B] }, { name: 'Google Analytics', category: 'analytics', origins: ['https://www.google-analytics.com'] }],
      audits: { ...base.audits, 'network-requests': { id: 'network-requests', title: 'n', score: null, scoreDisplayMode: 'informative', details: { type: 'table', items: [{ url: 'https://www.google-analytics.com/g/collect?cid=1.2', entity: 'Google Analytics', resourceType: 'Fetch', statusCode: 204, networkRequestTime: 1700 }] } } },
    };
  };

  it('fakti i vëzhguar në mesazh; mungesa e CMP-së vetëm si provë me kujdes; confidence 0.6, pa verdikt', () => {
    const ctx: AuditContext = { ...siteCtx([{ url: `${B}/`, html: withFooter('') }]), lighthouse: { status: 'ok', value: lh() } };
    const i = runPrivacy(ctx).issues.find((x) => x.code === 'TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL')!;
    expect(i).toMatchObject({ confidence: 0.6, needsManualReview: true, severity: 'medium' });
    expect(i.message).toBe('U vëzhgua kërkesë te Google Analytics (/g/collect) gjatë ngarkimit, pa asnjë ndërveprim — kërkon verifikim manual');
    expect(i.evidence[0]).toMatchObject({ type: 'network', url: 'https://www.google-analytics.com/g/collect' });
    expect(i.evidence[1]!.detected).toMatch(/kjo s'provon që mekanizmi mungon$/);
    expect(JSON.stringify(i)).not.toMatch(/shkel|në përputhje|non-compliant|violat/i);
  });

  it('negativ: pa kërkesë rrjeti, vetëm mungesa e CMP-së në HTML statik s\'krijon issue', () => {
    const noNet = lh();
    noNet.audits['network-requests'] = { ...noNet.audits['network-requests']!, details: { type: 'table', items: [] } };
    const ctx: AuditContext = { ...siteCtx([{ url: `${B}/`, html: withFooter('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>') }]), lighthouse: { status: 'ok', value: noNet } };
    expect(runPrivacy(ctx).issues.filter((x) => x.code.startsWith('TRACKING'))).toEqual([]);
  });
});

it('inventari JSON s\'përmban shtegun e plotë/token-in e action-it të ofruesit të newsletter-it', () => {
  const ctx = siteCtx([{ url: `${B}/`, html: withFooter(newsletter) }]);
  const forms = (buildReport(makeRun(ctx)).business as { forms: { purpose: string; submission: string }[] }).forms;
  expect(forms.find((f) => f.purpose === 'newsletter')!.submission).toBe('x.sibforms.com/serve/TOKEN');
});
