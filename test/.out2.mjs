// src/diff.ts
var tokens = (t) => t.match(/\s+|[^\s]+/g) ?? [];
function wordDiff(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  const n = x.length;
  const m2 = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m2 + 1));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m2 - 1; j2 >= 0; j2--) {
      dp[i2][j2] = x[i2] === y[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const parts2 = [];
  const push = (type, text) => {
    const last = parts2[parts2.length - 1];
    if (last && last.type === type) last.text += text;
    else parts2.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m2) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m2) push("ins", y[j++]);
  return parts2;
}

// src/markup.ts
var PROTECT_RE = /!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|https?:\/\/[^\s)\]]+|\[\^[^\]\n]+\]|(?<![\w/])#[\p{L}\d_/-]+/gu;
var LINK_RE = /(?<!!)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|(?<!!)\[([^\]\n]+)\]\(([^)\n]*)\)/g;

// src/proofread-core.ts
var CHANGE_LIMIT = { proofread: 0.2, grammar: 0.3, edit: 0.45 };
var MAX_CHUNK = 1200;
function splitLong(start, text) {
  if (text.length <= MAX_CHUNK) return [{ from: start, text }];
  const pieces = [];
  let cur = 0;
  let lastEnd = -1;
  let lastNext = -1;
  for (const m2 of text.matchAll(/(?<=[.!?])\s+|\n/g)) {
    const end = m2.index ?? 0;
    if (end - cur > MAX_CHUNK && lastEnd > cur) {
      pieces.push([cur, lastEnd]);
      cur = lastNext;
    }
    lastEnd = end;
    lastNext = end + m2[0].length;
  }
  pieces.push([cur, text.length]);
  return pieces.map(([a, b]) => ({ from: start + a, text: text.slice(a, b) })).filter((c) => c.text.trim());
}
function splitChunks(doc2, from = 0, to = doc2.length) {
  const out = [];
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(doc2);
  const frontEnd = front ? front[0].length : 0;
  let fence = null;
  let math = false;
  let group = null;
  const emit = (start, end) => {
    const raw = doc2.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (/\p{L}{2}/u.test(text)) out.push(...splitLong(start + lead, text));
  };
  let pos = 0;
  while (pos <= doc2.length) {
    let nl = doc2.indexOf("\n", pos);
    if (nl === -1) nl = doc2.length;
    const lineStart = pos;
    const lineEnd = doc2[nl - 1] === "\r" && nl > pos ? nl - 1 : nl;
    const line = doc2.slice(lineStart, lineEnd);
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
    if (nl >= doc2.length) break;
    pos = nl + 1;
  }
  if (group) emit(group.start, group.end);
  return out;
}
function maskAll(text) {
  const tokens2 = [];
  const hide = (m2) => {
    tokens2.push(m2);
    return `\xA7${tokens2.length}\xA7`;
  };
  return { masked: text.replace(LINK_RE, hide).replace(PROTECT_RE, hide), tokens: tokens2 };
}
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
function labelEdit(del, ins, level) {
  const d = del.trim();
  const i = ins.trim();
  if (!d && !i) return "Spacing";
  if (d.toLowerCase() === i.toLowerCase()) return "Capitalization";
  const strip = (t) => t.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const wd = strip(d);
  const wi = strip(i);
  if (wd === wi) return "Punctuation";
  if (wd && wi && !/\s/.test(wd) && !/\s/.test(wi) && lev(wd.toLowerCase(), wi.toLowerCase()) <= Math.max(2, Math.floor(wd.length * 0.34))) {
    return "Spelling";
  }
  return level === "edit" ? "Edit" : "Grammar";
}
function computeEdits(original, corrected, level) {
  const raw = [];
  let pos = 0;
  let cur = null;
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
  const merged = [];
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
var words = (t) => t.match(/\S+/g)?.length ?? 0;
function changeRatio(original, corrected) {
  let del = 0;
  let ins = 0;
  for (const p of wordDiff(original, corrected)) {
    if (p.type === "del") del += words(p.text);
    else if (p.type === "ins") ins += words(p.text);
  }
  return Math.max(del, ins) / Math.max(1, words(original));
}
function tooManyChanges(original, corrected, level) {
  const changed = changeRatio(original, corrected) * Math.max(1, words(original));
  return changed > Math.max(2, CHANGE_LIMIT[level] * words(original));
}
var nums = (t) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]+$/, "")).sort().join("|");
var MARKER_RE = /^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+(?:\[.\]\s+)?/;
function structureProblems(original, corrected) {
  const out = [];
  if (nums(original) !== nums(corrected)) out.push("You changed or moved numbers. Keep every number exactly.");
  const a = original.split("\n");
  const b = corrected.split("\n");
  if (a.length !== b.length) out.push("Keep the same number of lines and line breaks.");
  else if (a.some((line, i) => (MARKER_RE.exec(line)?.[0].trim() ?? "") !== (MARKER_RE.exec(b[i])?.[0].trim() ?? ""))) {
    out.push("Keep list markers, heading marks and quote marks exactly.");
  }
  for (const m2 of ["**", "__", "==", "~~"]) {
    if (original.split(m2).length !== corrected.split(m2).length) out.push(`Keep the ${m2} formatting marks exactly.`);
  }
  return out;
}

