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

export type ModuleStatus = 'pass' | 'warning' | 'fail' | 'not_applicable' | 'skipped';

export interface AuditResult {
  module: string;
  category: CategoryKey;
  score: number | null;
  status: ModuleStatus;
  partial: boolean;
  reason?: string;
  coverage: { checked: number; discovered: number; truncated: boolean };
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
