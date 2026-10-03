// Common Result Schema (§4 i arkitekturës), me shtesat e MVP-1:
// - CheckResult: çdo kontroll i vetëm, që skipped/not_applicable/info të mos futen në pikëzim.
// - AuditResult.partial: kur një pjesë e kontrolleve s'u krye.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Effort = 'low' | 'medium' | 'high';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type Scope = 'page' | 'template' | 'site';

export type EvidenceType = 'dom' | 'http' | 'metric' | 'screenshot' | 'network' | 'crawl' | 'tls';

export interface Evidence {
  type: EvidenceType;
  url: string;
  detected: string;
  expected?: string;
  raw?: string;
}

export interface Issue {
  code: string;
  module: string;
  scope: Scope;
  url?: string;
  severity: Severity;
  impact: string;
  impactLevel: ImpactLevel;
  effort: Effort;
  affectedPages: string[];
  priority: number;
  confidence: number;
  needsManualReview: boolean;
  message: string;
  whyItMatters: string;
  fix: string;
  estimatedTime?: string;
  evidence: Evidence[];
  /**
   * Vetëm për gjetjet e grupuara sipas template-it: çelësi i plotë (klasat e body-t pa numra, ose hash i
   * skeletit të DOM-it). I njëjti çelës = e njëjta strukturë faqeje, jo domosdoshmërisht i njëjti skedar.
   */
  templateKey?: string;
  /** Prova për çdo faqe të grupit (evidence mban vetëm disa shembuj). */
  occurrences?: { url: string; detected: string; expected?: string }[];
}

/** Issue para se t'i llogaritet priority/needsManualReview nga intelligence layer. */
export type IssueDraft = Omit<Issue, 'priority' | 'needsManualReview' | 'module' | 'confidence' | 'affectedPages'> & {
  confidence?: number;
  affectedPages?: string[];
};

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped' | 'not_applicable' | 'info';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  /** Pesha brenda modulit; checks me score=null nuk llogariten. */
  weight: number;
  /** 0..1, ose null kur kontrolli s'u krye / s'aplikohet / është vetëm informativ. */
  score: number | null;
  reason?: string;
  observations?: string[];
  issues: Issue[];
}

export interface Metric {
  id: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string;
  status: 'measured' | 'unavailable';
  source: string;
  reason?: string;
}

/** info = modul vetëm me sinjale, pa score me qëllim (p.sh. privacy: s'jep verdikt ligjor). */
export type ModuleStatus = 'pass' | 'warning' | 'fail' | 'not_applicable' | 'skipped' | 'info';

export interface AuditResult {
  module: string;
  category: AnyCategoryKey;
  /** homepage = MVP-1; site = crawl (MVP-2); business = conversion/privacy (MVP-3); quality = përmbajtja/pamja. */
  section: 'homepage' | 'site' | 'business' | 'quality';
  score: number | null;
  status: ModuleStatus;
  partial: boolean;
  reason?: string;
  /** excludedByRule: të zbuluara por të përjashtuara me qëllim (unsafe/robots/…), s'e bëjnë partial. */
  coverage: { checked: number; discovered: number; truncated: boolean; excludedByRule?: number };
  checks: CheckResult[];
  issues: Issue[];
  metrics: Metric[];
  limitations: string[];
}

export type CategoryKey =
  | 'performance'
  | 'accessibility'
  | 'bestPractices'
  | 'seoTechnical'
  | 'security'
  | 'availability';

/** Kategoritë e MVP-2 (crawl): gjetje për shumë faqe, jashtë Health Score-it të faqes hyrëse. */
export type SiteCategoryKey = 'links' | 'sitemap' | 'duplicates' | 'contentSeo' | 'caching' | 'i18n';

export const SITE_CATEGORY_LABELS: Record<SiteCategoryKey, string> = {
  links: 'Linke të brendshme',
  sitemap: 'Sitemap',
  duplicates: 'Dyfishime & canonical',
  contentSeo: 'SEO on-page (faqet e tjera)',
  caching: 'Compression/caching (HTML)',
  i18n: 'i18n (hreflang/lang)',
};

export function isSiteCategory(c: string): c is SiteCategoryKey {
  return c in SITE_CATEGORY_LABELS;
}

/** Kategoritë e MVP-3: sinjale biznesi dhe privatësie, jashtë Health Score-it. */
export type BusinessCategoryKey = 'conversion' | 'privacy';

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategoryKey, string> = {
  conversion: 'Conversion (CTA/kontakt/forma)',
  privacy: 'Privacy (sinjale, jo verdikt)',
};

export function isBusinessCategory(c: string): c is BusinessCategoryKey {
  return c in BUSINESS_CATEGORY_LABELS;
}

/** Cilësia e përmbajtjes dhe identiteti vizual: sinjale, jashtë Health Score-it derisa të kalibrohen. */
export type QualityCategoryKey = 'contentQuality' | 'visualIdentity';

export const QUALITY_CATEGORY_LABELS: Record<QualityCategoryKey, string> = {
  contentQuality: 'Cilësia e përmbajtjes',
  visualIdentity: 'Identiteti vizual',
};

export function isQualityCategory(c: string): c is QualityCategoryKey {
  return c in QUALITY_CATEGORY_LABELS;
}

export type AnyCategoryKey = CategoryKey | SiteCategoryKey | BusinessCategoryKey | QualityCategoryKey;

export function sectionOf(c: AnyCategoryKey): AuditResult['section'] {
  return isSiteCategory(c) ? 'site' : isBusinessCategory(c) ? 'business' : isQualityCategory(c) ? 'quality' : 'homepage';
}

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  performance: 'Performance (mobile, lab)',
  accessibility: 'Accessibility (auto)',
  bestPractices: 'Best Practices',
  seoTechnical: 'SEO (Technical)',
  security: 'Security',
  availability: 'Availability',
};

export interface HealthModifier {
  code: string;
  reason: string;
  before: number;
  after: number;
}

export interface HealthResult {
  score: number | null;
  baseScore: number | null;
  status: 'EXCELLENT' | 'GOOD' | 'NEEDS_WORK' | 'POOR' | 'PARTIAL';
  critical: number;
  high: number;
  medium: number;
  low: number;
  coverage: { checked: number; discovered: number; truncated: boolean };
  missingCategories: CategoryKey[];
  modifiers: HealthModifier[];
  limitations: string[];
  needsManualReview: number;
}
