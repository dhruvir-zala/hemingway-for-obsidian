import { wordDiff } from "./diff";
import { replaceLinks, replaceProtected } from "./markup";

export type ProofLevel = "proofread" | "grammar" | "edit";

/** Largest share of words the model may change before a result is rejected as a rewrite. */
export const CHANGE_LIMIT: Record<ProofLevel, number> = { proofread: 0.2, grammar: 0.3, edit: 0.45 };

export interface Chunk {
  from: number;
  text: string;
}

export interface Edit {
  from: number;
  to: number;
  del: string;
  ins: string;
  label: string;
}

const MAX_CHUNK = 1200;

function splitLong(start: number, text: string): Chunk[] {
  if (text.length <= MAX_CHUNK) return [{ from: start, text }];
  const pieces: Array<[number, number]> = [];
  let cur = 0;
  let lastEnd = -1;
  let lastNext = -1;
  // Matches the punctuation too, so `end` skips past it to sit where the whitespace starts.
  for (const m of text.matchAll(/([.!?])\s+|\n/g)) {
    const at = m.index ?? 0;
    const end = at + (m[1]?.length ?? 0);
    if (end - cur > MAX_CHUNK && lastEnd > cur) {
      pieces.push([cur, lastEnd]);
      cur = lastNext;
    }
    lastEnd = end;
    lastNext = at + m[0].length;
  }
  pieces.push([cur, text.length]);
  return pieces.map(([a, b]) => ({ from: start + a, text: text.slice(a, b) })).filter((c) => c.text.trim());
}

/** Splits [from, to) into paragraph-sized chunks, skipping front matter, code, math, tables and rules. */
export function splitChunks(doc: string, from = 0, to = doc.length): Chunk[] {
  const out: Chunk[] = [];
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(doc);
  const frontEnd = front ? front[0].length : 0;
  let fence: string | null = null;
  let math = false;
  let group: { start: number; end: number } | null = null;

  const emit = (start: number, end: number) => {
    const raw = doc.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (/\p{L}{2}/u.test(text)) out.push(...splitLong(start + lead, text));
  };

  let pos = 0;
  while (pos <= doc.length) {
    let nl = doc.indexOf("\n", pos);
    if (nl === -1) nl = doc.length;
    const lineStart = pos;
    const lineEnd = doc[nl - 1] === "\r" && nl > pos ? nl - 1 : nl;
    const line = doc.slice(lineStart, lineEnd);
    if (lineStart >= to) break;

    let skip = lineStart < frontEnd;
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      skip = true;
      if (fenceMatch && fenceMatch[1] === fence) fence = null;
    } else if (fenceMatch) {
      skip = true;
      fence = fenceMatch[1];
    } else if (/^\s*\$\$\s*$/.test(line)) {
      skip = true;
      math = !math;
    } else if (math) skip = true;
    else if (/^\s*\|/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*%%/.test(line) || /^\s*<\/?[a-z]/i.test(line)) skip = true;

    const inRange = lineEnd > from && lineStart < to;
    if (skip || !line.trim() || !inRange) {
      if (group) emit(group.start, group.end);
      group = null;
    } else {
      const s = Math.max(lineStart, from);
      const e = Math.min(lineEnd, to);
      group = group ? { start: group.start, end: e } : { start: s, end: e };
    }
    if (nl >= doc.length) break;
    pos = nl + 1;
  }
  if (group) emit(group.start, group.end);
  return out;
}

/** Hides links, embeds, code, URLs and tags behind §n§ placeholders so they can't be altered. */
export function maskAll(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const hide = (m: string) => {
    tokens.push(m);
    return `§${tokens.length}§`;
  };
  return { masked: replaceProtected(replaceLinks(text, hide), hide), tokens };
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function labelEdit(del: string, ins: string, level: ProofLevel): string {
  const d = del.trim();
  const i = ins.trim();
  if (!d && !i) return "Spacing";
  if (d.toLowerCase() === i.toLowerCase()) return "Capitalization";
  const strip = (t: string) => t.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const wd = strip(d);
  const wi = strip(i);
  if (wd === wi) return "Punctuation";
  if (wd && wi && !/\s/.test(wd) && !/\s/.test(wi) && lev(wd.toLowerCase(), wi.toLowerCase()) <= Math.max(2, Math.floor(wd.length * 0.34))) {
    return "Spelling";
  }
  return level === "edit" ? "Edit" : "Grammar";
}

/** Turns the difference between two texts into separate, individually applicable edits. */
export function computeEdits(original: string, corrected: string, level: ProofLevel): Edit[] {
  const raw: Array<{ from: number; to: number; del: string; ins: string }> = [];
  let pos = 0;
  let cur: { from: number; to: number; del: string; ins: string } | null = null;
  for (const part of wordDiff(original, corrected)) {
    if (part.type === "same") {
      if (cur) raw.push(cur);
      cur = null;
      pos += part.text.length;
      continue;
    }
    if (!cur) cur = { from: pos, to: pos, del: "", ins: "" };
    if (part.type === "del") {
      cur.del += part.text;
      pos += part.text.length;
      cur.to = pos;
    } else cur.ins += part.text;
  }
  if (cur) raw.push(cur);

  // Runs of deleted words ("very much") read better as one edit.
  const merged: typeof raw = [];
  for (const e of raw) {
    const prev = merged[merged.length - 1];
    const gap = prev ? original.slice(prev.to, e.from) : "";
    if (prev && !prev.ins && !e.ins && /^\s+$/.test(gap)) {
      prev.del += gap + e.del;
      prev.to = e.to;
    } else merged.push({ ...e });
  }
  return merged.map((e) => ({ ...e, label: labelEdit(e.del, e.ins, level) }));
}

const words = (t: string) => t.match(/\S+/g)?.length ?? 0;

/** Share of the original's words that were changed (the larger of removed and added). */
export function changeRatio(original: string, corrected: string): number {
  let del = 0;
  let ins = 0;
  for (const p of wordDiff(original, corrected)) {
    if (p.type === "del") del += words(p.text);
    else if (p.type === "ins") ins += words(p.text);
  }
  return Math.max(del, ins) / Math.max(1, words(original));
}

export function tooManyChanges(original: string, corrected: string, level: ProofLevel): boolean {
  const changed = changeRatio(original, corrected) * Math.max(1, words(original));
  return changed > Math.max(2, CHANGE_LIMIT[level] * words(original));
}

const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]+$/, "")).sort().join("|");
const MARKER_RE = /^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+(?:\[.\]\s+)?/;

/** Returns problems that show the model altered numbers, line layout or markdown. */
export function structureProblems(original: string, corrected: string): string[] {
  const out: string[] = [];
  if (nums(original) !== nums(corrected)) out.push("You changed or moved numbers. Keep every number exactly.");
  const a = original.split("\n");
  const b = corrected.split("\n");
  if (a.length !== b.length) out.push("Keep the same number of lines and line breaks.");
  else if (a.some((line, i) => (MARKER_RE.exec(line)?.[0].trim() ?? "") !== (MARKER_RE.exec(b[i])?.[0].trim() ?? ""))) {
    out.push("Keep list markers, heading marks and quote marks exactly.");
  }
  for (const m of ["**", "__", "==", "~~"]) {
    if (original.split(m).length !== corrected.split(m).length) out.push(`Keep the ${m} formatting marks exactly.`);
  }
  return out;
}
