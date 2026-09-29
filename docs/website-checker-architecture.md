# Website Audit & Improvement Engine — Arkitektura (v3, përdorim personal)

**Statusi:** plan zhvillimi për mjet personal lokal. Fillohet me MVP-1; pikëzimi, diagnozat dhe kostot nuk janë ende të validuara. Nuk ka përdorues të tjerë, llogari, pagesa, multi-tenant, API publike apo deploy të nevojshëm. Raportet dhe historiku ruhen lokalisht. Audito fillimisht vetëm site që i kontrollon vetë; për faqe të palëve të tjera kufizo kërkesat dhe respekto robots.txt. Një audit publik nuk vërteton pajtueshmëri ligjore, aksesueshmëri të plotë, siguri të plotë apo pozicionim në kërkim.

Jo thjesht "checker" që jep numra, por tool që përgjigjet: **çfarë nuk shkon → pse → sa rëndësi ka → ku ndodhet → si rregullohet → sa punë kërkon → sa u përmirësua pas rregullimit.** Sektor-agnostik nga baza — funksionon për çdo lloj websiti, dhe përshtatet automatikisht (jo hardcoded) kur zbulon llojin e sitit.

---

## 0. Terminal, Web App, apo Dashboard?

| | CLI/Terminal | Web App (lokal) | Dashboard (me histori) |
|---|---|---|---|
| Shpejtësi ndërtimi | Më e shpejtë — pa UI | Mesatare | Më e ngadaltë |
| I mirë për 1 audit të shpejtë | ✅ Shumë mirë | ✅ Mirë | ⚠️ Overkill |
| Krahasim me kohën (before/after) | ❌ Manual | ❌ Nuk ruan histori | ✅ Pikë e fortë kryesore |
| Raport i ndashëm me klient | ⚠️ Vetëm JSON/terminal | ✅ HTML i pastër / PDF | ✅ HTML + grafikë |
| Kompleksitet ndërtimi | I ulët | Mesatar | I lartë (DB, storage, scheduling) |

**Vendimi për përdorim personal**: fillo me **CLI lokal**. Ruaj JSON që në MVP-1 dhe shto HTML lokal kur raporti të jetë i dobishëm. SQLite për krahasimet personale mund të vijë më vonë; dashboard, PDF dhe infrastruktura SaaS nuk janë kërkesë për MVP.

---

## 1. Parimi kryesor: Health Score, JO mesatare e thjeshtë

Një `Overall = average(të gjitha scores)` është **misleading**: një Security = 40 s'duhet të "fshihet" pas SEO = 95.

Në vend të kësaj:

```text
WEBSITE HEALTH: 82/100 — GOOD

🔴 Critical    2
🟠 High        5
🟡 Medium      8
🟢 Low         4

Performance       91
SEO (Technical)   87
SEO (Content)     82
Security          64
Accessibility     94
Conversion        76
AI Discoverability 71
```

Rregull i propozuar për t'u validuar: nëse ka **≥1 issue "critical" të konfirmuar me prova**, Health Score kufizohet në max 50. Çdo kufizim shfaqet në raport me arsyen e tij. Një sinjal i pasigurt nuk aktivizon automatikisht kufizimin.

### Struktura e scoring-ut: 2 nivele, jo 1

```text
Category Scores (Performance, SEO, Security, Conversion...)
              ↓
     Base Health Score (mesatare e peshuar)
              ↓
        Risk Modifiers
   (critical issue cap, coverage modifier, confidence modifier)
              ↓
      Final Health Score
```

`Category Score` është rezultat vetëm i kontrolleve të kryera. Mbulimi dhe pasiguria **shfaqen veç** (`coverage`, `limitations`, `needsManualReview`); nuk futen fshehurazi si zbritje pikësh. Nëse një kategori nuk ka matje të vlefshme, rezultati është `null`, jo zero apo 100. Rezultati final nuk gjenerohet kur mungojnë kategori kyçe ose crawl-i ka dështuar; shfaqet `partial`.

### Scoring i versionuar

```json
{
  "scoringVersion": "1.0",
  "ruleSetVersion": "2026.09"
}
```

Peshat e kategorive (Security vs SEO vs Conversion) dhe pragjet e "critical" do të ndryshojnë me kohën. Çdo raport ruan versionin e rregullave me të cilat u gjenerua, që një raport i vjetër të mos ndryshojë retroaktivisht kur ndryshon logjika e scoring-ut — kjo bëhet **kritike** sapo të shtohet Historical Comparison (§12), përndryshe një "përmirësim" mund të jetë thjesht ndryshim rregullash, jo përmirësim real i sitit.

---

## 2. Modulet (të organizuara sipas kategorive)

