import { AiConfig, ChatMessage, chat } from "./ai";
import { restore } from "./markup";
import {
  Chunk,
  Edit,
  ProofLevel,
  computeEdits,
  maskAll,
  structureProblems,
  tooManyChanges,
} from "./proofread-core";

export interface ChunkResult {
  chunk: Chunk;
  edits: Edit[];
  skipped?: string;
}

const SYSTEM = `You are a careful proofreader. You correct mistakes. You do NOT rewrite.

Rules:
- Return the same text with only the necessary corrections.
- Never rephrase, reorder, shorten, expand or "improve" anything that is already correct. Keep the author's words, voice and style.
- Keep the language of the text. Never translate.
- If the text has no mistakes, return it exactly unchanged.
- Do not add or remove sentences, lines or paragraphs.
- Keep line breaks, markdown (headings, list markers, bold, italics), numbers, names and placeholders like §1§ exactly as they are.
- Reply with ONLY the corrected text. No quotes, no labels, no explanation.`;

const SCOPE: Record<ProofLevel, string> = {
  proofread: "Fix only: spelling mistakes, typos, wrong capitalization, punctuation errors and spacing. Do not touch grammar or wording.",
  grammar:
    "Fix: spelling, typos, capitalization, punctuation and spacing, plus grammar mistakes (agreement, tense, articles, prepositions, word forms, wrong homophones). Do not change wording that is grammatical.",
  edit:
    "Fix: spelling, typos, capitalization, punctuation, spacing and grammar, plus wrong or misused words, accidental repetition and clearly clumsy phrasing. Change as few words as possible and keep the author's voice.",
};

const EXAMPLES: Record<ProofLevel, Array<[string, string]>> = {
  proofread: [
    ["Their going to the libary tomorow, but i dont think its open.", "They're going to the library tomorrow, but I don't think it's open."],
    ["The report is ready. Please review it by Friday.", "The report is ready. Please review it by Friday."],
  ],
  grammar: [
    ["She don't like the the new office, and me and him was late.", "She doesn't like the new office, and he and I were late."],
    ["The report is ready. Please review it by Friday.", "The report is ready. Please review it by Friday."],
  ],
  edit: [
    ["The meeting was very much long and we discussed about many thing.", "The meeting was very long and we discussed many things."],
    ["The report is ready. Please review it by Friday.", "The report is ready. Please review it by Friday."],
  ],
};

function clean(raw: string, original: string): string {
  let out = raw.trim();
  if (!/^```/.test(original)) out = out.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, "$1");
  if (!/^here/i.test(original)) out = out.replace(/^here(?:'s| is)[^\n]*:\s*\n/i, "");
  return out.trim();
}

const sortedPlaceholders = (t: string) =>
  (t.match(/§\s*\d+\s*§/g) ?? [])
    .map((p) => p.replace(/\s+/g, ""))
    .sort()
    .join("|");

/** Proofreads one chunk and returns individually applicable edits. */
export async function proofChunk(cfg: AiConfig, level: ProofLevel, chunk: Chunk): Promise<ChunkResult> {
  const { masked, tokens } = maskAll(chunk.text);
  const wanted = sortedPlaceholders(masked);
  const shots: ChatMessage[] = EXAMPLES[level].flatMap(([o, r]) => [
    { role: "user" as const, content: `Text:\n${o}\nCorrected:` },
    { role: "assistant" as const, content: r },
  ]);
  let feedback = "";
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM}\n\n${SCOPE[level]}` },
      ...shots,
      { role: "user", content: `${feedback}Text:\n${masked}\nCorrected:` },
    ];
    const reply = clean(await chat(cfg, messages, attempt === 0 ? 0.1 : 0.3), masked);
    if (!reply) {
      lastProblem = "The model returned nothing.";
      continue;
    }
    if (reply === masked) return { chunk, edits: [] };
    const problems: string[] = [];
    if (sortedPlaceholders(reply) !== wanted) problems.push(`Keep every placeholder exactly once: ${wanted.split("|").join(" ")}.`);
    const corrected = restore(reply, tokens);
    problems.push(...structureProblems(chunk.text, corrected));
    if (tooManyChanges(chunk.text, corrected, level)) {
      problems.push("You changed too much. This is proofreading, not rewriting. Fix only real mistakes and leave everything else untouched.");
    }
    if (!problems.length) return { chunk, edits: computeEdits(chunk.text, corrected, level) };
    lastProblem = problems[0];
    feedback = `Your previous answer was rejected:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nTry again, changing as little as possible.\n\n`;
  }
  return { chunk, edits: [], skipped: lastProblem };
}

/** Proofreads chunks one after another; stops early when shouldStop returns true. */
export async function runProofread(
  cfg: AiConfig,
  level: ProofLevel,
  chunks: Chunk[],
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean
): Promise<ChunkResult[]> {
  const results: ChunkResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (shouldStop()) break;
    onProgress(i, chunks.length);
    results.push(await proofChunk(cfg, level, chunks[i]));
  }
  onProgress(results.length, chunks.length);
  return results;
}
