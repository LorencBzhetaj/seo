import type { Severity } from '../core/schemas.js';

/**
 * Sinjal cilësie (përmbajtje/pamje). "AI slop" është vetëm emërtim i thjeshtë për sinjale që kërkojnë
 * shqyrtim njerëzor: asnjë sinjal këtu s'provon që teksti apo dizajni është krijuar nga AI.
 */
export interface QualitySignal {
  code: string;
  /** accessibility: vërejtje aksesueshmërie (p.sh. emri i linkut) — s'është sinjal "AI slop". */
  kind: 'content' | 'visual' | 'accessibility';
  severity: Severity;
  confidence: number;
  message: string;
  /** Faqja (URL) ose skedari; rreshti vetëm kur gjendet me siguri në burim. */
  target: string;
  line?: number;
  /** Faqe/skedarë të tjerë me të njëjtin sinjal. */
  related: string[];
  evidence: string[];
  /** Pse mund të ndikojë te përshtypja e vizitorit. */
  whyItMatters: string;
  suggestion: string;
  /** Screenshot-e (path relativ ndaj dosjes së raporteve) që e mbështesin, kur ka. */
  screenshots?: string[];
}

export const NOT_AUTHORSHIP = 'Sinjal për shqyrtim njerëzor — s\'provon që teksti/dizajni është krijuar nga AI.';

export function signal(s: Omit<QualitySignal, 'related'> & { related?: string[] }): QualitySignal {
  return { related: [], ...s };
}