### A. Core Technical (Lighthouse-based)
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Performance | Lighthouse në laborator: LCP, CLS, TBT dhe diagnoza me prova; INP raportohet vetëm kur ka të dhëna reale të disponueshme (p.sh. CrUX), përndryshe `unavailable` | Lighthouse; burim field data opsional | Pa tarifë API për Lighthouse lokal |
| Accessibility | Kontrollet automatike të Lighthouse; testimi real me tastierë/screen reader shënohet për verifikim manual | Lighthouse | Falas |
| Best Practices | HTTPS, console errors, deprecated APIs | Lighthouse | Falas |
| Mobile / Desktop | 2 device emulations të veçanta | Lighthouse | Falas |

### B. SEO — ndarë Technical vs Content
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Technical SEO | title/meta, canonical kur ka URL të dyfishta ose sinjale konflikti, robots.txt, sitemap, hreflang kur ka variante gjuhësore, status/redirects, noindex; `orphan pages` vetëm nëse ka inventar të besueshëm URL-sh | Lighthouse + HTML parsing | Falas |
| Content/On-page SEO | H1/H2 hierarki, gjatësi përmbajtjeje, alt text, internal linking, FAQ presence, local SEO signals | Custom parsing (jo AI — rregulla) | Falas |
| Broken Links | Skanon linqet e brendshme/të jashtme (me **crawl budget** — shih §7) | Crawler i thjeshtë | Falas |
| Duplicate Content | Titull/meta të njëjta, hash-krahasim teksti mes faqeve | Crawl + hash | Falas |
| Sitemap Health | Jo vetëm `<lastmod>` — ekzistencë, validitet XML, mbulim URL-sh, % me `lastmod`, konsistencë me përmbajtjen e zbuluar nga crawl-i | Parsing + krahasim me crawl | Falas |

### C. Security (ndarë në 3 nën-kategori)
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| HTTP Security Headers | CSP, HSTS, X-Content-Type-Options, frame restrictions, Referrer-Policy etj.; mungesa vlerësohet sipas kontekstit, jo `high` automatikisht | Header parsing; Observatory opsional | Falas lokalisht |
| TLS/Certificate | Validitet dhe skadim lokal; analiza e konfigurimit TLS në shërbim të jashtëm mbetet opsionale | TLS lokal; SSL Labs opsional | Kosto/limite sipas shërbimit |
| Exposure (jo-agresive) | Server headers, `.env`/`.git` të ekspozuar, directory listing, debug endpoints — **verifikim status + content-type + body signature**, jo vetëm `200 → critical` (shumë hosting kthejnë `200` për çdo URL, p.sh. SPA fallback) | Fetch i thjeshtë me URL të njohura — **jo penetration testing** | Falas |

### D. Availability & Infra
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Availability | Uptime, status code, response time | Fetch me timeout | Falas |
| Caching & Compression | `Cache-Control`, gzip/brotli, CDN | Header parsing | Falas |
| URL/Canonical Consistency | www vs non-www, http vs https, trailing slash | Fetch me variacione + redirect chain | Falas |
| Custom Error Pages | 404/500 të dizajnuara apo default | Fetch URL joekzistuese | Falas |
| Favicon/PWA Basics | Favicon, manifest.json, apple-touch-icon | `<head>` parsing | Falas |
| Third-Party Script Audit | Sa scripts të jashtëm, peshë, ndikim në speed | Network log (Puppeteer/Lighthouse) | Falas |

### E. Business/Conversion Audit ⭐ (shtesa më e vlefshme)
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| CTA Visibility | A ka primary CTA, a është above-the-fold, a ka shumë CTA konkurruese | Puppeteer (viewport analysis) + DOM parsing | Falas |
| Contact Accessibility | Telefon/email/WhatsApp clickable (`tel:`/`mailto:`/`wa.me`), adresë, orar, Google Maps link | DOM parsing | Falas |
| Forms Check | Fields, validim, butona, JS errors — **SAFE/dry-run by default, s'bën submit real** (shih §8) | Puppeteer | Falas |
| Trust Signals | Testimonials, reviews, pricing, social proof | DOM/keyword detection | Falas |

> **Implementimi (MVP-3, `src/modules/business/conversion.ts`):** pa Puppeteer. Sinjalet vijnë nga HTML-ja statike e faqeve të mbledhura tashmë (`src/parse/business.ts`), pa kërkesa shtesë. "Above the fold" **s'matet**; raportohet vetëm rajoni (header/përmbajtje/footer) dhe radha në DOM. Forms Check lexon vetëm strukturën (fusha, etiketa, `type`, `required`, buton, captcha, honeypot, action) dhe s'bën submit as dry-run në browser. Mungesat kanë confidence ≤ 0.6 + verifikim manual. Kur HTML-ja duket e renderuar me JS, kontrolli i CTA-së del `skipped`. Kontrolli adresë/hartë/orar aktivizohet nga Page Type Detection dhe issue-t e tij trashëgojnë confidence-in e detektimit. Iframe-t ndër-domain shënohen "përmbajtja s'u kontrollua". Moduli ka score, jashtë Health Score-it.

