# Website Auditor — MVP-1 + MVP-2 + MVP-3 + cilësia

CLI lokal (Node.js + TypeScript) që auditon **faqen hyrëse** (MVP-1), me një crawl të kufizuar **faqet e tjera** të një siti (MVP-2), dhe **sinjalet e biznesit e të privatësisë** me zbulim të llojit të sitit e CMS-it (MVP-3). Jep: çfarë nuk shkon → provën konkrete → sa rëndësi ka → si rregullohet. Arkitektura e plotë: [docs/website-checker-architecture.md](docs/website-checker-architecture.md). Ky repo implementon MVP-1, MVP-2 dhe MVP-3 (§11). Mbetet tool për përdorim personal: pa SaaS dhe pa llogari përdoruesish. Për Windows ka një paketë që s'kërkon Node.js (shih [Instalimi në Windows](#instalimi-në-windows-pa-nodejs)).

## Kërkesat

- Node.js ≥ 22.19 (testuar me 24.11)
- Google Chrome, Chromium ose Microsoft Edge i instaluar (për Lighthouse dhe pamjen vizuale). Kërkohet në këtë radhë: `lighthouse.chromePath` / `--chrome-path`, `CHROME_PATH`, Chrome/Chromium i instaluar, Edge. Pa asnjë, auditi vazhdon, por Performance/Accessibility/Best Practices dalin `skipped` me arsye dhe Health Score `PARTIAL`. Auditi i dosjes/repo-s s'ka nevojë për shfletues. `SEO_TOOL_BROWSER=none` e çaktivizon shfletuesin me qëllim (p.sh. për ta provuar këtë rast).

## Instalimi

```bash
npm install
```

Opsionale: kopjo `config.example.json` si `config.json` për të ndryshuar kufijtë (timeout, madhësia, vonesa mes kërkesave). MVP-1 s'kërkon asnjë API key; nëse më vonë shtohen sekrete, ato mbahen në `.env` (i përjashtuar nga Git, shih `.env.example`).

## Instalimi në Windows (pa Node.js)

Paketa `SEO-Tool-<version>-windows-x64.zip` përmban Node.js-in (i nënshkruar nga OpenJS) dhe programin. S'ka nevojë për PowerShell, Node.js të instaluar veçmas apo të drejta administratori.

1. **Kontrollo burimin.** ZIP-i duhet të vijë nga vendi ku e ruan vetë. Krahaso SHA-256 me vlerën te `SEO-Tool-<version>-windows-x64.zip.sha256` (në cmd):
   `certutil -hashfile "SEO-Tool-<version>-windows-x64.zip" SHA256`
2. **Zhbllokoje manualisht** nëse u shkarkua ose u kopjua nga interneti: kliko djathtas mbi ZIP > **Properties** > shëno **Unblock** > OK, *para* nxjerrjes. Programi s'e heq vetë shënimin "nga interneti". Nëse skedarët e nxjerrë e kanë ende, `Instalo.cmd` ndalon pa ndryshuar asgjë dhe shpjegon hapat. Me Smart App Control, Windows i bllokon gjithsesi.
3. **Nxirre ZIP-in** (**Extract All**) në dosjen ku do ta mbash programin. Kjo dosje është dosja e instalimit; mund të ketë hapësira dhe ë/ç.
4. **Hap `Instalo.cmd`** dhe përgjigju pyetjeve:
   - nëse versioni i mëparshëm është në një dosje tjetër, pyet a të hiqet [P/j];
   - shkurtore edhe në Desktop? [p/J];
   - të hapet tani? [P/j].

   Pastaj bën këto:
   - krijon shkurtoren **SEO Tool** në Start Menu me Windows Script Host dhe e verifikon duke e lexuar përsëri;
   - e regjistron programin te Cilësimet > Aplikacionet (HKCU, pa administrator).

   Nëse Windows Script Host është i çaktivizuar ose shkurtorja s'del e saktë, instalimi raportohet si **i papërfunduar**: s'krijohet shkurtore dhe s'regjistrohet asgjë. Mesazhi tregon si hapet programi pa shkurtore (`Hap SEO Tool.cmd`).

