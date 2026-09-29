import { fnv1a } from '../parse/page.js';

/** Gjatësia e "shingle"-it (fjalë radhazi) për krahasimin e teksteve. */
export const SHINGLE_SIZE = 5;
const MAX_SHINGLES = 4000;

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function shingles(tokens: string[], k = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + k <= tokens.length && out.size < MAX_SHINGLES; i++) out.add(fnv1a(tokens.slice(i, i + k).join(' ')));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Hash i tekstit të normalizuar (fjalët, pa shenja) — sinjal i vetëm, jo provë. */
export function textHash(text: string): string {
  return fnv1a(tokenize(text).join(' '));
}

/**
 * Heq shingle-t që shfaqen në shumicën e faqeve (tekst template-i: menu, banner, CTA),
 * që ngjashmëria të matet mbi përmbajtjen e vetë faqes. Vetëm kur ka mjaft faqe për ta dalluar.
 */
export function removeBoilerplate(sets: Map<string, Set<string>>, threshold = 0.6, minPages = 4): Map<string, Set<string>> {
  if (sets.size < minPages) return sets;
  const df = new Map<string, number>();
  for (const s of sets.values()) for (const x of s) df.set(x, (df.get(x) ?? 0) + 1);
  const limit = threshold * sets.size;
  return new Map([...sets].map(([k, s]) => [k, new Set([...s].filter((x) => (df.get(x) ?? 0) < limit))]));
}