### F. Privacy/GDPR
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Privacy signals | Banner, politika dhe request-e të palëve të treta para/pas ndërveprimit të kontrolluar; sinjale për shqyrtim manual, jo verdikt ligjor GDPR | DOM + network log | Falas lokalisht |

> **Implementimi (MVP-3, `src/modules/business/privacy.ts`):** moduli **s'ka score** (status `info`) dhe s'formulon kurrë "në përputhje / shkel GDPR". Burimet:
> - HTML statik: linke politikash, CMP të njohura ose markup banner-i, `gtag('consent','default')`, tracker-a, forma me të dhëna personale;
> - log-u i rrjetit i Lighthouse për faqen hyrëse: një ngarkim në profil të ri Chrome, **pa asnjë klik** (pra "para ndërveprimit"), me klasifikimin `entities` të third-party-web dhe emrat e cookies nga auditi `third-party-cookies`. Gjendja "pas ndërveprimit" (pranim/refuzim i banner-it) **s'testohet ende**.
>
> Issue-t (p.sh. `TRACKING_ON_LOAD_WITHOUT_CONSENT_SIGNAL`) janë sinjale me confidence ≤ 0.6 dhe `needsManualReview`. URL-të në prova ruhen pa query (ID klienti), dhe vlerat e cookies s'lexohen.

### G. AI / LLM Discoverability (llms.txt = sinjal i vogël, jo kryesor)
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Structured Information | JSON-LD (Organization, LocalBusiness, Product, FAQ, Breadcrumb — sipas llojit të sitit) | Parsing | Falas |
| Crawlability | robots.txt për AI bots (GPTBot, ClaudeBot, PerplexityBot), sitemap, JS-dependency i përmbajtjes | Fetch + parsing | Falas |
| Semantic Clarity | Struktura semantike HTML, qartësia e entitetit (kush je, çfarë ofron, kontakt) | Parsing | Falas |
| AI-specific Signals | `llms.txt` si informacion opsional, **pa penalizim në score** për mungesën | Fetch | Falas |

### H. Visual UX Audit (jo vetëm "AI Slop")
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| Screenshot Capture | Desktop (1920×1080), Tablet (768×1024), Mobile (390×844) | Puppeteer | Falas |
| Design Originality | Vlerësim jo-gjykues: `strengths[]` (p.sh. "tipografi konsistente") + `templateSignals[]` (p.sh. "gradient hero gjenerik") — **jo etiketë "AI slop"** | Claude API (vision) | ~$0.03–0.08/site (3 screenshots) |
| Visual Hierarchy/Clutter | Densitet elementesh, hierarki, navigim | Claude API (vision, e njëjta thirrje) | Përfshirë më sipër |

### I. Multi-language/i18n
| Modul | Ç'mat | Tool | Kosto |
|---|---|---|---|
| i18n Check | `lang` attribute korrekt, `hreflang`, jo-përzierje gjuhësh | Parsing + krahasim URL | Falas |

### J. Cross-cutting Intelligence (jo module vetjake — ndikojnë mbi modulet e tjera, pjesë e Audit Context §3)
- **Page Type Detection**: zbulon automatikisht llojin e sitit → **aktivizon kontrolle shtesë relevante brenda moduleve ekzistuese** (p.sh. Structured Information kërkon `Restaurant` schema vetëm nëse siti është restorant). Kjo **nuk e bën tool-in sektorial** — e bën më inteligjent për çdo sektor. Output-i s'është një vlerë e thjeshtë por objekt me `confidence` dhe `signals[]`:
  ```json
  {
    "type": "restaurant",
    "confidence": 0.94,
    "signals": ["Restaurant JSON-LD", "menu detected", "reservation CTA", "opening hours"],
    "capabilities": ["booking", "menu", "contact", "blog"],
    "languages": ["sq", "en"]
  }
  ```
  Kështu detection-i mbetet transparent — nëse `confidence` është e ulët, Recommendations Engine e di të mos jetë tepër i sigurt në kontrollet sektoriale që aktivizoi.
- **CMS/Tech Stack Detection**: WordPress, Shopify, Webflow, Next.js, Nuxt etj. → përdoret nga Recommendations Engine për fix specifik (p.sh. "WordPress → përdor plugin WebP" vs "Next.js → përdor `next/image`").

---

## 3. Audit Context — të dhëna të përbashkëta, jo fetch i veçantë për çdo modul

Në vend që çdo modul të bëjë fetch/crawl/screenshot të vetin (shumë request të dyfishta, i ngadaltë), gjithçka kalon nëpër një **context të përbashkët** i ndërtuar një herë:

```typescript
interface AuditContext {
  url: string;
  config: AuditConfig;

  site: SiteInfo;
  pages: Page[];
  techStack: TechStack;         // CMS Detection
  pageType: PageTypeResult;     // Page Type Detection

  crawl: CrawlResult;
  screenshots?: ScreenshotSet;
  lighthouse?: LighthouseResult;
  network?: NetworkLog;
}

// Çdo modul thirret kështu, jo me fetch të vetin:
runTechnicalSEO(context)
runSecurity(context)
runConversion(context)
runAIReadiness(context)
```

