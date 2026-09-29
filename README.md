# Website Auditor — MVP-1 + MVP-2 + MVP-3

CLI lokal (Node.js + TypeScript) që auditon **faqen hyrëse** (MVP-1), me një crawl të kufizuar **faqet e tjera** të një siti (MVP-2), dhe **sinjalet e biznesit e të privatësisë** me zbulim të llojit të sitit e CMS-it (MVP-3). Jep: çfarë nuk shkon → provën konkrete → sa rëndësi ka → si rregullohet. Arkitektura e plotë: [docs/website-checker-architecture.md](docs/website-checker-architecture.md). Ky repo implementon MVP-1, MVP-2 dhe MVP-3 (§11). Mbetet CLI për përdorim personal: pa SaaS, llogari përdoruesish apo instalues.

## Kërkesat

- Node.js ≥ 22.19 (testuar me 24.11)
- Google Chrome ose Chromium i instaluar (për Lighthouse). Pa Chrome, auditi vazhdon, por Performance/Accessibility/Best Practices dalin `skipped` dhe Health Score `PARTIAL`.

## Instalimi

```bash
npm install
```

Opsionale: kopjo `config.example.json` si `config.json` për të ndryshuar kufijtë (timeout, madhësia, vonesa mes kërkesave). MVP-1 s'kërkon asnjë API key; nëse më vonë shtohen sekrete, ato mbahen në `.env` (i përjashtuar nga Git, shih `.env.example`).

## Përdorimi

```bash
npm run audit -- https://siti-yt.com
```

Ose pas build-it:

```bash
npm run build
node dist/cli.js https://siti-yt.com
```

Opsione:

| Opsion | Kuptimi |
|---|---|
| `--out <dir>` | Dosja e raporteve (parazgjedhje `output/`) |
| `--config <file>` | Config JSON (parazgjedhje `./config.json` nëse ekziston) |
| `--no-lighthouse` | Pa Lighthouse (më shpejt; raporti del `partial`) |
| `--chrome-path <path>` | Rruga e Chrome nëse s'gjendet automatikisht |
| `--save-lhr` | Ruaj edhe LHR-në e plotë të Lighthouse pranë raportit (joaktiv si parazgjedhje; shih më poshtë) |
| `--ignore-robots` | Anashkalo robots.txt për tool-in — **vetëm për site që i kontrollon vetë** |
| `--allow-local <host:port>` | **Vetëm për fixtures/teste**: lejo një host lokal |
| `--no-business` | Pa modulet e MVP-3 (conversion, privacy, detektimi i llojit/CMS-it) |
| `--json` | Shtyp JSON-in në stdout në vend të përmbledhjes |

