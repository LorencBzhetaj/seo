/** Një sinjal i vetëm detektimi, me burimin dhe peshën (sa e rrit besimin). */
export interface DetectionSignal {
  signal: string;
  source: 'html' | 'header' | 'url' | 'schema' | 'network' | 'crawl';
  url?: string;
  weight: number;
}

export interface Candidate {
  name: string;
  confidence: number;
  signals: DetectionSignal[];
}

/**
 * Kombinon sinjale të pavarura: 1 − Π(1 − w). Dy sinjale 0.5 → 0.75; asnjëherë > 0.99.
 * Heuristikë e versionuar me ruleSetVersion, jo probabilitet i kalibruar.
 */
export function combine(signals: Pick<DetectionSignal, 'weight'>[]): number {
  const p = 1 - signals.reduce((acc, s) => acc * (1 - Math.min(Math.max(s.weight, 0), 0.99)), 1);
  return Math.round(Math.min(p, 0.99) * 100) / 100;
}

/** Nën këtë confidence, emri s'jepet: "unknown" (provat s'mjaftojnë). */
export const MIN_CONFIDENCE = 0.5;

/** Mbledh sinjalet sipas emrit (një sinjal i njëjtë numërohet një herë) dhe i rendit sipas confidence. */
export function rank(found: { name: string; signal: DetectionSignal }[]): Candidate[] {
  const by = new Map<string, DetectionSignal[]>();
  for (const f of found) {
    const list = by.get(f.name) ?? [];
    if (!list.some((s) => s.signal === f.signal.signal)) list.push(f.signal);
    by.set(f.name, list);
  }
  return [...by]
    .map(([name, signals]) => ({ name, confidence: combine(signals), signals }))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}