// test/proofread.test.mts
var fail = 0;
var eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
var orig = "Their going to the libary tomorow, but i dont think its open.";
var fixed = "They're going to the library tomorrow, but I don't think it's open.";
var edits = computeEdits(orig, fixed, "proofread");
var applied = orig;
for (const e of [...edits].reverse()) applied = applied.slice(0, e.from) + e.ins + applied.slice(e.to);
eq("edits apply back to corrected text", applied, fixed);
eq("several separate edits", edits.length >= 5, true);
eq("label spelling", labelEdit("libary", "library", "grammar"), "Spelling");
eq("label capitalization", labelEdit("i", "I", "grammar"), "Capitalization");
eq("label punctuation", labelEdit("", ",", "grammar"), "Punctuation");
eq("label grammar", labelEdit("was", "were", "grammar"), "Grammar");
eq("no edits when same", computeEdits("All fine here.", "All fine here.", "grammar"), []);
eq(
  "rewrite rejected",
  tooManyChanges("The cat sat on the mat today.", "A feline rested upon that rug during this afternoon.", "grammar"),
  true
);
eq("small fix allowed", tooManyChanges("She don't like it at all, really.", "She doesn't like it at all, really.", "proofread"), false);
eq("numbers", structureProblems("Pay 30 now", "Pay 300 now").length, 1);
eq("lines", structureProblems("a\nb", "a b").length, 1);
eq("markers", structureProblems("- item", "item").length, 1);
eq("structure ok", structureProblems("- item 3", "- Item 3"), []);
var doc = "---\ntitle: x\n---\n\nFirst para line one\nline two.\n\n```js\nconst a = 1;\n```\n\n| a | b |\n\nSecond para.\n";
eq(
  "chunks",
  splitChunks(doc).map((c) => c.text),
  ["First para line one\nline two.", "Second para."]
);
var c0 = splitChunks(doc)[0];
eq("chunk offset", doc.slice(c0.from, c0.from + c0.text.length), c0.text);
var sel = doc.indexOf("Second");
eq(
  "selection chunk",
  splitChunks(doc, sel, sel + 6).map((c) => c.text),
  ["Second"]
);
var long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
var parts = splitChunks(long);
eq("long split", parts.length > 1 && parts.every((p) => p.text.length < 1400), true);
eq("long offsets", parts.every((p) => long.slice(p.from, p.from + p.text.length) === p.text), true);
var m = maskAll("See [[Note|alias]] and `code` at https://a.io #tag.");
eq("mask", m.masked, "See \xA71\xA7 and \xA72\xA7 at \xA73\xA7 \xA74\xA7.");
console.log(fail ? `${fail} FAILED` : "all ok");
process.exit(fail ? 1 : 0);
