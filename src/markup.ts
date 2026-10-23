// Embeds, code, bare URLs, footnotes and tags are hidden behind placeholders.
export const PROTECT_RE = /!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|https?:\/\/[^\s)\]]+|\[\^[^\]\n]+\]|#[\p{L}\d_/-]+/gu;
// Wikilinks and markdown links.
export const LINK_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|\[([^\]\n]+)\]\(([^)\n]*)\)/g;

export function restore(text: string, tokens: string[]): string {
  return text.replace(/§\s*(\d+)\s*§/g, (m, n: string) => tokens[Number(n) - 1] ?? m);
}

// Lookbehinds crash on iOS before 16.4, so the leading-character checks happen here instead.
type Replacer = (m: string, ...groups: (string | undefined)[]) => string;
const offsetOf = (args: unknown[]) => args[args.length - 2] as number;

/** Replaces PROTECT_RE matches, skipping tags that start mid-word or right after a slash. */
export function replaceProtected(text: string, fn: Replacer): string {
  return text.replace(PROTECT_RE, (...args: unknown[]) => {
    const m = args[0] as string;
    const prev = text[offsetOf(args) - 1] ?? "";
    if (m[0] === "#" && /[\w/]/.test(prev)) return m;
    return fn(m, ...(args.slice(1, -2) as (string | undefined)[]));
  });
}

/** Replaces LINK_RE matches, skipping embeds (a link preceded by "!"). */
export function replaceLinks(text: string, fn: Replacer): string {
  return text.replace(LINK_RE, (...args: unknown[]) => {
    const m = args[0] as string;
    if (text[offsetOf(args) - 1] === "!") return m;
    return fn(m, ...(args.slice(1, -2) as (string | undefined)[]));
  });
}
