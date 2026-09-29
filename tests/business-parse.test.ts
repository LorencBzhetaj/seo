import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/parse/page.js';

const B = 'https://e.com';
const biz = (body: string, head = '', url = `${B}/`) => parsePage(`<!doctype html><html lang="sq"><head><title>T</title>${head}</head><body>${body}</body></html>`, url).business;
const words = (n: number) => Array.from({ length: n }, (_, i) => `fjala${i}`).join(' ');

describe('Sinjale biznesi: CTA', () => {
  it('njeh llojin nga teksti (shumë gjuhë), rajonin dhe pamjen si buton', () => {
    const b = biz(`<header><nav><a href="/contact">Kontakt</a></nav></header>
      <main><a class="et_pb_button" href="/book">Rezervo tani</a><button type="button">Book a table</button><a href="tel:+355671234567">Na telefononi</a></main>
      <footer><a href="/gift">Gift Cards</a></footer>`);
    const by = (t: string) => b.ctas.find((c) => c.text === t)!;
    expect(by('Kontakt')).toMatchObject({ kind: 'contact', region: 'header', styled: false });
    expect(by('Rezervo tani')).toMatchObject({ kind: 'book', region: 'main', styled: true, href: `${B}/book` });
    expect(by('Book a table')).toMatchObject({ kind: 'book', element: 'button', styled: true });
    expect(by('Na telefononi').kind).toBe('call');
    expect(by('Gift Cards')).toMatchObject({ kind: 'buy', region: 'footer' });
  });

  it('false positive: linke të zakonshëm pa tekst CTA s\'numërohen; butoni submit i formës i takon formës', () => {
    const b = biz('<main><a href="/blog/post">Lexo artikullin për fshatin</a><form><input name="q" type="search"><button>Kërko</button></form></main>');
    expect(b.ctas).toEqual([]);
  });
});

