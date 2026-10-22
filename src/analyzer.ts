import {
  ADJECTIVAL,
  IRREGULAR_PARTICIPLES,
  NOT_ADVERBS,
  NOT_PARTICIPLES,
  SIMPLER,
  WEAKENERS,
} from "./lexicon";

export type Kind =
  | "hard"
  | "veryhard"
  | "adverb"
  | "passive"
  | "weakener"
  | "simpler";

export interface Issue {
  start: number;
  end: number;
  kind: Kind;
  suggestions?: string[];
  words?: number;
  grade?: number;
}

export interface Options {
  extraWeakeners?: string[];
  ignore?: string[];
}

export interface Analysis {
  issues: Issue[];
  words: number;
  characters: number;
  letters: number;
  sentences: number;
  paragraphs: number;
  grade: number;
  counts: Record<Kind, number>;
}

const WORD_RE = /\d+(?:[.,]\d+)*|[A-Za-z\u00C0-\u024F]+(?:['’\-][A-Za-z\u00C0-\u024F\d]+)*/g;

function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    if (chars[i] !== "\n") chars[i] = " ";
  }
}

/** Replaces markdown syntax with spaces so offsets still match the raw text. */
export function maskMarkdown(text: string): string {
  const c = text.split("");
  const run = (re: RegExp, keepGroup?: number) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (keepGroup === undefined) {
        blank(c, m.index, m.index + m[0].length);
      } else {
        const g = m[keepGroup];
        const gStart = m.index + m[0].indexOf(g);
        blank(c, m.index, gStart);
        blank(c, gStart + g.length, m.index + m[0].length);
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  };

  run(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/g);
  run(/^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$)/gm);
  run(/<!--[\s\S]*?-->/g);
  run(/%%[\s\S]*?%%/g);
  run(/`[^`\n]+`/g);
  run(/!\[\[[^\]\n]*\]\]/g);
  run(/!\[[^\]\n]*\]\([^)\n]*\)/g);
  run(/\[\[(?:[^\]|\n]*\|)?([^\]\n]*)\]\]/g, 1);
  run(/\[([^\]\n]*)\]\([^)\n]*\)/g, 1);
  run(/https?:\/\/\S+/g);
  run(/<\/?[A-Za-z][^>\n]*>/g);
  run(/^[ \t]{0,3}#{1,6}[ \t]+/gm);
  run(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/gm);
  run(/^[ \t]*(?:>[ \t]?)+/gm);
  run(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm);
  run(/\*+|~~|==/g);
  run(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g);
  run(/\^[A-Za-z0-9-]+$/gm);
  run(/\|/g);
  return c.join("");
}

function matchCase(source: string, replacement: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (p: string) =>
  new RegExp(`(?<![A-Za-z'’-])${p.split(" ").map(escapeRe).join("\\s+")}(?![A-Za-z'’-])`, "gi");

const SIMPLER_RES = Object.keys(SIMPLER)
  .sort((a, b) => b.length - a.length)
  .map((k) => ({ key: k, re: phraseRe(k) }));
const weakenerCache = new Map<string, RegExp[]>();
function weakenerRes(extra: string[]): RegExp[] {
  const key = extra.join("\n");
  let res = weakenerCache.get(key);
  if (!res) {
    res = [...WEAKENERS, ...extra].sort((a, b) => b.length - a.length).map((k) => phraseRe(k));
    weakenerCache.set(key, res);
  }
  return res;
}

const BE = "is|are|was|were|be|been|being|am|isn't|aren't|wasn't|weren't|isn’t|aren’t|wasn’t|weren’t";
// Words that may sit between the "be" verb and the participle: "was not yet done".
const FILLER = "(?:[A-Za-z]+ly|not|never|also|still|already|always|ever|yet|now|then|just|even|often|usually)";
const PASSIVE_RE = new RegExp(
  `(?<![A-Za-z'’-])(?:${BE})(?:\\s+${FILLER})*\\s+([A-Za-z]+)(?![A-Za-z'’-])`,
  "gi"
);
const ADVERB_RE = /(?<![A-Za-z'’-])[A-Za-z]{3,}ly(?![A-Za-z'’-])/g;

function isParticiple(word: string): boolean {
  const w = word.toLowerCase();
  if (NOT_PARTICIPLES.has(w) || ADJECTIVAL.has(w)) return false;
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  return w.length > 4 && w.endsWith("ed");
}

const overlaps = (list: Issue[], s: number, e: number) => list.some((i) => s < i.end && e > i.start);

function splitSentences(masked: string): Array<{ start: number; end: number }> {
  const work = masked
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, "\u0001"))
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Inc|Ltd)\./g, (m) => m.slice(0, -1) + "\u0001")
    .replace(/(\d)\.(?=\d)/g, "$1\u0001");
  const out: Array<{ start: number; end: number }> = [];
  const re = /[^.!?\n]+(?:[.!?]+["'”’)\]]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(work))) {
    const lead = m[0].length - m[0].trimStart().length;
    const trail = m[0].length - m[0].trimEnd().length;
    const start = m.index + lead;
    const end = m.index + m[0].length - trail;
    if (end > start) out.push({ start, end });
  }
  return out;
}

export function analyze(text: string, opts: Options = {}): Analysis {
  const ignore = new Set((opts.ignore ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean));
  const extra = (opts.extraWeakeners ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);
  const weakeners = weakenerRes(extra);
  const masked = maskMarkdown(text);
  const issues: Issue[] = [];
  const counts: Record<Kind, number> = {
    hard: 0,
    veryhard: 0,
    adverb: 0,
    passive: 0,
    weakener: 0,
    simpler: 0,
  };
  let words = 0;
  let letters = 0;
  let sentences = 0;

  for (const s of splitSentences(masked)) {
    const seg = masked.slice(s.start, s.end);
    const sw = seg.match(WORD_RE) ?? [];
    if (sw.length === 0) continue;
    const sLetters = sw.reduce((n, w) => n + w.replace(/[^A-Za-z0-9\u00C0-\u024F]/g, "").length, 0);
    words += sw.length;
    letters += sLetters;
    sentences++;

    const level = 4.71 * (sLetters / sw.length) + 0.5 * sw.length - 21.43;
    if (sw.length >= 14 && level >= 10) {
      const kind: Kind = level >= 14 ? "veryhard" : "hard";
      issues.push({ start: s.start, end: s.end, kind, words: sw.length, grade: Math.max(0, Math.round(level)) });
      counts[kind]++;
    }

    const local: Issue[] = [];
    // Offsets in `local` are absolute; match positions below are sentence-relative.
    const tryPush = (kind: Kind, start: number, end: number, suggestions?: string[]) => {
      if (overlaps(local, s.start + start, s.start + end)) return;
      const shown = seg.slice(start, end).toLowerCase();
      if (ignore.size && (ignore.has(shown) || shown.split(/\s+/).some((w) => ignore.has(w)))) return;
      local.push({ start: s.start + start, end: s.start + end, kind, suggestions });
    };

    for (const { key, re } of SIMPLER_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg))) {
        tryPush("simpler", m.index, m.index + m[0].length, SIMPLER[key].map((r) => matchCase(m![0], r)));
      }
    }
    for (const re of weakeners) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg))) tryPush("weakener", m.index, m.index + m[0].length);
    }
    PASSIVE_RE.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = PASSIVE_RE.exec(seg))) {
      if (isParticiple(pm[1])) tryPush("passive", pm.index, pm.index + pm[0].length);
    }
    ADVERB_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ADVERB_RE.exec(seg))) {
      if (NOT_ADVERBS.has(am[0].toLowerCase())) continue;
      // A capitalised word mid-sentence is almost always a name ("Emily", "Italy").
      if (am.index > 0 && /[A-Z]/.test(am[0][0]) && /[a-z0-9,;]/.test(seg.slice(0, am.index).trimEnd().slice(-1))) continue;
      tryPush("adverb", am.index, am.index + am[0].length);
    }
    for (const i of local) {
      counts[i.kind]++;
      issues.push(i);
    }
  }

  issues.sort((a, b) => a.start - b.start || b.end - a.end);

  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .filter((p) => maskMarkdown(p).trim().length > 0).length;
  const grade =
    words === 0 || sentences === 0
      ? 0
      : Math.max(0, Math.round(4.71 * (letters / words) + 0.5 * (words / sentences) - 21.43));

  return {
    issues,
    words,
    characters: masked
      .split("\n")
      .map((l) => l.trim().replace(/\s+/g, " "))
      .join("").length,
    letters,
    sentences,
    paragraphs,
    grade,
    counts,
  };
}
