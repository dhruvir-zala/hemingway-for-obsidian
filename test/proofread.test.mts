import { computeEdits, labelEdit, maskAll, splitChunks, structureProblems, tooManyChanges } from "../src/proofread-core";

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const orig = "Their going to the libary tomorow, but i dont think its open.";
const fixed = "They're going to the library tomorrow, but I don't think it's open.";
const edits = computeEdits(orig, fixed, "proofread");
let applied = orig;
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

const doc =
  "---\ntitle: x\n---\n\nFirst para line one\nline two.\n\n```js\nconst a = 1;\n```\n\n| a | b |\n\nSecond para.\n";
eq(
  "chunks",
  splitChunks(doc).map((c) => c.text),
  ["First para line one\nline two.", "Second para."]
);
const c0 = splitChunks(doc)[0];
eq("chunk offset", doc.slice(c0.from, c0.from + c0.text.length), c0.text);
const sel = doc.indexOf("Second");
eq(
  "selection chunk",
  splitChunks(doc, sel, sel + 6).map((c) => c.text),
  ["Second"]
);
const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
const parts = splitChunks(long);
eq("long split", parts.length > 1 && parts.every((p) => p.text.length < 1400), true);
eq("long offsets", parts.every((p) => long.slice(p.from, p.from + p.text.length) === p.text), true);
const m = maskAll("See [[Note|alias]] and `code` at https://a.io #tag.");
eq("mask", m.masked, "See §1§ and §2§ at §3§ §4§.");

console.log(fail ? `${fail} FAILED` : "all ok");
process.exit(fail ? 1 : 0);
