import { Analysis, Issue, analyze } from "./analyzer";
import { LINK_RE, PROTECT_RE, restore } from "./markup";
import { builtinChat } from "./webllm";

export interface AiConfig {
  builtinModel: string;
  style: RewriteStyle;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Rewrite {
  text: string;
  gradeBefore: number;
  gradeAfter: number;
  improved: boolean;
  changed: boolean;
  lostLinks: string[];
}

export type RewriteStyle = "balanced" | "voice" | "punchy";

export const STYLES: Record<RewriteStyle, string> = {
  balanced: "Balanced · clear and direct",
  voice: "Keep my voice · minimal edits",
  punchy: "Short and punchy · cut hard",
};

const STYLE_TEXT: Record<RewriteStyle, string> = {
  balanced: "",
  voice: "Style: keep the author's voice and word choice. Change as little as possible. Only fix what makes it hard to read.",
  punchy: "Style: make it short and punchy. Cut every word that does not earn its place. Prefer short, strong sentences.",
};

const SYSTEM = `You are a Hemingway-style editor. You rewrite one hard-to-read passage so it is clear, direct and easy to read.

Rules:
- Keep the exact meaning, tone, voice (first or third person), names, numbers and dates. If a phrase is a link or title, keep its words unchanged. Never add facts, names, numbers or opinions.
- Split long sentences into short ones. Most sentences should be under 15 words. Vary the rhythm, so not every sentence is the same length.
- Use the active voice. Put the doer before the verb.
- Choose strong, concrete verbs. Cut adverbs and hedges such as "very", "really", "just", "I think", "somewhat".
- Prefer plain words: "use" not "utilize", "help" not "facilitate", "start" not "commence".
- Cut filler and repeated ideas. Shorter is better, but do not drop information.
- Use plain punctuation. No semicolons, no em dashes.
- Placeholders like §1§ stand for code or embeds. Copy each one exactly, once.
- Keep paragraph breaks, headings and list markers exactly as they are.
- Reply with ONLY the rewritten passage. No quotes, no labels, no explanation.`;

const EXAMPLES: Array<[string, string]> = [
  [
    "The committee, having carefully considered all of the proposals that had been submitted, ultimately decided to utilize the approach that was recommended by the consultants.",
    "The committee read every proposal. It chose the approach the consultants recommended.",
  ],
  [
    "It is important to note that the results were somewhat influenced by the fact that participants were not adequately informed about the procedures.",
    "The results were skewed. Participants did not know the procedures well enough.",
  ],
  [
    "Please refer to §1§ for the details, which were very thoroughly documented by Maria's team in March.",
    "See §1§ for the details. Maria's team documented them well in March.",
  ],
];

export function cleanReply(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^(here(?:'s| is)[^:\n]*:|(?:the )?rewrite(?:ten)?(?: passage| version| sentence)?\s*:)\s*/i, "");
  out = out.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  return out.replace(/\s*[—–]\s*/g, ", ");
}

export interface LinkRef {
  display: string;
  wrap: (shown: string) => string;
}

export function protect(text: string): { masked: string; tokens: string[]; links: LinkRef[] } {
  const tokens: string[] = [];
  const links: LinkRef[] = [];
  const hidden = text.replace(PROTECT_RE, (m) => {
    tokens.push(m);
    return `§${tokens.length}§`;
  });
  const masked = hidden.replace(LINK_RE, (_m, target?: string, alias?: string, label?: string, url?: string) => {
    if (target !== undefined) {
      const display = (alias ?? target.replace(/#.*$/, "")).trim() || target;
      links.push({ display, wrap: (shown) => (shown === target ? `[[${target}]]` : `[[${target}|${shown}]]`) });
      return display;
    }
    links.push({ display: label ?? "", wrap: (shown) => `[${shown}](${url ?? ""})` });
    return label ?? "";
  });
  return { masked, tokens, links };
}

/** Re-wraps each link's visible text if the rewrite kept it word for word. */
export function relink(text: string, links: LinkRef[]): { text: string; missing: string[] } {
  const missing: string[] = [];
  let out = text;
  const hits: Array<{ start: number; end: number; link: LinkRef }> = [];
  for (const link of links) {
    if (!link.display) continue;
    let at = -1;
    let search = 0;
    while ((at = out.toLowerCase().indexOf(link.display.toLowerCase(), search)) !== -1) {
      if (!hits.some((h) => at < h.end && at + link.display.length > h.start)) break;
      search = at + 1;
    }
    if (at === -1) missing.push(link.display);
    else hits.push({ start: at, end: at + link.display.length, link });
  }
  hits.sort((x, y) => y.start - x.start);
  for (const h of hits) out = out.slice(0, h.start) + h.link.wrap(out.slice(h.start, h.end)) + out.slice(h.end);
  return { text: out, missing };
}

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const nums = (t: string) => (t.match(NUM_RE) ?? []).map((f) => f.replace(/[.,]+$/, ""));
const NAME_RE = /(?<=[\p{Ll}\d,;:]\s)[\p{Lu}][\p{L}'’-]+/gu;
const names = (t: string) => new Set(t.match(NAME_RE) ?? []);
const wordCount = (t: string) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function describe(a: Analysis, text: string): string[] {
  const out: string[] = [];
  const quote = (i: Issue) => `"${text.slice(i.start, i.end).trim()}"`;
  const pick = (kind: Issue["kind"]) => a.issues.filter((i) => i.kind === kind).map(quote);
  const passive = pick("passive");
  const adverbs = pick("adverb");
  const weak = pick("weakener");
  const simpler = a.issues
    .filter((i) => i.kind === "simpler")
    .map((i) => `${quote(i)} → "${i.suggestions?.[0] ?? "a plainer word"}"`);
  if (passive.length) out.push(`Make these active: ${passive.join(", ")}.`);
  if (adverbs.length) out.push(`Cut or replace with a stronger verb: ${adverbs.join(", ")}.`);
  if (weak.length) out.push(`Remove these hedges: ${weak.join(", ")}.`);
  if (simpler.length) out.push(`Use plainer words: ${simpler.join(", ")}.`);
  return out;
}

function userPrompt(sentence: string, hints: string[], context: string, feedback: string, avoid: string[]): string {
  const parts: string[] = [];
  if (context) parts.push(`Context that comes before (do NOT rewrite or repeat it):\n${context}`);
  if (hints.length) parts.push(`Problems to fix:\n${hints.map((h) => `- ${h}`).join("\n")}`);
  if (avoid.length) parts.push(`Write a clearly different version from these earlier ones:\n${avoid.map((a) => `- ${a}`).join("\n")}`);
  if (feedback) parts.push(feedback);
  parts.push(`Original: ${sentence}\nRewrite:`);
  return parts.join("\n\n");
}

interface Candidate {
  text: string;
  analysis: Analysis;
  problems: string[];
  score: number;
}

function judge(
  text: string,
  original: string,
  before: Analysis,
  targetGrade: number,
  avoid: string[],
  style: RewriteStyle
): Candidate {
  const analysis = analyze(text);
  const problems: string[] = [];
  const hardLeft = analysis.counts.hard + analysis.counts.veryhard;
  const needsSimpler = before.counts.hard + before.counts.veryhard > 0;
  const notSimpler = needsSimpler && analysis.grade >= before.grade;
  if (hardLeft) problems.push("Some sentences are still too long or dense. Make them shorter.");
  if (notSimpler) problems.push("It is not simpler than the original. Use shorter sentences and plainer words.");

  const haveNums = nums(text);
  const origNums = nums(original);
  const lostNums = origNums.filter((n) => !haveNums.includes(n));
  const addedNums = haveNums.filter((n) => !origNums.includes(n));
  if (lostNums.length) problems.push(`You dropped these numbers, keep them exactly: ${lostNums.join(", ")}.`);
  if (addedNums.length) problems.push(`You added numbers that are not in the original: ${addedNums.join(", ")}. Remove them.`);
  const origNames = names(original);
  const newNames = names(text);
  const lostNames = [...origNames].filter((n) => !newNames.has(n));
  const addedNames = [...newNames].filter((n) => !origNames.has(n));
  if (lostNames.length) problems.push(`You dropped these names, keep them: ${lostNames.join(", ")}.`);
  if (addedNames.length) problems.push(`You added names that are not in the original: ${addedNames.join(", ")}. Remove them.`);

  const ow = wordCount(original);
  const nw = wordCount(text);
  const tooLong = nw > ow * 1.4 + 4;
  const tooShort = nw < ow * (style === "punchy" ? 0.25 : 0.35);
  if (tooLong) problems.push("It is much longer than the original. Be more concise.");
  if (tooShort) problems.push("It dropped too much of the meaning. Keep every idea.");
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const repeated = norm(text) === norm(original) || avoid.some((a) => norm(a) === norm(text));
  if (repeated) problems.push("It repeats the original or an earlier version. Write it differently.");
  const breaks = (t: string) => (t.match(/\n/g) ?? []).length;
  const brokenLayout = breaks(text) !== breaks(original);
  if (brokenLayout) problems.push("Keep the same number of line breaks as the original.");

  const left = analysis.counts.adverb + analysis.counts.weakener + analysis.counts.passive + analysis.counts.simpler;
  if (left && style !== "voice") {
    const remaining = describe(analysis, text);
    if (remaining.length) problems.push(`It still has: ${remaining.join(" ")}`);
  }

  const score =
    hardLeft * 100 +
    Math.max(0, analysis.grade - targetGrade) * 5 +
    left * 3 +
    (lostNums.length + lostNames.length) * 200 +
    (addedNums.length + addedNames.length) * 120 +
    (notSimpler ? 150 : 0) +
    (tooLong ? 80 : 0) +
    (tooShort ? 200 : 0) +
    (repeated ? 300 : 0) +
    (brokenLayout ? 120 : 0);
  return { text, analysis, problems, score };
}

/** Rewrites a passage, checks each draft against the analyzer, and keeps the best of up to three tries. */
export async function simplify(
  cfg: AiConfig,
  sentence: string,
  targetGrade: number,
  context = "",
  avoid: string[] = [],
  onProgress?: (text: string) => void
): Promise<Rewrite> {
  const before = analyze(sentence);
  const { masked, tokens, links } = protect(sentence);
  const hints = describe(before, sentence);
  const system = [SYSTEM, STYLE_TEXT[cfg.style], `Aim for reading grade ${targetGrade} or lower.`].filter(Boolean).join("\n\n");
  const shots: ChatMessage[] = EXAMPLES.flatMap(([o, r]) => [
    { role: "user" as const, content: `Original: ${o}\nRewrite:` },
    { role: "assistant" as const, content: r },
  ]);
  const wanted = masked.match(/§\d+§/g) ?? [];
  onProgress?.("");
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...shots,
    { role: "user", content: userPrompt(masked, hints, context, "", avoid) },
  ];
  const reply = cleanReply(await chat(cfg, messages, avoid.length ? 0.7 : 0.3, onProgress));
  if (!reply) throw new Error("The model returned an empty answer. Try again.");
  const found = (reply.match(/§\s*\d+\s*§/g) ?? []).map((f) => f.replace(/\s+/g, ""));
  const placeholderBad = wanted.some((w) => found.filter((f) => f === w).length !== 1) || found.length !== wanted.length;
  const linked = relink(reply, links);
  const result = judge(restore(linked.text, tokens), sentence, before, targetGrade, avoid, cfg.style);
  if (linked.missing.length) {
    result.problems.unshift(`Keep these phrases exactly, word for word: ${linked.missing.map((m) => `"${m}"`).join(", ")}.`);
  }
  if (placeholderBad) throw new Error("The model changed protected links or code. Try again.");
  return {
    text: result.text,
    gradeBefore: before.grade,
    gradeAfter: result.analysis.grade,
    improved: result.analysis.grade < before.grade,
    lostLinks: linked.missing,
    changed: result.problems.every((p) => !p.startsWith("It repeats")),
  };
}

export async function chat(
  cfg: AiConfig,
  messages: ChatMessage[],
  temperature: number,
  onToken?: (text: string) => void
): Promise<string> {
  return builtinChat(cfg.builtinModel, messages, temperature, onToken);
}