Kjo ul dukshëm numrin e request-eve dhe e bën sistemin më të shpejtë dhe më konsistent (të gjitha modulet shohin të njëjtat të dhëna).

### Rrjedha reale (jo `Promise.all` mbi gjithçka)

Disa module varen nga të tjerë (p.sh. Structured Info kontrollon skema specifike vetëm pasi dihet `pageType`; Recommendations kërkon `techStack` për fix specifik). Prandaj runner-i ndjek një **dependency graph**, jo paralelizim të verbër:

```text
URL → Initial Fetch → Tech Stack + Page Type Detection → Crawler
                                    ↓
        ┌───────────────┬────────────────┬───────────────┐
        SEO           Security       Performance     Conversion  (paralel mes tyre)
        └───────────────┴────────────────┴───────────────┘
                                    ↓
                        Evidence Engine
                                    ↓
                    Recommendations Engine
                                    ↓
                        Scoring Engine
                                    ↓
                        Report (JSON/HTML/PDF)
```

### AuditRun — jetëcikli i një ekzekutimi audit

`AuditContext` mban të dhënat e mbledhura; `AuditRun` mban **procesin** — status, kohët, dhe lidhjen me `AuditContext` + rezultatet. Kjo është ajo që bën Historical Comparison (§12) thjesht krahasim mes objekteve `AuditRun`, pa ridizajn database më vonë:

```typescript
interface AuditRun {
  id: string;
  url: string;
  startedAt: string;
  completedAt?: string;
  status: "initializing" | "crawling" | "auditing" | "scoring" | "completed" | "failed";

  config: AuditConfig;
  context: AuditContext;
  results: AuditResult[];

  scoringVersion: string;
  ruleSetVersion: string;
}
```

```text
AuditRun #001 → Health 61
       ↓ (redesign)
AuditRun #002 → Health 89   →   +28 pikë
```

Statusi i `AuditRun` shërben edhe si progress i dukshëm në CLI ("crawling..." → "auditing..." → "scoring...") pa pasur nevojë për logjikë të veçantë raportimi.

### Detection objects mbajnë `confidence` në burim, jo vetëm te Issue

```typescript
interface PageTypeResult {
  type: string;
  confidence: number;
  signals: DetectionSignal[];
  capabilities: string[];
}

interface TechStackResult {
  cms?: string;
  framework?: string;
  hosting?: string;
  confidence: number;
  signals: DetectionSignal[];
}
```

**Implementimi (MVP-3):**
- `PageTypeResult` ka edhe `alternatives[]` (p.sh. guesthouse me restorant) dhe `languages[]`.
- `type`/`cms` janë `"unknown"` kur confidence < 0.5. `TechStackResult` shton `cmsVersion`, `candidates[]`, `builder`, `ecommerce`, `cdn` dhe `extras`.
- `DetectionSignal = { signal, source: html|header|url|schema|network|crawl, url?, weight }`. Confidence = `1 − Π(1 − weight)`: heuristikë e versionuar, jo probabilitet i kalibruar.

Issue-t që rrjedhin nga këto detektime (§4) e trashëgojnë `confidence`-in nga burimi, në vend që ta rillogarisin — kështu s'ka rrezik mospërputhjeje mes detection-it dhe issue-s që e përdor.

---

## 4. Common Result Schema — çdo modul kthen të njëjtin format

```typescript
interface AuditResult {
  module: string;
  score: number | null;
  status: "pass" | "warning" | "fail" | "not_applicable" | "skipped";
  reason?: string;            // i detyrueshëm kur është skipped/not_applicable
  coverage?: { checked: number; discovered?: number; truncated: boolean };
  issues: Issue[];
  metrics: Metric[];
}

interface Issue {
  code: string;
  module: string;
  scope: "page" | "template" | "site";
  url?: string;              // vetëm nëse scope="page"
  severity: "critical" | "high" | "medium" | "low";
  impact: string;             // p.sh. "SEO mesatar", "Performance i lartë"
  effort: "low" | "medium" | "high";
  affectedPages: string[];
  priority: number;           // shih formulën poshtë — jo linear me affectedPages.length
  confidence?: number;        // trashëguar nga detection source (PageTypeResult/TechStackResult) kur aplikohet, shih §3/§5
  message: string;
  whyItMatters: string;
  fix: string;
  estimatedTime?: string;    // vlerësim vetëm kur ka bazë; përndryshe mungon
  evidence: Evidence[];       // ARRAY, jo objekt i vetëm — një issue mund të ketë disa lloje provash
}

type EvidenceType = "dom" | "http" | "metric" | "screenshot" | "network" | "crawl";

interface Evidence {
  type: EvidenceType;
  url: string;
  detected: string;         // çfarë u gjet konkretisht
  expected?: string;         // çfarë duhej të ishte
  raw?: string;               // p.sh. response header, HTML snippet
}
```