**Përdorimi:** Start Menu > SEO Tool (ose `Hap SEO Tool.cmd`). Hapet dritarja e programit dhe dashboard-i në shfletues, vetëm në `127.0.0.1`. Në Windows 11, dritarja shpesh hapet si tab në Windows Terminal.
- Mbyllja e dritares (ose Ctrl+C / Ctrl+Break) anulon auditet në punë; ato pastrojnë vetë.
- Një hapje e dytë rihap të njëjtin dashboard, nuk nis një të dytë.
- Butoni **Hap dosjen e raporteve** (te lista dhe te "Nis audit") hap `output\` në Explorer.
- CLI-ja: `seo-audit.cmd` në dosjen e programit.

**Varësi që s'paketohen** (që paketa të mbetet e vogël):
- **Chrome ose Edge:** për Lighthouse dhe pamjen vizuale. Pa to, dashboard-i jep udhëzim dhe auditi i URL-së vazhdon pa to.
- **Git for Windows:** për auditin e repo-ve. Pa të, dashboard-i jep udhëzim dhe e çaktivizon butonin e repo-s. Pas instalimit të Git-it, programi duhet rihapur.

**Të dhënat** janë jashtë dosjes së instalimit, te `%LOCALAPPDATA%\SEO Tool`:
- `output\`: raportet, LHR dhe screenshot-et;
- `config.json` (opsional, p.sh. `{"lighthouse": {"chromePath": "C:\\…\\chrome.exe"}}`);
- `tmp\`: skedarët e përkohshëm të auditeve (profilet e Chrome, klonet). Çdo hapje e programit e zbraz.

**Përditësimi:**
- Nxirre versionin e ri **mbi të njëjtën dosje** (zëvendëso skedarët) ose në një dosje të re, pastaj hap `Instalo.cmd`.
- Mbi të njëjtën dosje: skedarët e versionit të vjetër që s'janë më në paketë hiqen vetëm brenda `runtime\` dhe `app\`, sipas `app\manifest.txt`.
- Në dosje të re: programi i vjetër hiqet pas konfirmimit.
- Raportet, konfigurimi dhe skedarët e tu (jashtë `runtime\` dhe `app\`) s'preken. Nëse programi është i hapur, përditësimi refuzohet.

**Çinstalimi:** Cilësimet > Aplikacionet > SEO Tool. Heq shkurtoret, regjistrimin dhe vetëm skedarët e programit.
- Raportet dhe konfigurimi **ruhen si parazgjedhje**: fshihen vetëm nëse përgjigjesh "p" te pyetja [p/J].
- Nëse programi është i hapur, çinstalimi refuzohet.
- Pa pyetje: `uninstall --yes` (i ruan të dhënat) ose `--yes --delete-data`.

**Ndërtimi i paketës** (në Windows, nga ky repo): `npm run installer` → `build/SEO-Tool-<version>-windows-x64.zip`.
- Përdor Node-in që e ekzekuton (versioni i testuar) dhe vetëm varësitë e prodhimit.
- Heq source maps, `.d.ts` dhe dokumentimin e paketave, si dhe Sentry/OpenTelemetry. Lighthouse i ngarkon këto vetëm kur raportimi i gabimeve drejt Sentry është aktiv, gjë që ky tool s'e bën kurrë.
- Lokalizimet e Lighthouse mbeten: `locales.js` i importon të gjitha (pa to Lighthouse dështon).

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
| `--no-quality` | Pa modulin "Cilësia e përmbajtjes dhe identiteti vizual" |
| `--no-visual` | Pa renderim desktop/mobile dhe screenshot-e (teksti kontrollohet gjithsesi); `--no-lighthouse` e çaktivizon edhe këtë |
| `--json` | Shtyp JSON-in në stdout në vend të përmbledhjes |

Kodet e daljes: `0` ok (edhe `partial`), `1` gabim i brendshëm, `2` URL/dosje e pavlefshme ose e bllokuar, `3` bllokuar nga robots.txt, `4` repo e paarritshme (private/s'ekziston), e paplotë ose tepër e madhe, `130` i ndërprerë (Ctrl+C ose anulim): pa raport, me burimet e përkohshme të pastruara.

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

### Paketimi për Windows (vendimet)

| Komponenti | Vendimi | Arsyeja |
|---|---|---|
| **Node.js runtime** | `runtime\node.exe` brenda paketës (85.7 MB) | Përdoruesi s'instalon Node. Node SEA u përjashtua: ndryshon binarin e nënshkruar, dhe Smart App Control e bllokon |
| **Instaluesi** | ZIP + `Instalo.cmd` (JS mbi Node-in e paketuar) | Një `Setup.exe` i panënshkruar bllokohet nga Smart App Control (u provua). Nënshkrimi kërkon certifikatë code-signing |
| **Shkurtorja** | `cscript` + WScript.Shell (API zyrtare), e verifikuar duke e lexuar përsëri. Nëse WSH mungon, instalimi del i papërfunduar dhe jepet mënyra pa shkurtore | Pa PowerShell, pa ekzekutues të panënshkruar dhe pa shkurtore të dëmtuar |
| **Git** | **S'paketohet.** Pa të, dashboard-i jep udhëzim për auditin e repo-ve | Paketa mbetet e vogël |
| **Chrome / Chromium** | **S'paketohet.** Përdoret Chrome i instaluar ose Edge (pjesë e Windows 10/11; u provua me Lighthouse dhe renderimin) | Chrome for Testing: 196 MB zip; chrome-headless-shell: 115 MB zip. Kjo do ta trefishonte paketën dhe do të kërkonte përditësime sigurie |
| `lighthouse`, `puppeteer-core`, `chrome-launcher`, `cheerio` | `node_modules` e prodhimit (136 paketa), të pastruara | Pa kod nativ |
| Të dhënat | `%LOCALAPPDATA%\SEO Tool` (output, config.json, tmp) | E shkrueshme nga përdoruesi, jashtë dosjes së instalimit |
| Rrjeti | Dashboard-i dhe guard proxy dëgjojnë vetëm në `127.0.0.1` | Pa porta të hapura në rrjet |

Varësitë vetëm për zhvillim (`typescript`, `tsx`, `vitest`, `cross-env`, `@types/node`) nuk hyjnë në paketë.

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

## Cilësia e përmbajtjes dhe identiteti vizual

Gjen faqe që mund t'i duken vizitorit **gjenerike, të përsëritura ose pa identitet të qartë**. Seksioni `quality` i raportit (`reportSchemaVersion: "4"`) ka **sinjale për shqyrtim njerëzor, pa score**. Qëndron **jashtë Health Score-it** derisa pragjet të kalibrohen.

> "AI slop" është vetëm një emërtim i thjeshtë për këto sinjale. Tool-i **s'pretendon kurrë** se mund të provojë që një tekst apo dizajn është krijuar nga AI. Çdo gjetje e thotë këtë te `whyItMatters`.

Çdo gjetje ka: URL (ose skedar + rresht në `--folder`/`--repo`), provë konkrete, pse ka rëndësi për vizitorin, `confidence` dhe sugjerim praktik. Gjetjet subjektive janë `low` dhe kërkojnë verifikim manual.

**Teksti** (nga HTML-ja e crawl-it; header/nav/footer/aside/form hiqen para analizës):

| Kodi | Kur | Severity / confidence |
|---|---|---|
| `REPEATED_CONTENT_BLOCK` | i njëjti paragraf/listë (≥ 12 fjalë) në ≥ 3 faqe të së njëjtës gjuhë. Blloku në ≥ 60% të faqeve trajtohet si shabllon dhe s'penalizohet | low / 0.5 |
| `GENERIC_COPY` | ≥ 3 fraza të përgjithshme (sq/en) të dendura dhe pak detaje konkrete (çmime, orare, numra, vende) | low / 0.4 |
| `TITLE_CONTENT_MISMATCH` | asnjë fjalë kyçe e titullit (pa emrin e markës) s'del në H1/përmbajtje; forma të lakuara shqip pranohen | low / 0.5 |
| `GENERIC_LINK_TEXT_REPEATED` | i njëjti "Lexo më shumë"/"Read more" drejt ≥ 3 destinacioneve të ndryshme, në përmbajtje (jo në menu/footer), **pa titull ose tekst pranë që i dallon**. Drejt së njëjtës faqe s'raportohet | low / 0.6 |
| `LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT` | si më sipër, por brenda kartave me titull/përshkrim: **vërejtje aksesueshmërie, jo "AI slop"**. Provë: emri i aksesueshëm (teksti, `aria-label`, `aria-labelledby`) dhe konteksti. Emri llogaritet me algoritëm të thjeshtuar: s'është vlerësim përputhshmërie me WCAG, verifikoje me lexues ekrani. Në terminal, gjetjet me të njëjtin model grupohen në një rresht me numrin e faqeve; JSON-i i mban veç (`quality.issues`, plus përmbledhjen `quality.groups`) | low / 0.6 |
| `CTA_REPEATED_ON_PAGE` | i njëjti CTA ≥ 4× drejt së njëjtës faqe, pa kontekst dallues. CTA-të në karta produktesh ose plane çmimesh (titull, koka e kolonës në tabelë) ose drejt destinacioneve të ndryshme s'raportohen | low / 0.4 |

Përkthimet sq/en s'krahasohen me njëra-tjetrën. Faqet ligjore (privatësia, kushtet, cookies) përjashtohen. I njëjti sinjal me prova identike në dy URL (p.sh. `/` dhe `/homepage`) bashkohet në një, me URL-në e dytë te `affectedPages`.

**Pamja** (Chrome headless, **desktop 1366×900 + mobile 390×844**, parazgjedhje 4 faqe përfaqësuese, max 8): faqja hyrëse, pastaj një faqe për çdo lloj (kontakt, produkt, dhoma, menu, blog…), pa faqe ligjore apo `noindex`. Renderimi kalon nga i njëjti guard proxy (SSRF), me ≥ 500 ms mes navigimeve. Ridrejtimi te një host tjetër, HTTP ≥ 400 ose timeout (30 s) → pamja del `skipped` me arsye, dhe moduli del `partial`.

| Kodi | Kur | Severity / confidence |
|---|---|---|
| `MOBILE_HORIZONTAL_OVERFLOW` | `scrollWidth` kalon gjerësinë 390 px me > 8 px | medium / 0.9 |
| `PLACEHOLDER_IMAGE` | imazh nga shërbime placeholder (placehold.co, picsum…) ose me emër placeholder/dummy/no-image në përmbajtje | medium / 0.8 |
| `STOCK_OR_DEMO_IMAGERY` | ≥ 2 imazhe nga banka stock (Unsplash, Pexels, Shutterstock…) ose demo të temës | low / 0.4 |
| `REPEATED_HERO_IMAGE` | i njëjti imazh hero në ≥ 3 faqe (madhësitë WordPress bashkohen) | low / 0.5 |
| `UNIFORM_ICON_CARDS` | ≥ 3 grupe identike ikonë+titull+tekst pa foto, ≥ 9 karta | low / 0.35 |
| `GRADIENT_HEAVY` | i njëjti gradient si sfond në ≥ 3 blloqe të mëdha, ose gradient në ≥ 50% të ≥ 4 seksioneve kryesore (sipas pozicionit). Tekst me gradient s'numërohet | low / 0.35 |
| `IDENTICAL_SECTION_LAYOUT` | e njëjta renditje seksionesh me karta/gradient në ≥ 3 faqe të llojeve të ndryshme | low / 0.35 |

Një gradient, një grup kartash ose një shabllon i zakonshëm, **më vete s'është problem**. Sinjali kërkon përsëritje të matur në faqen e renderuar dhe e thotë që mund të jetë stil i qëllimshëm i markës.

**Screenshot-et** ruhen te `output/visual/{host}-{koha}/` (jashtë Git) dhe lidhen me gjetjet si evidence `screenshot`. Mund të përmbajnë të dhëna të faqes: kontrolloji para se t'i ndash.

**Te `--folder`/`--repo`:** kontrollohet vetëm teksti (`content-quality`, me skedar + rresht). Pamja del `skipped`, sepse renderimi do të ekzekutonte kodin/JS-në e projektit.

## Dashboard-i lokal (prototip)

Ndërfaqe në browser mbi raportet ekzistuese të `output/`. Punon vetëm në këtë kompjuter: pa llogari, pa cloud, pa nisur audite.

```bash
npm run dashboard
```

Hape te `http://127.0.0.1:4780/`. Opsione: `--out <dir>` (parazgjedhje `output/`) dhe `--port <n>`; me `--port 0` zgjidhet një port i lirë.

