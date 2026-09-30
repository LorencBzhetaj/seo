/**
 * Rendering i sigurt i HTML-së: çdo vlerë e interpoluar (nga raportet, URL-të e audituara, HTML-ja e
 * kapur si provë) escape-ohet automatikisht. Vetëm fragmentet e ndërtuara nga vetë ky modul (SafeHtml)
 * kalojnë pa escape. Dashboard-i s'ka JavaScript fare: s'ka vend ku një vlerë e pabesuar të ekzekutohet.
 */

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]!);
}

type Part = SafeHtml | string | number | boolean | null | undefined | Part[];

function render(v: Part): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return escapeHtml(v);
}

/** Template tag: html`<p>${tekstIPabesuar}</p>` → teksti escape-ohet. */
export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new SafeHtml(out);
}

export function join(parts: Part[], sep = ''): SafeHtml {
  return new SafeHtml(parts.map(render).join(render(sep)));
}

/**
 * Link i jashtëm vetëm për http(s): "javascript:", "data:" etj. dalin si tekst i thjeshtë.
 * rel="noopener noreferrer" + referrerpolicy: faqja e hapur s'merr as referrer, as window.opener.
 */
export function externalLink(url: unknown, label?: string): SafeHtml {
  const s = String(url ?? '');
  let ok = false;
  try {
    const u = new URL(s);
    ok = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    ok = false;
  }
  const text = label ?? s;
  return ok
    ? html`<a class="ext" href="${s}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">${text}</a>`
    : html`<span class="plain">${text}</span>`;
}

/** Tekst i shkurtuar për tabela, pa prerë në mes të një surrogate pair-i. */
export function truncate(s: unknown, n: number): string {
  const a = Array.from(String(s ?? ''));
  return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join('');
}
