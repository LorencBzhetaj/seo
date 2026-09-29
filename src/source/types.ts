import type { Severity } from '../core/schemas.js';

/**
 * Auditi i skedarëve (dosje lokale / repo): gjetjet lidhen me një path relativ dhe, kur
 * përcaktohet me besueshmëri, me rreshtin. Asgjë s'ekzekutohet: pa build, pa server, pa skripte.
 */
export type SourceCategory = 'links' | 'seo' | 'images' | 'duplicates' | 'config' | 'security' | 'files';

export interface SourceFinding {
  code: string;
  category: SourceCategory;
  severity: Severity;
  /** 0..1; nën 0.7 → verifikim manual. */
  confidence: number;
  needsManualReview: boolean;
  message: string;
  /** Path relativ ndaj rrënjës së dosjes/repo-s, me "/" (edhe në Windows). */
  file: string;
  /** Rreshti (1-based), vetëm kur njihet me siguri nga parser-i; përndryshe mungon. */
  line?: number;
  /** Prova konkrete (p.sh. atributi, madhësia, rregulli). Sekretet maskohen. */
  evidence: string;
  suggestion: string;
  /** Vende të tjera me të njëjtin problem (p.sh. i njëjti titull në disa skedarë). */
  related?: { file: string; line?: number }[];
}

export type SourceCheckStatus = 'pass' | 'warning' | 'fail' | 'skipped' | 'not_applicable' | 'info';

export interface SourceCheck {
  id: string;
  label: string;
  status: SourceCheckStatus;
  /** Për skipped/not_applicable: pse (p.sh. "kërkon build"). */
  reason?: string;
  observations?: string[];
  findingCodes: string[];
}

export interface FileEntry {
  /** Path relativ me "/". */
  rel: string;
  abs: string;
  size: number;
  ext: string;
}

export type SkipReason = 'ignored-dir' | 'symlink' | 'symlink-outside' | 'too-large' | 'binary' | 'max-files' | 'max-total-bytes' | 'max-depth' | 'unreadable' | 'lfs-pointer';

export const SKIP_LABELS: Record<SkipReason, string> = {
  'ignored-dir': 'dosje varësish/VCS/build-cache (p.sh. node_modules, .git, .next)',
  symlink: 'symlink brenda dosjes — s\'ndiqet',
  'symlink-outside': 'symlink që del jashtë dosjes — s\'ndiqet',
  'too-large': 'skedar teksti më i madh se kufiri i leximit',
  binary: 'skedar binar (s\'lexohet si tekst)',
  'max-files': 'kufiri i numrit të skedarëve',
  'max-total-bytes': 'kufiri i madhësisë totale',
  'max-depth': 'kufiri i thellësisë së dosjeve',
  unreadable: 'skedar i palexueshëm',
  'lfs-pointer': 'Git LFS pointer — përmbajtja reale s\'u shkarkua',
};

export interface SourceLimits {
  maxFiles: number;
  /** Madhësia maksimale e një skedari teksti që lexohet (bytes). */
  maxFileBytes: number;
  /** Madhësia totale e skedarëve të numëruar (bytes, sipas stat). */
  maxTotalBytes: number;
  maxDepth: number;
}

export const DEFAULT_SOURCE_LIMITS: SourceLimits = {
  maxFiles: 5000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  maxDepth: 25,
};
