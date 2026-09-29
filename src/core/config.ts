import fs from 'node:fs';
import path from 'node:path';

export interface AuditConfig {
  /** Timeout për çdo kërkesë HTTP (ms). */
  timeout: number;
  /** Kufiri i madhësisë së përgjigjes (bytes, pas dekompresimit). */
  maxResponseBytes: number;
  maxRedirects: number;
  /** Vonesë minimale mes kërkesave drejt të njëjtit host (ms). */
  requestDelay: number;
  userAgent: string;
  /** Respekto robots.txt për user-agent-in e tool-it; anashkalohet vetëm eksplicit. */
  respectRobots: boolean;
  lighthouse: {
    enabled: boolean;
    formFactor: 'mobile';
    maxWaitForLoad: number;
    chromePath?: string;
    /** Ruaj LHR-në e plotë lokalisht pranë raportit (--save-lhr). Joaktive si parazgjedhje. */
    saveLhr: boolean;
  };
  /**
   * Hostet private/lokale të lejuara EKSPLICIT (vetëm për fixtures/teste lokale),
   * p.sh. ["127.0.0.1:4321"]. Bosh si parazgjedhje: localhost dhe IP private bllokohen.
   */
  allowedPrivateHosts: string[];
  outputDir: string;
  /** Crawler-i i MVP-2 (§7, §13). */
  crawl: {
    enabled: boolean;
    /** Kërkesa maksimale për faqe (përfshirë faqen hyrëse). */
    maxPages: number;
    /** Thellësia maksimale e linkeve nga faqja hyrëse (0). */
    maxDepth: number;
    concurrency: number;
    /** Kufi kohor i gjithë crawl-it (ms). */
    maxDurationMs: number;
    /** Modele shtesë (substring në path) që s'vizitohen; rregullat e sigurisë të integruara zbatohen gjithmonë. */
    excludePatterns: string[];
    /** Sa URL nga sitemap-i lexohen gjithsej, dhe sa sitemap-e (index → fëmijë). */
    maxSitemapUrls: number;
    maxSitemaps: number;
  };
  /** MVP-3: conversion + privacy + detektimi i llojit të faqes/CMS-it (vetëm lexim i të dhënave të mbledhura). */
  business: {
    enabled: boolean;
  };
  /** Auditi i skedarëve (--folder/--repo): kufijtë e leximit dhe të klonimit. */
  source: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxDepth: number;
    repoMaxBytes: number;
    repoTimeoutMs: number;
  };
}

/** Kufiri i sipërm i lejuar për --max-pages (përdorim personal, i kujdesshëm me serverin). */
export const MAX_PAGES_HARD_LIMIT = 100;
/** Vonesa minimale mes kërkesave te i njëjti host për site të jashtme (§13). */
export const MIN_REQUEST_DELAY_MS = 500;

export const DEFAULT_CONFIG: AuditConfig = {
  timeout: 10_000,
  maxResponseBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  requestDelay: 500,
  userAgent: 'WebsiteAuditor/0.1 (personal local audit; MVP-1)',
  respectRobots: true,
  lighthouse: {
    enabled: true,
    formFactor: 'mobile',
    maxWaitForLoad: 45_000,
    saveLhr: false,
  },
  allowedPrivateHosts: [],
  outputDir: 'output',
  crawl: {
    enabled: true,
    maxPages: 25,
    maxDepth: 3,
    concurrency: 2,
    maxDurationMs: 180_000,
    excludePatterns: ['/wp-admin', '/cart', '/checkout'],
    maxSitemapUrls: 5000,
    maxSitemaps: 10,
  },
  business: {
    enabled: true,
  },
  source: {
    maxFiles: 5000,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 300 * 1024 * 1024,
    maxDepth: 25,
    repoMaxBytes: 150 * 1024 * 1024,
    repoTimeoutMs: 120_000,
  },
};

/** Shkrin config.json (opsional) mbi parazgjedhjet. Sekretet nuk mbahen këtu. */
export function loadConfig(configPath?: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
  let fileConfig: Partial<AuditConfig> = {};
  const candidate = configPath ?? path.resolve('config.json');
  if (fs.existsSync(candidate)) {
    fileConfig = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Partial<AuditConfig>;
  } else if (configPath) {
    throw new Error(`Config nuk u gjet: ${configPath}`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...overrides,
    crawl: { ...DEFAULT_CONFIG.crawl, ...(fileConfig.crawl ?? {}), ...(overrides.crawl ?? {}) },
    business: { ...DEFAULT_CONFIG.business, ...(fileConfig.business ?? {}), ...(overrides.business ?? {}) },
    source: { ...DEFAULT_CONFIG.source, ...(fileConfig.source ?? {}), ...(overrides.source ?? {}) },
    lighthouse: {
      ...DEFAULT_CONFIG.lighthouse,
      ...(fileConfig.lighthouse ?? {}),
      ...(overrides.lighthouse ?? {}),
    },
  };
}
