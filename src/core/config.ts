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
  };
  /**
   * Hostet private/lokale të lejuara EKSPLICIT (vetëm për fixtures/teste lokale),
   * p.sh. ["127.0.0.1:4321"]. Bosh si parazgjedhje: localhost dhe IP private bllokohen.
   */
  allowedPrivateHosts: string[];
  outputDir: string;
}

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
  },
  allowedPrivateHosts: [],
  outputDir: 'output',
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
    lighthouse: {
      ...DEFAULT_CONFIG.lighthouse,
      ...(fileConfig.lighthouse ?? {}),
      ...(overrides.lighthouse ?? {}),
    },
  };
}
