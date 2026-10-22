import type { Kind } from "./analyzer";

export const ALL_KINDS: Kind[] = ["hard", "veryhard", "adverb", "passive", "weakener", "simpler"];

export const TITLES: Record<Kind, string> = {
  hard: "Hard to read",
  veryhard: "Very hard to read",
  adverb: "Adverb",
  passive: "Passive voice",
  weakener: "Qualifier",
  simpler: "Simpler word",
};

export const HELP: Record<Kind, string> = {
  hard: "This sentence is long or dense. Shorten it, or split it in two.",
  veryhard: "Readers will get lost here. Split it into shorter sentences.",
  adverb: "Strong verbs beat adverbs. Pick a more precise verb, or cut the adverb.",
  passive: "Use the active voice. “The ball was thrown by Tom” becomes “Tom threw the ball.”",
  weakener: "Be bold. Don't hedge. “I think we should…” becomes “We should…”",
  simpler: "A plainer word reads faster. Click one to swap it in.",
};