**`status: "not_applicable" | "skipped"`** — e domosdoshme sepse jo çdo kontroll aplikohet për çdo lloj siti (p.sh. Product schema për një restorant, hreflang për një site njëgjuhësh). Pa këtë status, Recommendations Engine do të "penalizonte" gabimisht një site për diçka që s'ka kuptim ta ketë.

**Pse `priority` s'është thjesht `severity × affectedPages.length`**: numri linear i faqeve e shtrembëron score-in mes siteve të mëdha/vogla (100 faqe s'do të thotë domosdoshmërisht 5× më shumë impact se 20 faqe). Formula konceptuale përdor `scopeWeight` në vend të numrit të papërpunuar:

```text
priority = severityWeight × impactWeight × scopeWeight × confidence ÷ effortWeight

scopeWeight:
  site-wide (p.sh. TLS, robots.txt)     1.5
  template (p.sh. header/footer i përbashkët)   1.3
  many-pages (>10 faqe të prekura)      1.2
  single-page                            1.0
```

`affectedPages.length` ende përdoret, por me diminishing returns brenda `scopeWeight`, jo si shumëzues linear i drejtpërdrejtë.

**Pse `evidence` është array**: një issue mund të ketë njëkohësisht response header + DOM snippet + Lighthouse metric + screenshot — një objekt i vetëm do ta kufizonte.

**Shembull evidence-driven root cause (jo vetëm "score i keq")**: në vend të "LCP i keq për shkak të hero image" thjesht si supozim, moduli Performance kthen evidence konkrete dhe recommendation-i ndërtohet mbi të:
```json
{
  "type": "metric",
  "url": "https://example.com",
  "detected": "LCP=4.1s, element=img.hero, resource=/images/hero.webp, transferSize=1843921, renderBlocking=false"
}
```
→ Recommendation: "LCP 4.1s; elementi LCP është hero image 1.84 MB." Kjo e diferencon nga një wrapper i thjeshtë i Lighthouse — çdo diagnozë lidhet me evidence konkrete, jo interpretim i supozuar.

**Shembull teknik (canonical; krijo issue vetëm kur ka prova të URL-ve të dyfishta ose sinjale konflikti):**
```json
{
  "code": "MISSING_CANONICAL",
  "scope": "page",
  "url": "https://example.com/about",
  "severity": "medium",
  "effort": "low",
  "affectedPages": ["/about"],
  "priority": 62,
  "message": "Mungon canonical tag",
  "whyItMatters": "U zbuluan variante të kësaj faqeje me përmbajtje të njëjtë; një URL kanonike mund të qartësojë preferencën",
  "fix": "Shto <link rel='canonical' href='https://example.com/about'> te <head>",
  "estimatedTime": "10–30 min",
  "evidence": [
    {
      "type": "dom",
      "url": "https://example.com/about",
      "detected": "Nuk u gjet <link rel='canonical'>",
      "expected": "<link rel='canonical' href='...'>"
    }
  ]
}
```

`issues[]` renditet sipas `priority`; vlerat e peshave janë fillimisht heuristika të dokumentuara, jo matje e provuar e ndikimit biznesor.

---

## 5. Confidence — tool-i s'pretendon 100% siguri gjithmonë

