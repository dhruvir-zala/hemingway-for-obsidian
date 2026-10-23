// Embeds, code, bare URLs, footnotes and tags are hidden behind placeholders.
export const PROTECT_RE = /!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|https?:\/\/[^\s)\]]+|\[\^[^\]\n]+\]|(?<![\w/])#[\p{L}\d_/-]+/gu;
// Wikilinks and markdown links.
export const LINK_RE = /(?<!!)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|(?<!!)\[([^\]\n]+)\]\(([^)\n]*)\)/g;

export function restore(text: string, tokens: string[]): string {
  return text.replace(/§\s*(\d+)\s*§/g, (m, n: string) => tokens[Number(n) - 1] ?? m);
}