describe('Sinjale biznesi: kontakti', () => {
  it('tel/mailto/WhatsApp/email i Cloudflare; numër ndërkombëtar si tekst → unlinked', () => {
    const b = biz(`<a href="tel:+355 69 000 1111">Thirr</a><a href="mailto:info@e.com?subject=x">Email</a>
      <a href="https://wa.me/355671112222">WhatsApp</a><a href="/cdn-cgi/l/email-protection#95fcfbf3fad5f2fff0f6f4ffbbf4f9">e</a>
      <p>Na shkruani në +39 333 123 4567 çdo ditë.</p>`);
    expect(b.contact.phones).toEqual([{ href: 'tel:+355 69 000 1111', digits: '+355690001111', text: 'Thirr' }]);
    expect(b.contact.emails).toEqual([{ href: 'mailto:info@e.com', obfuscated: false }, { href: '/cdn-cgi/l/email-protection (Cloudflare)', obfuscated: true }]);
    expect(b.contact.whatsapp).toEqual(['https://wa.me/355671112222']);
    expect(b.contact.unlinkedPhones).toEqual([{ text: '+39 333 123 4567', digits: '393331234567' }]);
  });

  it('false positive: data, çmime, numra lokalë dhe numri që është edhe link tel: s\'raportohen', () => {
    const b = biz(`<a href="tel:+355690001111">+355 69 000 1111</a><p>Tel: +355 69 000 1111 · 29-09-2026 · €1 200 000 · 069 000 1111 · Porosia 2026 0929 1234</p>`);
    expect(b.contact.unlinkedPhones).toEqual([]);
  });

  it('adresë nga JSON-LD dhe <address>; orari nga schema; linke hartash', () => {
    const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Restaurant', address: { '@type': 'PostalAddress', streetAddress: 'Rr. 1', addressLocality: 'Theth' }, openingHours: 'Mo-Su 08:00-22:00' }] };
    const b = biz(`<address>Rruga 1, Theth</address><a href="https://maps.app.goo.gl/abc">Harta</a>`, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
    expect(b.jsonLd.types).toEqual(['Restaurant', 'PostalAddress']);
    expect(b.contact.addresses.map((a) => a.source)).toEqual(['schema', 'address-tag']);
    expect(b.contact.openingHours).toEqual([{ source: 'schema', value: 'Mo-Su 08:00-22:00' }]);
    expect(b.contact.mapLinks).toEqual(['https://maps.app.goo.gl/abc']);
  });

  it('JSON-LD i pavlefshëm s\'rrëzon parser-in', () => {
    const b = biz('', '<script type="application/ld+json">{ "@type": "Hotel", </script>');
    expect(b.jsonLd).toMatchObject({ types: [], parseErrors: 1 });
  });
});

describe('Sinjale biznesi: formularët (vetëm struktura, pa submit)', () => {
  it('rezervim me honeypot: fusha kurth s\'numërohet; dërgim me JS; etiketat', () => {
    const b = biz(`<form id="book" novalidate>
      <label>Emri <input name="name" required></label>
      <label for="em">Email</label><input id="em" type="email" name="email" required>
      <input type="tel" name="phone" placeholder="Telefon">
      <input type="date" name="checkin" aria-label="Check-in">
      <input type="text" name="website" tabindex="-1" aria-hidden="true" class="gjb-hp">
      <button type="submit">Dërgo kërkesën</button></form>`);
    const f = b.forms[0]!;
    expect(f).toMatchObject({ purpose: 'booking', jsHandled: true, novalidate: true, hasSubmit: true, submitText: 'Dërgo kërkesën', honeypotFields: 1, collectsPersonalData: true, consentCheckbox: false });
    expect(f.fields.map((x) => `${x.name}:${x.labelled}`)).toEqual(['name:true', 'email:true', 'phone:false', 'checkin:true']);
  });

  it('qëllimi: kërkim, login, kontakt, newsletter (Brevo), me checkbox pëlqimi; forma e fshehur', () => {
    const b = biz(`
      <form role="search" action="/"><input type="search" name="s"></form>
      <form action="/wp-login.php" method="post"><input name="log"><input type="password" name="pwd"></form>
      <form action="/send" method="post"><input type="email" name="email"><textarea name="message"></textarea>
        <label><input type="checkbox" name="gdpr"> Pajtohem me politikën e privatësisë</label><input type="submit" value="Dërgo"></form>
      <form action="https://x.sibforms.com/serve/TOKEN"><input type="email" name="EMAIL"><button>Subscribe</button></form>
      <form class="rtb-modification-form rtb-hidden"><input type="email" name="rtb_modification_email"></form>`);
    expect(b.forms.map((f) => f.purpose)).toEqual(['search', 'login', 'contact', 'newsletter', 'other']);
    expect(b.forms[2]).toMatchObject({ consentCheckbox: true, jsHandled: false, action: `${B}/send`, method: 'post' });
    expect(b.forms[4]!.initiallyHidden).toBe(true);
    // E njëjta strukturë → e njëjta nënshkrim (për bashkim mes faqeve)
    expect(biz('<form><input type="email" name="email"><textarea name="message"></textarea></form>').forms[0]!.signature)
      .toBe(biz('<form action="/x"><textarea name="message"></textarea><input type="email" name="email"></form>').forms[0]!.signature);
  });
});

describe('Sinjale biznesi: iframe', () => {
  it('ndër-domain vs i njëjti host; lloji nga src/title; data-src (lazy)', () => {
    const b = biz(`<iframe src="https://menu.villa.com/?embed=1" title="Menu"></iframe><iframe data-src="https://www.google.com/maps/embed?pb=1"></iframe>
      <iframe src="/embed/local"></iframe><iframe src="https://www.youtube-nocookie.com/embed/x"></iframe>`);
    expect(b.iframes.map((f) => `${f.kind}:${f.crossOrigin}`)).toEqual(['menu:true', 'map:true', 'other:false', 'video:true']);
  });
});

describe('Sinjale privatësie (HTML statik)', () => {
  it('tracker-a me ID, Consent Mode, CMP e njohur, linke politikash', () => {
    const b = biz(
      `<footer><a href="/privacy/">Privacy Policy</a><a href="/sq/politika-e-cookies/">Politika e Cookies</a><a href="/terms/">Terms</a></footer>`,
      `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCD1234"></script>
       <script>gtag('consent', 'default', { ad_storage: 'denied' }); gtag('config', 'G-ABCD1234');</script>
       <script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="x"></script>
       <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123');</script>`,
    );
    expect(b.privacy.trackers.map((t) => `${t.name}:${t.id ?? ''}`)).toEqual(['Google Analytics 4:G-ABCD1234', 'Meta Pixel:']);
    expect(b.privacy.consentModeDefault).toBe(true);
    expect(b.privacy.cmp).toEqual([expect.objectContaining({ name: 'Cookiebot', generic: false })]);
    expect(b.privacy.policyLinks.map((l) => l.kind)).toEqual(['privacy', 'cookies', 'terms']);
  });

  it('false positive: fjala "cookie" në tekst ose linku i politikës s\'është CMP; Plausible deklarohet pa cookies', () => {
    const b = biz('<p>Ne përdorim cookie për statistika.</p><a href="/cookies/">Cookies Policy</a>', '<script defer data-domain="e.com" src="https://plausible.io/js/script.js"></script>');
    expect(b.privacy.cmp).toEqual([]);
    expect(b.privacy.trackers).toEqual([expect.objectContaining({ name: 'Plausible', cookieless: true })]);
  });

  it('markup i përgjithshëm banner-i → CMP "generic" (confidence më e ulët)', () => {
    const b = biz('<div id="cookie-banner"><p>Ky sit përdor cookies</p><button>OK</button></div>');
    expect(b.privacy.cmp).toEqual([expect.objectContaining({ generic: true })]);
  });

  it('fontet: vetëm stylesheet-et (jo preconnect) numërohen si fonte të largëta', () => {
    const b = biz('', '<link rel="preconnect" href="https://fonts.gstatic.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">');
    expect(b.privacy.remoteFonts).toEqual(['https://fonts.googleapis.com/css2?family=Inter']);
  });
});

describe('HTML e renderuar me JavaScript', () => {
  it('shell SPA (pak tekst + app root) → jsRendered.likely; faqe normale → jo', () => {
    const spa = biz('<div id="root"></div><script src="/a.js"></script><script src="/b.js"></script>');
    expect(spa.jsRendered.likely).toBe(true);
    expect(spa.jsRendered.reason).toMatch(/app root/);
    expect(biz(`<main><p>${words(120)}</p></main>`).jsRendered.likely).toBe(false);
  });
});

describe('Regresione nga auditi real i gjecaj.al (MVP-3)', () => {
  it('forma e renditjes së WooCommerce (GET + select) = "filter", jo formë konvertimi; "resort" s\'bie në rregullin "sort"', () => {
    const b = biz(`<form class="woocommerce-ordering" method="get"><select name="orderby" aria-label="Shop order"><option>menu_order</option></select></form>
      <form class="resort-booking" method="get"><input type="date" name="checkin" aria-label="in"><input type="email" name="email" aria-label="e"><button>Book</button></form>`);
    expect(b.forms.map((f) => f.purpose)).toEqual(['filter', 'booking']);
  });

  it('href="#book" në faqen e privatësisë s\'është link te politika; hash-i hiqet', () => {
    const b = biz('<a href="#book">Book a Table</a><a href="/privacy/#data">Privacy</a><a href="/privacy/">Privacy Policy</a>', '', `${B}/privacy/`);
    expect(b.privacy.policyLinks).toEqual([{ kind: 'privacy', href: `${B}/privacy/`, text: 'Privacy' }]);
  });
});

it('butoni dygjuhësh (<span> për gjuhë) lexohet me hapësirë: "Send request Dërgo kërkesën"', () => {
  const b = biz('<form><input type="email" name="email" aria-label="e"><button type="submit"><span class="en">Send request</span><span class="sq">Dërgo kërkesën</span></button></form>');
  expect(b.forms[0]!.submitText).toBe('Send request Dërgo kërkesën');
});