Kodet e daljes: `0` ok (edhe `partial`), `1` gabim i brendshëm, `2` URL/dosje e pavlefshme ose e bllokuar, `3` bllokuar nga robots.txt, `4` repo e paarritshme (private/s'ekziston), e paplotë ose tepër e madhe.

Raporti ruhet si `output/{host}-{YYYYMMDD-HHmmss}.json` (dosja `output/` është në `.gitignore`).

### LHR i plotë (`--save-lhr`)

Me `--save-lhr`, rezultati i plotë i Lighthouse (LHR) ruhet pranë raportit me të njëjtin emër bazë:

```
output/gjecaj.al-20260928-180745.json      ← raporti
output/gjecaj.al-20260928-180745.lhr.json  ← LHR i të njëjtit audit
```

Raporti e emërton skedarin te `lighthouse.lhrFile`. LHR-ja shërben për të verifikuar evidence-n, p.sh. LCP e simuluar kundrejt asaj të vëzhguar. Mund ta hapësh në [Lighthouse Viewer](https://googlechrome.github.io/lighthouse/viewer/), por vetëm pasi ta kesh kontrolluar. Nëse Lighthouse s'jep rezultat (bllokim, `--no-lighthouse`), LHR nuk ruhet dhe CLI e thotë pse.

> ⚠️ **LHR-ja mund të përmbajë të dhëna të faqes që s'duhen shpërndarë pa kontroll:** URL të plota (edhe me query), listën e kërkesave të rrjetit dhe palët e treta, fragmente HTML dhe tekst të elementeve, si dhe screenshot-e të faqes në base64. Mbetet vetëm lokalisht te `output/`, që është jashtë Git. Mos e ngarko dhe mos e ndaj pa e shqyrtuar.

### Lighthouse NO_NAVSTART (shkak ende i papërcaktuar)

Herë pas here Lighthouse dështon me `NO_NAVSTART`: trace-i i Chrome s'ka eventin `navigationStart` të frame-it kryesor, ndonëse faqja ngarkohet normalisht (HTTP 200, të njëjtat kërkesa). Ndodh edhe me `--no-crawl`, pra s'e shkakton crawl-i. Pse Chrome e humb eventin **s'është përcaktuar ende** (as roli i mundshëm i guard proxy-t). Vetëm për `NO_NAVSTART` / `NO_TRACING_STARTED` bëhet **një** riprovim; çdo përpjekje e dështuar ruhet te `lighthouse.failedAttempts` dhe shfaqet në terminal. Nëse dështojnë të dyja, Health Score del `PARTIAL` dhe `lighthouse.code` e emërton gabimin.

## Çfarë kontrollon MVP-1

| Kategoria | Kontrollet | Burimi |
|---|---|---|
| Availability | status HTTP, TTFB (1 matje lokale), zinxhiri i ridrejtimeve | fetch |
| SEO (Technical) | `<title>`, meta description, H1, canonical, noindex (meta + `X-Robots-Tag`), robots.txt | HTML statik |
| Security | HTTPS, ridrejtimi http→https, certifikata TLS (lokalisht), mixed content, HSTS, CSP, framing, `X-Content-Type-Options`, Referrer-Policy, zbulim versioni | header + TLS + HTML |
| Performance | Lighthouse **mobile** (lab): LCP, CLS, TBT, FCP, SI + diagnoza me URL konkrete | Lighthouse 13 |
| Accessibility | auditet automatike të Lighthouse/axe me elementet që dështojnë | Lighthouse |
| Best Practices | auditet e Lighthouse | Lighthouse |

### Parimet e zbatuara

- **Çdo issue** ka `evidence[]` (çfarë u gjet, ku, çfarë pritej), `url`, `severity`, `impact`, `effort`, `fix`, `priority` dhe `confidence`.
- **Skipped/partial, jo 0 ose 100**: një kontroll që s'mund të kryhet merr `status: "skipped"` + `reason` dhe del nga pikëzimi. Një kategori pa asnjë matje të vlefshme merr `null`. Nëse mungon një kategori kyçe (Availability, SEO, Security, Performance), Health Score **nuk gjenerohet** (`PARTIAL`).
- **Critical cap**: vetëm një issue `critical` me `confidence ≥ 0.9` e kufizon Health Score në 50; kufizimi shfaqet te `health.modifiers` me arsyen.
- **Pa alarme pa kontekst**: mungesa e canonical është vetëm informacion (pa prova URL-sh të dyfishta); robots.txt që mungon s'është problem (RFC 9309); header-at e sigurisë janë `low`/`medium` sipas kontekstit (p.sh. CSP `medium` vetëm kur faqja ka fushë fjalëkalimi); `Referrer-Policy` që mungon është vetëm info. `llms.txt` nuk kontrollohet në MVP-1.
- **Faqja hyrëse jo-2xx**: kur merret 401/403/429 ose challenge (p.sh. Cloudflare), raporti e shfaq qartë si *bllokim për këtë klient* (`access` në JSON, paralajmërim në terminal). Issue `HOMEPAGE_ACCESS_DENIED` del `high` me `confidence 0.4` dhe verifikim manual, jo `critical`. HTML-ja dhe header-at e përgjigjes së bllokimit nuk analizohen, prandaj SEO, Security dhe Availability dalin `null`, jo 100 "partial". 404/5xx mbeten `HOMEPAGE_HTTP_ERROR` critical. Tool-i nuk provon asnjë mënyrë për ta anashkaluar mbrojtjen.
- **INP** nuk raportohet pa të dhëna reale: metrika del `unavailable` me arsye.
- Pikëzimi është i versionuar (`scoringVersion`, `ruleSetVersion`) dhe raporti ruan versionin e Lighthouse, konfigurimin, mbulimin dhe kufizimet.

### Siguria e rrjetit

- Pranohen vetëm URL `http(s)` pa kredenciale. Bllokohen `localhost`, IP private/loopback/link-local/CGNAT/multicast (IPv4 + IPv6, edhe IPv4-mapped), edhe kur arrihen përmes **ridrejtimit** ose DNS-i (kontrolli bëhet në momentin e lidhjes, kundër DNS rebinding).
- Chrome i Lighthouse kalon përmes një **guard proxy** lokal që zbaton të njëjtat rregulla për navigimet, ridrejtimet dhe nënburimet; kërkesat e bllokuara shënohen te raporti.
- Timeout 10 s, kufi 5 MB për përgjigje, maks. 5 ridrejtime, vonesë 500 ms mes kërkesave drejt të njëjtit host, respektim i robots.txt për user-agent-in e tool-it.
- Cookie/Authorization nuk ruhen në raport (`[redacted]`).

## Testet

```bash
npm test                 # parsing, scoring, skipped/partial, rrjeti, CLI mbi server lokal
npm run test:lighthouse  # + CLI me Chrome/Lighthouse real mbi fixture lokale (~40 s)
npm run typecheck
```

## Arkitektura: motori i auditimit i ndarë nga CLI

CLI-ja është vetëm një shtresë e hollë. Një ndërfaqe desktop e ardhshme mund të thërrasë të njëjtin motor pa e prekur logjikën e auditimit.

| Shtresa | Skedarët | Varet nga CLI? |
|---|---|---|
| Motori (API programatike) | `executeAudit(url, config, hooks)` te `src/core/run.ts` → kthen `AuditRun` | Jo |
| Mbledhja e të dhënave | `src/core/context.ts`, `src/net/*`, `src/parse/*` | Jo |
| Lighthouse | `runLighthouse` te `src/lighthouse/run-lighthouse.ts` (injektohet si hook `runLighthouse`) | Jo |
| Modulet / scoring | `src/modules/*`, `src/intelligence/*`, `src/scoring/*` (funksione të pastra mbi `AuditContext`) | Jo |
| Raporti | `buildReport` / `writeReport` te `src/report/json.ts`. `renderTerminal` shërben vetëm për CLI-në | Jo |
| CLI | `src/cli.ts`: argumentet, progresi në stderr, kodet e daljes | — |

Një UI desktop do të thërriste `executeAudit(...)`. Hook-et `onStatus`/`onStep` do t'i përdorte për progresin, dhe `buildReport(run)` për të dhënat që shfaq. Dy pika duhen përshtatur kur të ndërtohet UI-ja:

- `loadConfig()` e kërkon `config.json` në dosjen aktuale (`cwd`).
- `output/` zgjidhet relativisht ndaj `cwd`.

Në një aplikacion të instaluar, këto duhet të kalojnë te dosja e të dhënave të përdoruesit, p.sh. `%APPDATA%\WebsiteAuditor\`. Po ashtu, `package.json` lexohet relativisht ndaj kodit për versionin e tool-it.

### Çfarë duhet paketuar ose instaluar veçmas për një instalues Windows (ende s'është ndërtuar)

| Komponenti | Pse duhet | Opsionet |
|---|---|---|
| **Node.js runtime** (≥ 22.19) | Motori ekzekutohet në Node | Të përfshihet në aplikacion (p.sh. Electron/Tauri sidecar ose Node SEA) që përdoruesi të mos e instalojë vetë |
| **Chrome / Chromium** | Lighthouse ka nevojë për një browser Chromium. Pa të, Performance/Accessibility/Best Practices dalin `skipped` | a) të përdoret Chrome ose Edge i instaluar (gjendet automatikisht, ose me `lighthouse.chromePath`), b) të shkarkohet Chrome for Testing gjatë instalimit, c) të përfshihet Chromium (~150+ MB, kërkon përditësime sigurie) |
| `lighthouse` + `chrome-launcher` (npm) | Matjet lab dhe nisja e Chrome | Futen në bundle me `node_modules` e prodhimit. Lighthouse ka asete (locale, axe-core) që s'duhen hequr gjatë bundling-ut |
| `cheerio` (npm) | Parsing i HTML | JS i pastër, pa kod nativ |
| Dosje e shkrueshme për raportet, config dhe profilin e përkohshëm të Chrome | Raportet JSON, `config.json`, `%TEMP%\website-auditor-chrome-*` | Dosja e të dhënave të përdoruesit, jo `Program Files` |
| Rrjeti / firewall | Guard proxy dëgjon vetëm në `127.0.0.1` në një port të rastësishëm, që Chrome të kalojë nëpër të | Mund të shfaqet dialog i Windows Firewall. Duhet dokumentuar në instalues |

Varësitë vetëm për zhvillim (`typescript`, `tsx`, `vitest`, `cross-env`, `@types/node`) nuk hyjnë në instalues.

## MVP-2: crawl i kufizuar dhe gjetje për shumë faqe

Pas faqes hyrëse, auditi lexon sitemap-in dhe bën një crawl të kufizuar. Gjetjet dalin në seksionin **`site`** të raportit (dhe në terminal te "SITE — CRAWL I KUFIZUAR"), **të ndara** nga faqja hyrëse. Health Score mbetet ai i faqes hyrëse (MVP-1, `scoringVersion 1.0`). Për site-in s'ka score të përbashkët, sepse peshat e moduleve s'janë validuar ende.

**Kufijtë parazgjedhje (§7, §13):** 25 faqe, thellësi 3, concurrency 2, ≥ 500 ms mes kërkesave drejt të njëjtit host (s'ulet për site të jashtme), timeout 10 s, 5 MB për përgjigje, 180 s për gjithë crawl-in. Crawl-i ndalet pas 3 përgjigjesh 401/403/429 radhazi.

| Opsion | Kuptimi |
|---|---|
| `--no-crawl` | Vetëm faqja hyrëse (sjellja e MVP-1) |
| `--max-pages <n>` | 1–100 (parazgjedhje 25) |
| `--max-depth <n>` | 0–10 (parazgjedhje 3) |

**Çfarë s'vizitohet kurrë.** Këto rregulla zbatohen edhe për ridrejtimet, jo vetëm për linket:
- URL të ndaluara nga robots.txt (përveç me `--ignore-robots`);
- login/logout/register, `wp-admin`, `wp-login.php`, cart/checkout/my-account;
- parametra që ndryshojnë gjendje (`add-to-cart`, `action`, `_wpnonce`…) dhe kërkimet (`?s=`);
- skedarët (PDF, imazhe, CSS/JS);
- host-e të tjera dhe adresat lokale/private (validimi i MVP-1 zbatohet për çdo URL dhe çdo hop).

Çdo URL e zbuluar por e pakontrolluar listohet te `site.crawl.notChecked`, me arsyen e saj.

| Moduli | Çfarë kontrollon | Kujdesi ndaj false positive |
|---|---|---|
| Linke të brendshme | 404/410/5xx me faqet burim dhe tekstin e linkut; linke që kalojnë nga ridrejtime | 401/403/429 dhe gabimet e rrjetit dalin "të paverifikuara", jo "të prishura"; linket e menu/footer bashkohen |
| Sitemap | Robots.txt ose vendndodhjet standarde, index → fëmijë, XML i vlefshëm, `lastmod` W3C; URL të sitemap-it që kthejnë gabim, ridrejtojnë, kanë noindex/canonical tjetër ose ndalohen nga robots; faqe që mungojnë në sitemap | URL-të e sitemap-it pa link quhen "orphan" vetëm kur crawl-i i linkeve ishte i plotë; mungesa e sitemap-it s'është problem |
| Dyfishime & canonical | Tituj/përshkrime të njëjta; përmbajtje e ngjashme me shingle 5-fjalëshe, pasi hiqet teksti i përbashkët i template-it | Hash-i i tekstit është vetëm një sinjal: "i provuar" kërkon hash të njëjtë + Jaccard ≥ 0.98 + URL variante ose titull të njëjtë. Canonical vlerësohet vetëm mbi dyfishime të provuara; mungesa e tij përndryshe është vetëm vërejtje |
| SEO on-page | Faqet e tjera (jo ajo hyrëse): title, description, H1, hierarkia H1–H6, imazhe pa `alt`, `lang`, përmbajtje e shkurtër | Problemet e njëjta bashkohen sipas template-it (klasat e `<body>`); `alt=""` pranohet; "thin content" ka confidence 0.5 dhe tregon iframe-t |
| Compression/caching | Compression i HTML (≥ 1.4 KB) | `Cache-Control` për HTML raportohet vetëm si informacion |
| i18n | hreflang: kode, lidhje kthyese, self-reference, target-e, përputhja me `<html lang>` | `not_applicable` për site njëgjuhësh |

Një modul që s'kontrolloi dot faqe (crawl i çaktivizuar/i bllokuar, vetëm faqja hyrëse, pa sitemap) del me score `null` dhe me arsye, jo 100. Kur crawl-i arrin kufijtë, modulet shënohen `partial`, dhe mbulimi shfaqet si "të kontrolluara / të zbuluara".

Për ta provuar mbi një site lokal të kontrolluar:

```bash
npx tsx tests/fixture-site.ts
```

Komanda printon URL-në dhe komandën e auditit me `--allow-local`.

## MVP-3: conversion, sinjale privatësie, lloji i sitit dhe CMS-i

Seksioni **`business`** i raportit (në terminal "BIZNES & PRIVATËSI") është **jashtë Health Score-it**. Pikëzimi i MVP-1/MVP-2 s'ndryshon (`scoringVersion 1.0`; `ruleSetVersion 2026.09-mvp3`; `reportSchemaVersion 3`), dhe testet e verifikojnë këtë. MVP-3 **s'bën asnjë kërkesë shtesë**: lexon HTML-në e faqeve që u morën tashmë (faqja hyrëse + crawl) dhe log-un e rrjetit të Lighthouse. Me `--no-business` modulet çaktivizohen.

| Pjesa | Çfarë jep | Kujdesi ndaj false positive |
|---|---|---|
| **Lloji i sitit** (`business.detection.site`) | `lodging` / `restaurant` / `ecommerce` / `blog` / `local-business` / **`unknown`**, me `confidence`, `signals[]` (burimi + pesha), alternativa, `capabilities` (booking, menu, contact, blog, shop, newsletter, multilingual), gjuhët | `confidence = 1 − Π(1 − w)` e sinjaleve të pavarura (heuristikë, jo probabilitet i kalibruar). Nën 0.5 → `unknown`. Kur lloji i dytë është brenda 0.05, raportohet `mixedWith` (siti i përzier, p.sh. guesthouse + restorant). Formularët që dalin në ≥ 60% të faqeve (modal global) s'e karakterizojnë një faqe |
| **Lloji i faqeve** (`business.detection.pages`) | home, contact, about, menu, booking, rooms, product, shop, blog-post, blog-index, legal, faq, gallery, **unknown** | `og:type article` ka peshë të ulët (plugin-et SEO e vendosin edhe në faqe të zakonshme) |
| **CMS/Tech stack** (`business.detection.techStack`) | CMS + version (nga `generator`), page builder, e-commerce, framework JS, CDN, plugin-e të dukshme | Kërkon vetëm në atribute, `<script>` dhe komente, jo në tekstin e dukshëm: një artikull që përmend `/wp-content/` s'e bën sitin WordPress. Pa prova → `unknown` |
| **Conversion** (score) | CTA në faqen hyrëse (lloji, rajoni, a duket si buton); telefon/email/WhatsApp i klikueshëm, numra si tekst pa `tel:`; adresë/hartë/orar **vetëm kur lloji i sitit e kërkon** (issue-t trashëgojnë confidence-in e detektimit); formularët; dëshmi besimi (rating, review, testimonial, platforma, profile sociale) | Mungesat kanë confidence ≤ 0.6 dhe kërkojnë verifikim. Kur HTML-ja duket e renderuar me JS (pak tekst + app root), kontrolli i CTA-së del `skipped`, jo "mungon". Fushat honeypot dhe format e renditjes/filtrimit (GET me select) përjashtohen. Pozicioni "above the fold" **s'matet** |
| **Privacy** (**pa score** me qëllim, status `info`) | Linke te politikat; CMP të njohura (Cookiebot, OneTrust, CookieYes, Complianz…) ose markup banner-i; Google Consent Mode; tracker-a në HTML; **kërkesat te palë të treta gjurmuese gjatë ngarkimit pa ndërveprim** (Lighthouse: profil i ri, asnjë klik); emrat e cookies të palëve të treta; forma me të dhëna personale | Vetëm sinjale të vëzhgueshme me prova. **S'jep përfundim "në përputhje / jo në përputhje me GDPR"**. Query-t e kërkesave (ID klienti) s'ruhen. Vlerat e cookies s'lexohen |

**Çfarë do të thotë Conversion 100:** vetëm që sinjalet e kontrolluara në HTML statik janë në rregull. **Nuk** është provë se rrjedha e konvertimit funksionon: rezervimi/blerja, dërgimi i formularëve, pozicioni real i CTA-ve në viewport dhe përmbajtja e iframe-ve s'testohen. Kjo shkruhet pranë score-it në terminal dhe në JSON (`business.categoryCoverage.conversion.scope`, `business.scoreScope.conversion.notTested`).

**Formularët dedublikohen sipas një identiteti të qëndrueshëm:** qëllimi, metoda, `id`, klasat pa numra, action-i (`self` kur dërgon te vetë faqja, `js` pa action) dhe fushat. I njëjti komponent raportohet "1 formular i përsëritur në N faqe". Inventari është te `business.forms` (`pageCount`, `repeated`, `sampleUrls`).

**Privacy:** issue-t tregojnë vetëm faktin e vëzhguar (p.sh. kërkesa `g/collect` gjatë ngarkimit), me confidence ≤ 0.6 dhe verifikim manual. Mungesa e CMP/Consent Mode në HTML statik jepet vetëm si provë shtesë, me shënimin që s'provon mungesën e mekanizmit. Për newsletter jepet vetëm sinjali teknik (checkbox në HTML), dhe mënyra e abonimit/pëlqimit kërkon verifikim manual.

**SAFE mode për formularët (§8):** lexohet vetëm struktura (fushat, etiketat, `type`, `required`, buton, captcha, honeypot, checkbox pëlqimi, action). **Asnjë formë s'plotësohet apo dërgohet**; login/cart/checkout s'vizitohen. Testi e2e e verifikon që serveri s'merr asnjë POST.

**Iframe ndër-domain** (p.sh. menu ose rezervim nga një host tjetër) shënohen qartë: "përmbajtja e iframe-it s'u kontrollua". CTA, forma dhe kontakti brenda tyre s'numërohen.

**Kufizime:** HTML statik, pa JavaScript. Log-u i rrjetit vjen vetëm nga Lighthouse në faqen hyrëse; pa Lighthouse, kontrolli i tracker-ave në ngarkim del `skipped`. Banner-i s'klikohet. Pa crawl (`--no-crawl`), modulet dalin `partial` (vetëm faqja hyrëse).

## Auditi i skedarëve: `--folder` dhe `--repo`

Auditon **skedarët** e një projekti, jo një faqe të publikuar. Raporti është i veçantë (`reportType: "source-audit"`, `reportSchemaVersion: "source-1"`, skedari `output/source-{folder|repo}-{emri}-{koha}.json`), dhe **s'ka Health Score, Lighthouse apo header-a HTTP**, sepse kodi s'ekzekutohet.

```bash
npm run audit -- --folder "C:\Projekte\sit statik"
```

```bash
npm run audit -- --repo https://github.com/octocat/Spoon-Knife
```

**Çdo gjetje ka:** path relativ (me `/`), rresht kur njihet me siguri (nga parser-i HTML ose pozicioni në CSS/robots/sitemap), provë (atributi, madhësia, rregulli) dhe sugjerim. Kur rreshti s'dihet (p.sh. mungon `<h1>`), s'shpiket.

| Kontrolli | Çfarë bën |
|---|---|
| SEO në HTML | title (mungon/gjatësia), meta description, H1 (mungon/disa), `lang`, viewport, `<img>` pa alt |
| Linke dhe asete lokale | `href`/`src`/`srcset`/`poster` → skedari ekziston? `%20` dhe UTF-8 dekodohen; dosje → `index.html`; "x" → `x.html` shënohet si fallback. Raporton: skedar që mungon, **shkronja të mëdha/vogla që ndryshojnë** (punon në Windows, 404 në Linux), shteg jashtë dosjes |
| Asete në CSS | `url()` dhe `@import`, relativ ndaj skedarit CSS |
| Dublikime | tituj/përshkrime të njëjta; përmbajtje identike ose shumë e ngjashme (shingle, pa tekstin e përbashkët) |
| Imazhet | madhësia nga stat (> 300 KB, > 1 MB); imazhe që s'përmenden në HTML/CSS/JS (vetëm vërejtje) |
| Konfigurime | robots.txt (`Disallow: /` për të gjithë), sitemap.xml (XML, URL pa skedar), favicon, 404.html, JSON i pavlefshëm, header-a në `_headers`/`netlify.toml`/`vercel.json`/`.htaccess` (vetëm si konfigurim, s'verifikohen live) |
| Skedarë të ndjeshëm | `.env*`, çelësa, dump SQL, `wp-config.php` me fjalëkalim; modele sekretesh (PEM, AWS, Stripe live, GitHub, Slack, Google API). **Vlerat maskohen gjithmonë** |

**Mbulimi i shpjeguar** (`coverage.accounting`): `filesSeen = readAsText + statOnly + unread`. `statOnly` janë asetet binare (imazhe, fonte…) që kontrollohen vetëm me stat (ekzistenca, madhësia), pa lexim teksti. `unread` janë skedarët e tekstit që s'u lexuan, me arsyen (p.sh. `too-large`, `binary`, `lfs-pointer`). `notListed` janë hyrjet e anashkaluara para listimit (dosje të injoruara, symlink-e, kufij), që s'numërohen te skedarët.

**Lloji i projektit** (`project`): statik, Next.js, Nuxt, Astro, Gatsby, SvelteKit, Vite SPA, Hugo, Jekyll, Eleventy, WordPress, PHP ose `unknown`, me confidence dhe sinjale. Për projektet që e gjenerojnë HTML-në me build/server, kontrollet e HTML-së dalin **`skipped` me arsye** dhe me udhëzim ("ekzekuto build vetë dhe audito `out/`/`_site/`… me `--folder`, ose URL-në publike"). Asetet publike (`public/`, `static/`), robots dhe sekretet kontrollohen gjithsesi. Pa HTML fare → `skipped`, jo "pass".

**Siguria dhe kufijtë:**
- **`--folder`:** symlink-et dhe junction-et **s'ndiqen**; ato që dalin jashtë dosjes raportohen. `node_modules`, `.git`, `.next` etj. anashkalohen. Kufij: 5000 skedarë, 2 MB për skedar teksti, 300 MB gjithsej, thellësi 25 (`config.json` → `source`). Çdo gjë e anashkaluar listohet te `coverage.skipped` me arsyen, dhe raporti del `partial`.
- **`--repo`:** vetëm `https://` publik (pa kredenciale në URL, pa SSH, host jo privat). Klonim i cekët (`--depth 1`, pa tags/submodule/LFS) në një dosje të përkohshme që fshihet pas auditit. **Asgjë s'ekzekutohet:** pa `npm install`, build, skripte, hooks (`core.hooksPath` bosh), symlink-e (`core.symlinks=false`) apo filtra LFS. Kufij: 150 MB dhe 120 s; tejkalimi e ndërpret klonimin dhe kopja e paplotë s'auditohet. Raporti ruan URL-në, commit-in, branch-in dhe datën.
- **Repo private:** credential helper-at çaktivizohen dhe s'ka prompt. Një repo private ose që s'ekziston jep exit `4` me mesazhin që qasja kërkon konfigurim të veçantë, që s'mbështetet ende.

## Jashtë MVP-3 (ende)

Renderimi me JavaScript gjatë crawl-it dhe matja "above the fold" në viewport; klikimi i banner-it të pëlqimit (para/pas pranimit); testimi i validimit të formave në browser (dry-run pa submit); kontrolli i linkeve të jashtme dhe i skedarëve (PDF/imazhe); Health Score i përbashkët për site-in; sitemap-e `.gz`. Edhe fazat e mëvonshme mbeten jashtë: submit real formularësh, exposure probing, AI/vision (MVP-4), HTML/PDF report, dashboard, histori (SQLite), `llms.txt`, instalues Windows.

## Struktura

```
src/
  cli.ts                     # hyrja e CLI
  core/                      # config, schemas (§4), context (§3), run (AuditRun + runner)
  net/                       # url-guard, safe-fetch, tls-info, guard-proxy
  crawler/                   # crawler (BFS, kufij, robots, politikë ridrejtimesh), url-rules, sitemaps
  parse/                     # html (cheerio), page (linke, hreflang, tekst), business (CTA/kontakt/forma/privatësi), robots (RFC 9309), sitemap
  lighthouse/                # ekzekutimi i Lighthouse mobile
  modules/                   # faqja hyrëse: availability, seo-technical, security, lighthouse-modules
  modules/site/              # MVP-2: links, sitemap, duplicates, onpage, caching, i18n
  modules/business/          # MVP-3: conversion, privacy (sinjale, pa score)
  source/                    # audit i skedarëve: walk, project, refs, checks, repo (klon i sigurt), run, report
  detection/                 # MVP-3: page-type, tech-stack (confidence + signals), index (faqet + cache)
  intelligence/              # priority (§4), similarity (shingle/Jaccard)
  scoring/scorer.ts          # category → health → risk modifiers (§1)
  report/                    # json, site (seksioni i crawl-it), business (MVP-3), terminal
tests/                       # vitest + fixtures (HTML, LHR reale), fixture-site.ts (site lokal i kontrolluar)
```
