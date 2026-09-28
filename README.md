# Website Auditor — MVP-1

CLI lokal (Node.js + TypeScript) që auditon **faqen hyrëse** të një siti dhe jep: çfarë nuk shkon → provën konkrete → sa rëndësi ka → si rregullohet. Arkitektura e plotë: [docs/website-checker-architecture.md](docs/website-checker-architecture.md). Ky repo implementon **vetëm MVP-1** (§11).

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
| `--ignore-robots` | Anashkalo robots.txt për tool-in — **vetëm për site që i kontrollon vetë** |
| `--allow-local <host:port>` | **Vetëm për fixtures/teste**: lejo një host lokal |
| `--json` | Shtyp JSON-in në stdout në vend të përmbledhjes |

Kodet e daljes: `0` ok (edhe `partial`), `1` gabim i brendshëm, `2` URL e pavlefshme/e bllokuar, `3` bllokuar nga robots.txt.

Raporti ruhet si `output/{host}-{YYYYMMDD-HHmmss}.json` (dosja `output/` është në `.gitignore`).

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

## Jashtë MVP-1 (me qëllim)

Crawler i plotë, broken links, sitemap, dublikatë përmbajtjeje, submit formularësh, exposure probing (`.env`/`.git`), thirrje AI/vision, HTML/PDF report, dashboard, histori (SQLite), `llms.txt`, desktop Lighthouse.

## Struktura

```
src/
  cli.ts                     # hyrja e CLI
  core/                      # config, schemas (§4), context (§3), run (AuditRun + runner)
  net/                       # url-guard, safe-fetch, tls-info, guard-proxy
  parse/                     # html (cheerio), robots (RFC 9309)
  lighthouse/                # ekzekutimi i Lighthouse mobile
  modules/                   # availability, seo-technical, security, lighthouse-modules
  intelligence/priority.ts   # formula e priority (§4)
  scoring/scorer.ts          # category → health → risk modifiers (§1)
  report/                    # json, terminal
tests/                       # vitest + fixtures (HTML, LHR reale e shkurtuar)
```