Disa detektime janë probabilistike nga natyra, jo binare (ekziston/s'ekziston). Këto module kthejnë gjithmonë një `confidence: 0-1` bashkë me rezultatin:

- Page Type Detection
- CMS Detection
- Trust Signals (a është vërtet "testimonial" apo thjesht tekst i ngjashëm?)
- Design Originality (gjykim vizual nga Claude vision)
- GDPR/Consent Detection (a është vërtet banner cookie-sh apo diçka tjetër?)

```text
Phone detected: 98% confidence
Restaurant detected: 94%
Cookie banner detected: 71%
Trust signals detected: 63%
```

Kur `confidence` bie nën një prag (p.sh. 70%), Recommendations Engine e shënon issue-n përkatëse si "për verifikim manual" në vend që ta trajtojë si fakt të sigurt — kjo shmang rekomandime false-positive dhe e bën tool-in më të besueshëm.

`confidence` gjenerohet te burimi (`PageTypeResult`, `TechStackResult` — shih §3) dhe trashëgohet nga Issue-t që varen prej tyre, jo e rillogaritur në çdo vend të veçantë.

---

## 6. Output format (raporti final)

```json
{
  "url": "https://example.com",
  "date": "2026-08-21",
  "pageType": "restaurant",
  "cms": "WordPress 6.x",
  "health": {
    "score": 82,
    "status": "GOOD",
    "critical": 0,
    "high": 5,
    "medium": 8,
    "low": 4,
    "coverage": {"checked": 20, "discovered": 28, "truncated": false},
    "limitations": ["INP unavailable: no field data"],
    "needsManualReview": 2
  },
  "categories": {
    "performance": 91,
    "seoTechnical": 87,
    "seoContent": 82,
    "security": 64,
    "accessibility": 94,
    "conversion": 76,
    "aiDiscoverability": 71,
    "designOriginality": 79
  },
  "topImprovements": [
    { "code": "MISSING_CSP_HEADER", "severity": "high", "effort": "medium" },
    { "code": "PHONE_NOT_CLICKABLE", "severity": "medium", "effort": "low" },
    { "code": "MISSING_CANONICAL", "severity": "medium", "effort": "low" }
  ],
  "issues": [ /* lista e plotë Issue[] siç u përshkrua në §4 */ ]
}
```

Raporti terminal (ASCII):
```text
┌─────────────────────────────────┐
│ WEBSITE AUDIT — example.com     │
│                                 │
│       82 / 100  — GOOD          │
├─────────────────────────────────┤
│ Performance          91         │
│ SEO (Technical)       87         │
│ SEO (Content)         82         │
│ Security              64         │
│ Accessibility         94         │
│ Conversion            76         │
├─────────────────────────────────┤
│ 🔴 0 Critical   🟠 5 High        │
│ 🟡 8 Medium     🟢 4 Low         │
├─────────────────────────────────┤
│ TOP IMPROVEMENTS                │
│ 1. Fix CSP header      HIGH     │
│ 2. Phone not clickable MEDIUM   │
│ 3. Missing canonical   MEDIUM   │
└─────────────────────────────────┘
```

---

## 7. Broken Links / Crawler — crawl budget (i detyrueshëm)

Pa këtë, një site me mijëra URL e bllokon tool-in. Config i detyrueshëm:

```json
{
  "maxPages": 500,
  "maxDepth": 5,
  "sameDomainOnly": true,
  "requestDelay": 200,
  "timeout": 10000,
  "excludePatterns": ["/wp-admin", "/cart", "/checkout"]
}
```

Respekton `robots.txt` sipas konfigurimit të crawler-it (mund të anashkalohet vetëm eksplicit nga useri).

---

## 8. Siguria e Forms Check — SAFE mode by default

Simulimi i submit-it të një forme reale (kontakt, booking, newsletter) mund të krijojë të dhëna reale te klienti (email, rezervim fals) — rrezik i shtuar sepse tool-i mund t'ua përdorësh direkt klientëve.

**Default**: kontrollon fields, validim, butona, linqe, JS errors — **s'bën submit real**.

**Konfigurim eksplicit, jo thjesht 1 flag**, që të mos jetë "gjithçka ose asgjë":

```json
{
  "formTesting": {
    "mode": "safe",
    "allowSubmit": false,
    "allowedDomains": [],
    "testDataProfile": "synthetic"
  }
}
```

`allowSubmit: true` aktivizohet vetëm eksplicit; `allowedDomains` kufizon submit real vetëm te domain-e që useri konfirmon; `testDataProfile: "synthetic"` siguron që të dhënat e testit (email, emër) janë qartazi false (p.sh. `test+audit@example.com`), jo të dhëna që duken reale.

---

## 9. Kostoja (për 1 audit të plotë — vlerësim teorik, jo kontratë)

| Komponent | Kosto |
|---|---|
| Të gjitha modulet A-G, I, J (Lighthouse, SEO, security headers, availability, conversion, GDPR, i18n, crawl) | $0 — lokale |
| Modulet H (Visual UX / Design Originality — 3 screenshot → Claude vision) | ~$0.03–0.08/site |
| **Total për 1 audit** | **~$0.08 ose më pak** |

Për 10 site/javë → nën $3.5/muaj. I vetmi komponent me kosto është Visual UX/Design Originality; gjithçka tjetër rrotullohet lokalisht.

**Shënim**: shifrat e mësipërme janë ilustrative. Mjetet lokale konsumojnë kohë, CPU dhe bandwidth; shërbimet e jashtme mund të kenë limite ose tarifa. Vision është `off` si parazgjedhje; mat koston reale nëse aktivizohet.

---

## 10. Struktura e projektit (v1 — flat, jo monorepo)

```
website-auditor/
├── src/
│   ├── core/
│   │   ├── context.ts       # ndërton Audit Context (§3)
│   │   ├── runner.ts        # dependency-aware, JO Promise.all i verbër
│   │   ├── run.ts           # AuditRun lifecycle (§3)
│   │   ├── schemas.ts       # AuditResult, Issue, Evidence (§4)
│   │   └── errors.js
│   ├── detection/
│   │   ├── page-type.ts     # → PageTypeResult (§3) + lloji i çdo faqeje
│   │   ├── tech-stack.ts    # → TechStackResult (§3)
│   │   ├── signals.ts       # combine() = 1 − Π(1 − w), prag "unknown" 0.5
│   │   └── index.ts         # faqet e analizueshme + ctx.detection
│   ├── crawler/
│   │   ├── crawler.js       # me crawl budget (§7)
│   │   ├── robots.js
│   │   ├── queue.js
│   │   └── url-normalizer.js
│   ├── modules/
│   │   ├── core/            # performance, accessibility, best-practices, mobile-desktop
│   │   ├── seo/             # technical-seo, content-seo, broken-links, duplicate-content, sitemap-health
│   │   ├── security/        # headers, tls, exposure
│   │   ├── infra/           # availability, caching, url-consistency, error-pages, favicon, scripts
│   │   ├── business/         # conversion.ts (cta, contact, local-info, forms, trust), privacy.ts (sinjale, pa score)
│   │   ├── ai-readiness/     # structured-info, crawlability, semantic, llms-txt
│   │   ├── visual-ux/        # screenshot capture + Claude vision judge
│   │   └── i18n/
│   ├── intelligence/
│   │   ├── evidence.js       # Evidence Engine (§4)
│   │   ├── recommendations.js
│   │   └── priority.js       # formula me scopeWeight (§4)
│   ├── scoring/
│   │   ├── scorer.js         # Category → Health → Risk Modifiers (§1)
│   │   ├── weights.js
│   │   └── modifiers.js
│   ├── report/
│   │   ├── json.js
│   │   ├── terminal.js
│   │   ├── html.js
│   │   └── pdf.js
│   └── cli.js
├── output/
│   └── {domain}-{date}.json
└── config.json                # kufijtë dhe parametrat; sekretet vetëm në env lokal
```

Kjo ndan qartë 5 shtresa: **mbledhje të dhënash** (`core`, `detection`, `crawler`) → **auditim** (`modules`) → **intelligence** (`evidence`, `recommendations`, `priority`) → **scoring** → **prezantim** (`report`).

**Shënim**: monorepo (`apps/` + `packages/`) do të ishte struktura e duhur **nëse** tool-i evoluon më vonë në produkt me shumë module që zhvillohen veç e veç (ose SaaS multi-user). Për v1, struktura flat me shtresa (siç është këtu) është më e shpejtë për t'u ndërtuar dhe mirëmbajtur pa shtuar kompleksitet setup-i që s'sjell vlerë ende.

---

## 11. Fazat e ndërtimit — MVP progresiv, jo gjithçka njëherësh

Parimi: mos e ndërto çdo modul përpara se të dish nëse **engine-i bazë** (context, runner, scoring, recommendations) është i saktë. Çdo MVP validohet përpara se të kalosh te tjetri.

**MVP-1 — Themeli**
CLI lokal në TypeScript: validim URL → fetch i faqes hyrëse → Lighthouse mobile për atë faqe → title, description, H1, canonical (mungesa është informacion derisa të ketë prova konflikti), robots/noindex, headers, HTTPS, availability → issue me evidence → JSON + përmbledhje terminali. Pa crawler të plotë, exposure probing, submit formularësh, AI vision apo PDF. Gabimi i një moduli nuk fshin rezultatet e të tjerëve. **Kriter pranimi:** ekzekutim me një komandë, JSON i ruajtur, status `skipped`/`partial`, prova konkrete dhe verifikim manual i raporteve në 2–3 site të njohura.

**MVP-2 — Crawler & Content**
Crawler (me crawl budget, §7) → Broken Links + Duplicate Content + Sitemap Health + Content/On-page SEO + Caching/Compression + i18n Check.

**MVP-3 — Business Intelligence**
Conversion Audit (CTA, contact, forms në SAFE mode) + Privacy/GDPR + Page Type Detection e plotë (me confidence/signals/capabilities) + CMS Detection — këto feed-ojnë Recommendations Engine me fix specifik.
*Statusi: implementuar si CLI, në pritje të shqyrtimit.* Seksioni `business` i raportit është jashtë Health Score-it (`scoringVersion 1.0` i pandryshuar, `ruleSetVersion 2026.09-mvp3`, `reportSchemaVersion 3`).
- Detektimi: `src/detection/` (`page-type.ts`, `tech-stack.ts`, `signals.ts`). Llogaritet një herë nga AuditContext (`ctx.detection`), pa rrjet.
- Për "Recommendations Engine" ekziston vetëm një hap i parë: fix-i i privatësisë përmend zgjidhjen për WordPress kur CMS-i ka confidence ≥ 0.7.
- Jashtë: renderimi me JS dhe viewport, klikimi i banner-it, dry-run i formave në browser.

**Faza pas MVP-3 — Auditi i skedarëve (`--folder`, `--repo`)**
*Statusi: implementuar si CLI, në pritje të shqyrtimit.*
- Kodi: `src/source/`, i ndarë nga auditi i URL-së, me raport të veçantë (`reportType: source-audit`).
- Kontrollet: HTML/CSS/JS statik (linke/asete lokale me path + rresht, SEO në HTML, dublikime, imazhe, konfigurime, skedarë të ndjeshëm), lloji i projektit dhe matrica e kontrolleve të mbështetura.
- Për kodin që kërkon build/server/renderim: `skipped` me arsye. **Pa Health Score dhe pa Lighthouse**, sepse kodi s'ekzekutohet.
- `--repo`: klon i cekët i përkohshëm i një repo publike https, pa skripte, hooks, LFS apo kredenciale, me kufi madhësie dhe kohe; repo private kërkojnë konfigurim të veçantë.

**Faza pas auditit të skedarëve — Cilësia e përmbajtjes dhe identiteti vizual ("AI slop")**
*Statusi: implementuar, në pritje të shqyrtimit. Jashtë Health Score-it derisa të kalibrohet.*
Sinjale, **jo provë autorësie**:
- Kodi:
  - `src/quality/` (text, visual, signals): analizë e pastër, pa rrjet;
  - `src/visual/` (capture me puppeteer-core përmes guard proxy-t, probe në faqe);
  - `src/modules/quality/`: kategoritë `contentQuality` dhe `visualIdentity`, seksioni `quality`, status `info`/`skipped`, pa score.
- Teksti: blloqe të përsëritura mes faqeve (shablloni ≥ 60% përjashtohet), fraza gjenerike pa detaje konkrete, titull ↔ përmbajtje, linke/CTA të përsëritura pa kontekst. Header/footer ndahen nga përmbajtja. Gjuhët krahasohen veç e veç.
- Pamja: desktop + mobile në ≤ 4 faqe përfaqësuese (max 8), me screenshot-e lokale si evidence: overflow mobile, placeholder/stock, hero i përsëritur, karta ikonash uniforme, gradient i përsëritur, layout identik mes llojeve të faqeve. Pamja që s'renderohet → `skipped` me arsye.
- `--folder`/`--repo`: vetëm teksti (skedar + rresht). Pamja `skipped`, sepse s'ekzekutohet kodi i projektit.

Çdo sinjal ka confidence të ulët dhe kërkon verifikim manual. Pa verdikt "e shkruar nga AI". Gjykimi vizual me model (Claude vision) mbetet te MVP-4. Faza e radhës: dashboard-i lokal.

**MVP-4 — AI & Visual**
AI/LLM Discoverability + Visual UX Audit (screenshot 3 breakpoint + Design Originality via Claude vision — i vetmi modul me kosto).

**Report Layer** (paralel me MVP-2/3, jo fazë e veçantë e ndarë): terminal output që nga MVP-1, HTML report me Top Improvements + Evidence kur ka disa module gati, PDF export kur tool-i është gati për t'u ndarë me klientë.

---

## 12. Roadmap (jo MVP, por vlerë e lartë komerciale për më vonë)

- **Historical Comparison** (SQLite): before/after pas redesign-eve — "Health: 61 → 89, +28 pikë". Kjo është veçoria që e kthen tool-in nga "developer utility" në diçka që i tregon vlerë reale klientit.
- **Competitor Benchmark** i zgjeruar: jo vetëm speed, por krahasim multi-kategori (SEO, Security, Accessibility, Conversion, Design) kundrejt 1-2 site referuese që specifikon vetë.
- **Dashboard personal lokal** vetëm kur CLI dhe raportet janë të besueshme; scheduling dhe alerts sipas nevojës.
- **Vision Provider abstraction** (Claude/OpenAI/Gemini) — vetëm nëse del nevoja reale për të ndryshuar provider; s'ka vlerë ta ndërtosh paraprakisht.


## 13. Rregulla të zbatimit personal

- Përdor TypeScript në gjithë projektin; emrat `.js` të mbetur në pemën ilustrative implementohen si `.ts`.
- Pas MVP-1: `maxPages: 25`, `maxDepth: 3`, concurrency 2, vonesë të paktën 500 ms për host, timeout 10 s dhe kufi madhësie përgjigjeje; respekto `robots.txt`. Shmang login, logout, cart, checkout dhe URL që mund të ndryshojnë gjendje.
- URL të jashtme: prano vetëm `http(s)`; blloko localhost, IP private/link-local dhe ridrejtimet drejt tyre, përfshirë navigimet në browser. Testi lokal lejohet vetëm në mënyrë eksplicite për fixtures.
- `output/`, screenshots dhe logs mbeten lokalisht dhe përjashtohen nga Git. Mos ruaj cookies, authorization headers apo trup të plotë formularësh te evidence.
- Raporti shfaq URL, kohën, konfigurimin, versionet e rregullave dhe Lighthouse, mbulimin dhe kufizimet. Një pikëzim laboratorik i një faqeje nuk përfaqëson të gjithë sitin.
- Verifiko parser/scoring me fixtures HTML, një test CLI mbi server lokal dhe kontroll manual të 2–3 raporteve para MVP-2.
