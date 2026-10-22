import { analyze } from "../src/analyzer";

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const hits = (t: string, kind: string) =>
  analyze(t).issues.filter((i) => i.kind === kind).map((i) => t.slice(i.start, i.end));

eq("adverb", hits("He walked slowly home.", "adverb"), ["slowly"]);
eq("not adverb", hits("The family is only here.", "adverb"), []);
eq("passive", hits("The ball was thrown by Tom.", "passive"), ["was thrown"]);
eq("passive w/ adverb", hits("It was quickly eaten.", "passive"), ["was quickly eaten"]);
eq("not passive", hits("The sky is red.", "passive"), []);
eq("simpler", hits("We utilize tools in order to win.", "simpler"), ["utilize", "in order to"]);
eq("weakener", hits("I believe it is quite good.", "weakener"), ["I believe"]);
eq("markdown ignored", analyze("# Title\n\n- item **bold** [link](http://x.com/ly)\n\n```\nwas done slowly\n```\n").counts.adverb, 0);
eq("words", analyze("One two three. Four five.").words, 5);
eq("sentences", analyze("Dr. Smith paid 3.5 dollars. Fine.").sentences, 2);
const long =
  "The implementation of the aforementioned methodology necessitates considerable organizational coordination across multiple departments simultaneously.";
eq("very hard", analyze(long).counts.veryhard + analyze(long).counts.hard, 1);
eq("short is fine", analyze("Short and sweet.").counts.hard, 0);
eq("front matter no hang", analyze("---\ntitle: x\n---\nHe ran quickly.\n").counts.adverb, 1);
const sample = "I use Hemingway Editor every day. So I thought: what if I could build it directly inside Obsidian? The screenshot shows how it currently looks. It works just like the original.";
eq("no over-flagging", analyze(sample).counts.adverb + analyze(sample).counts.simpler, 0);
eq("just is weakener", hits(sample, "weakener"), ["just"]);
eq("ignore option", analyze("It is just fine.", { ignore: ["just"] }).counts.weakener, 0);
eq("extra weakener", analyze("Honestly it works.", { extraWeakeners: ["honestly"] }).counts.weakener, 1);
eq("adjectival not passive", hits("She was tired and excited.", "passive"), []);
eq("filler passive", hits("It was not yet done.", "passive"), ["was not yet done"]);
eq("modal passive", hits("It can be seen from here.", "passive"), ["be seen"]);
eq("name not adverb", hits("I met Emily in Italy.", "adverb"), []);
eq("weekly not adverb", hits("The weekly meeting ended.", "adverb"), []);
process.exit(fail ? 1 : 0);
