// Parser minimal robots.txt sipas RFC 9309: grupe user-agent, Allow/Disallow,
// përputhja më e gjatë fiton, Allow fiton në barazi, wildcard `*` dhe `$`.

export interface RobotsRule {
  allow: boolean;
  pattern: string;
  line: number;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export interface RobotsDecision {
  allowed: boolean;
  /** Grupi që u aplikua ("*" ose tokeni specifik); null kur s'ka grup që përputhet. */
  matchedAgent: string | null;
  rule?: RobotsRule;
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) return;
    const sep = line.indexOf(':');
    if (sep === -1) return;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      return;
    }
    lastWasAgent = false;
    if ((key === 'allow' || key === 'disallow') && current) {
      // "Disallow:" bosh = lejo gjithçka → nuk shtohet rregull
      if (value === '') return;
      current.rules.push({ allow: key === 'allow', pattern: value, line: idx + 1 });
    }
  });
  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const escaped = p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

function selectGroups(robots: ParsedRobots, userAgent: string): { groups: RobotsGroup[]; agent: string | null } {
  const token = userAgent.toLowerCase();
  // Grupi specifik: tokeni i agent-it përmban emrin e grupit (p.sh. "googlebot").
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  if (specific.length > 0) {
    const longest = Math.max(...specific.flatMap((g) => g.agents.filter((a) => token.includes(a)).map((a) => a.length)));
    const best = specific.filter((g) => g.agents.some((a) => token.includes(a) && a.length === longest));
    return { groups: best, agent: best[0]!.agents.find((a) => token.includes(a)) ?? null };
  }
  const star = robots.groups.filter((g) => g.agents.includes('*'));
  return { groups: star, agent: star.length ? '*' : null };
}

/** A lejohet `path` (me query) për `userAgent`? */
export function isAllowed(robots: ParsedRobots, userAgent: string, path: string): RobotsDecision {
  const { groups, agent } = selectGroups(robots, userAgent);
  const rules = groups.flatMap((g) => g.rules);
  let best: RobotsRule | undefined;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return { allowed: best ? best.allow : true, matchedAgent: agent, rule: best };
}