- **Lista:** data, siti/burimi, lloji (URL, dosje, repo), Health e faqes hyrëse dhe dy kolona të ndara:
  - **Auditi** (`status`): *i përfunduar* kur u kryen modulet; *i pjesshëm* kur disa u anashkaluan.
  - **Crawl-i**: faqet e kontrolluara nga ato të zbuluara, p.sh. `25/81 faqe · crawl i pjesshëm`.

  Një audit i përfunduar mund të ketë crawl të pjesshëm për shkak të kufijve (25 faqe). Lista jep edhe një link për krahasim me raportin e mëparshëm të të njëjtit sit. Raportet e versioneve të vjetra (schema 1–3) hapen me seksionet që kanë.
- **Raporti URL:**
  - Health Score i **faqes hyrëse**, i ndarë qartë nga **mbulimi i pjesshëm i sitit** (faqe të kontrolluara/të zbuluara, pse s'u kontrolluan të tjerat, pikë vetëm për faqet e kontrolluara);
  - biznesi;
  - issue të filtrueshme sipas seksionit, rëndësisë dhe faqes, me prova, rekomandime dhe kufizime.
- **Cilësia:** gjetjet e grupuara (`quality.groups`) dalin si një rresht; secila provë hapet veç, me screenshot-in e saj. Sinjalet shënohen "s'janë provë se faqja është krijuar nga AI" dhe s'hyjnë në Health.
- **Pamjet vizuale:**
  - **Ku:** në krye të raportit, "Pamjet vizuale (N)" dhe "Sinjalet e cilësisë". Paneli "Pamjet e renderuara" shfaq të gjitha pamjet, ndërsa **Hap galerinë** (`/report/<raporti>/visual`) jep filtra sipas faqes dhe pajisjes.
  - **Pamja e madhe:** klikimi mbi një pamje e hap të madhe, me faqen, llojin e faqes, pajisjen, lartësinë e faqes, datën e auditit, skedarin dhe sinjalet e lidhura. Raportet e reja ruajnë edhe viewport-in (i vendosur dhe i matur në faqe), prerjen, përmasat reale të skedarit dhe kohën e kapjes. Raportet e vjetra s'i kanë, prandaj shfaqen si "s'është ruajtur".
  - **Te secili sinjal**, pamjet ndahen qartë:
    - **"Provë e sinjalit"**: vetëm kur shtegu i screenshot-it në provë përputhet saktësisht me një pamje të raportit të së njëjtës faqe; pajisja merret nga ajo pamje;
    - **"Pamje për kontekst"**: e njëjta URL, por jo provë.
  - **Mungesat thuhen shprehimisht:** screenshot që mungon lokalisht, shteg i pavlefshëm (s'shërbehet), faqe pa pamje të renderuar, pamje që s'u renderua.
  - **Raportet e vjetra** pa `quality` ose pa pamje hapen pa gabim, me arsyen.
  - **Jashtë Health Score:** pamjet dhe sinjalet s'hyjnë në të dhe s'janë provë se një faqe është krijuar nga AI.
  - LHR shkarkohet vetëm si skedar.
- **Auditi i skedarëve:** `path:line` (rreshti vetëm kur dihet), kontrollet e anashkaluara me arsyen, mbulimi dhe çfarë s'kontrollohet nga skedarët.
- **Krahasimi** (`/compare`), vetëm për të njëjtin sit ose burim, ndan gjetjet në:
  - **u përmirësua / u përkeqësua**: vetëm për kategoritë pa Lighthouse (p.sh. security, SEO teknik);
  - **rritje/rënie e matur, kërkon konfirmim**: Performance, Accessibility, Best Practices dhe Health, kur ndryshimi kalon ±5. Çdo raport ka vetëm një matje Lighthouse, ndaj një ndryshim i vetëm s'quhet përmirësim ose përkeqësim pa disa ekzekutime;
  - **brenda variacionit**: Lighthouse ±5;
  - **nuk u rilevua në matjen e fundit, kërkon konfirmim**: gjetje Lighthouse (performance, accessibility, best practices) që mungon te raporti i ri. Me një matje për raport, mungesa s'provon që u zgjidh, ndaj s'hyn te "U zgjidhën";
  - **s'krahasohet**, me arsyen:
    - Lighthouse me version, form factor ose Chrome tjetër;
    - crawl me faqe të ndryshme (< 90% të përbashkëta);
    - seksion që mungon në raportin e vjetër;
    - modul i anashkaluar;
    - pikëzim tjetër (`scoringVersion`);
    - **rregulla të ndryshme** (`ruleSetVersion` tjetër ose që mungon). Raportet s'mbajnë version për çdo rregull, ndaj gjetjet që u zhdukën ose u shfaqën dalin "s'krahasohen", me arsyen. Gjetjet që mbetën në të dyja shfaqen si "mbetën".
- **Krahasimi vizual** (`/compare/visual`; nga krahasimi i raporteve → **Hap krahasimin vizual**, ose butoni **Krahaso pamjet** te `/compare`) krahason të njëjtën faqe (URL e njëjtë) në të njëjtën pajisje mes dy auditeve të të njëjtit sit. Para matjes verifikohen:
  - URL-ja e kërkuar dhe ajo përfundimtare (ridrejtimi);
  - pajisja dhe emulimi i ruajtur (mobile/desktop);
  - madhësia e viewport-it (e vendosur dhe e matur në faqe);
  - prerja e screenshot-it (kufiri 3000 px);
  - përmasat reale të skedarëve, të lexuara nga header-i dhe të krahasuara me ato që pretendon raporti;
  - versioni kryesor i Chrome-it.

  Çdo çift del **krahasim i plotë**, **krahasim me kufizime** (p.sh. raport i vjetër pa këto metadata, screenshot i prerë, Chrome tjetër, ridrejtim i ndryshëm) ose **s'krahasohet** (gjerësi/DPR e ndryshme, skedar që mungon ose s'përputhet me raportin, faqe e kapur vetëm në njërin audit). Për çiftin e zgjedhur jepen tabela e verifikimit, **përqindja e pikselëve me diferencë mbi tolerancën 40/255** në të paktën një kanal ngjyre, në zonën e përbashkët (me brezat 200 px ku përqendrohet ndryshimi dhe diferencën më të madhe të një kanali), pamjet krah për krah dhe një mbivendosje "diferencë" (CSS, pa JavaScript, me lartësi të kufizuar dhe lidhje te pamjet origjinale). Te mbivendosja, e zeza do të thotë ngjyrë e njëjtë në A dhe B; gri e errët janë diferenca të vogla (zakonisht zhurmë JPEG, që s'numërohen); zonat e ndriçuara janë ndryshime. Kur viewport-i i njërit raport s'dihet (raport i vjetër), matja shënohet **matje orientuese**: tregon drejtimin, jo një krahasim të verifikuar. Matja s'është vlerësim "më mirë/më keq", s'hyn në Health dhe mund të ndikohet nga përmbajtje dinamike. Toleranca 40/255 për zhurmën e JPEG dhe brezat janë provizore.

  > **Pragjet janë provizore dhe të pakalibruara:** ±5 pikë për variacionin e Lighthouse dhe ≥ 90% faqe të përbashkëta që crawl-i të krahasohet. Pamja e krahasimit e thotë këtë në krye. Mund të ndryshojnë pasi të ketë më shumë ekzekutime të përsëritura të të njëjtit sit.

### Nisja e auditeve nga dashboard-i

Faqja **Nis audit** (`/audit`) ka tre formularë, me vlerat parazgjedhje të shënuara:
- **URL:** faqe maksimale 25 (maks. 100), thellësi 3. Crawl, Lighthouse, biznes, cilësi dhe pamje janë aktive; LHR dhe anashkalimi i robots.txt janë joaktive.
- **Dosje lokale:** shkruan shtegun absolut. Hapi i dytë tregon **dosjen reale që do të lexohet** (pas symlink/junction) dhe disa hyrje të saj, dhe kërkon konfirmim. Refuzohen:
  - shtigjet relative;
  - shtigjet e rrjetit `\\server\share` (në Windows mund t'i dërgojnë kredencialet një hosti tjetër);
  - shtigjet e pajisjeve;
  - rrënja e diskut;
  - dosja e përdoruesit si e tërë;
  - dosjet e sistemit.
- **Repo publike:** vetëm `https://`, pa kredenciale. Validimi i plotë dhe kufijtë e klonimit mbeten ata të motorit.

Çdo audit ekzekutohet nga **CLI-ja ekzistuese** (`src/cli.ts --progress-json`) si proces më vete, pa ndonjë implementim të dytë të kontrolleve dhe pa shell.
- **Faqja e punës** (`/jobs/<id>`) rifreskohet çdo 2 s pa JavaScript dhe tregon:
  - fazën që raporton motori;
  - crawl-in si "faqja N nga maks. 25" (totali i sitit s'dihet paraprakisht);
  - hapat;
  - gabimin me kodin e daljes, ose linkun te raporti.
- **Anulimi** mbyll kanalin stdin të procesit; motori ndalet vetë (shih rregullin më poshtë). Nëse s'del brenda 20 s, gjithë pema e proceseve ndalet me forcë, përfshirë Chrome-in. Puna del **"anuluar", pa raport**. Raporti shkruhet në mënyrë atomike (skedar i përkohshëm + rename), ndaj s'mbetet kurrë një raport i cunguar. Nëse anulimi vjen pasi raporti u shkrua, puna del "përfunduar" me shënim.
- **Kufiri:** 2 audite njëkohësisht, dhe jo dy herë i njëjti objekt. Kërkesa e tretë refuzohet derisa të lirohet një vend.
- Lista e punëve mbahet vetëm sa është hapur dashboard-i; raportet e përfunduara mbeten te `output/` dhe shfaqen sërish kur dashboard-i rihapet.

**Rregulli për auditet e ndërprera** (anulim, Ctrl+C, mbyllje e dritares, ose dashboard-i i vrarë nga Task Manager):
- Motori ndalet vetë, pa shkruar raport, dhe del me kodin 130. Para daljes:
  - ndal Chrome-in (Lighthouse/renderimi) dhe procesin `git`;
  - fshin profilet e përkohshme `website-auditor-*` te `%TEMP%` dhe klonin e repo-s;
  - fshin screenshot-et e pjesshme të atij ekzekutimi (`output/visual/<ekzekutim>/`).
- Screenshot-et i përkasin raportit: mbahen vetëm kur raporti shkruhet.
- Proceset e auditit nisen jashtë "job object"-it të dashboard-it. Kështu, edhe kur dashboard-i vritet, motori e kupton mbylljen nga stdin-i dhe pastron vetë.
- Rasti i vetëm që lë mbetje: vetë procesi i motorit vritet me forcë (pas 20 s anulimi pa përgjigje, ose nga Task Manager). Mbetjet më të vjetra se 24 orë i fshin auditi i radhës:
  - dosjet `website-auditor-*` te `%TEMP%`;
  - dosjet `output/visual/*` që s'i referon asnjë raport.
  Dosjet me raport s'preken kurrë.

**Siguria:** raportet, HTML-ja e kapur si provë dhe URL-të e audituara trajtohen si të dhëna të pabesuara.
- Serveri dëgjon **vetëm në 127.0.0.1** (s'ka opsion për adresë tjetër) dhe pranon vetëm `Host` 127.0.0.1/localhost me portin e vet (mbrojtje nga DNS rebinding).
- Leximi bëhet me GET. **Nisja dhe anulimi** pranohen vetëm me POST nga vetë dashboard-i:
  - `Origin` i vet, ose `Sec-Fetch-Site: same-origin`; faqet e tjera refuzohen;
  - token CSRF i rastësishëm për çdo nisje të serverit (faqet e huaja s'e lexojnë: pa CORS);
  - Content-Type i formularit dhe kufi prej 16 KB për kërkesën.
- Faqet **s'kanë JavaScript** (CSP `script-src 'none'`, `form-action 'self'`); çdo tekst escape-ohet. `Referrer-Policy: same-origin`: pa referrer drejt sajteve të tjera.
- Linket e jashtme lejohen vetëm për `http(s)`, me `noopener noreferrer`.
- Screenshot-et dhe LHR shërbehen vetëm nga `output/` me emra të validuar (pa `..` ose symlink jashtë). Dashboard-i s'kopjon LHR apo screenshot-e brenda JSON-it.
- Kodi i projekteve të audituara **s'ekzekutohet** (dosje/repo: vetëm lexim skedarësh).

Kodi është te `src/dashboard/` (store, model, compare, views, server, jobs, forms), i ndarë nga motori i auditimit.

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
  modules/quality/           # cilësia e përmbajtjes + identiteti vizual (sinjale, pa score)
  quality/                   # analiza e tekstit dhe e pamjes (pa rrjet)
  visual/                    # renderim desktop/mobile + probe (përmes guard proxy)
  source/                    # audit i skedarëve: walk, project, refs, checks, repo (klon i sigurt), run, report
  detection/                 # MVP-3: page-type, tech-stack (confidence + signals), index (faqet + cache)
  intelligence/              # priority (§4), similarity (shingle/Jaccard)
  scoring/scorer.ts          # category → health → risk modifiers (§1)
  report/                    # json, site (seksioni i crawl-it), business (MVP-3), terminal
  dashboard/                 # dashboard lokal: store, model, compare, views (HTML pa JS), server (127.0.0.1), jobs, forms
  app/                       # programi i instaluar: launch (nisësi), setup (instalim/çinstalim, shkurtore e verifikuar), instance
scripts/                     # build-installer (paketa ZIP për Windows), make-icon
tests/                       # vitest + fixtures (HTML, LHR reale), fixture-site.ts (site lokal i kontrolluar)
```
