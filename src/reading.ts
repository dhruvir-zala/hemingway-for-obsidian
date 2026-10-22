import { Analysis, Kind, analyze } from "./analyzer";
import { TITLES } from "./info";
import type HemingwayPlugin from "./main";

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote > p";
const SKIP = "pre, code, .math, .frontmatter, .callout-title-inner, .internal-embed";
const CLASSES: Record<Kind, string> = {
  hard: "cm-hw-hard",
  veryhard: "cm-hw-veryhard",
  adverb: "cm-hw-adverb",
  passive: "cm-hw-passive",
  weakener: "cm-hw-weakener",
  simpler: "cm-hw-simpler",
};

interface Piece {
  node: Text;
  from: number;
}

/** Wraps issues in rendered (Reading view) blocks using the same classes as the editor. */
export function highlightRendered(root: HTMLElement, plugin: HemingwayPlugin) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter(
    (b) => !b.querySelector(BLOCKS) && !b.closest(SKIP)
  );
  for (const block of blocks) highlightBlock(block, plugin);
}

function highlightBlock(block: HTMLElement, plugin: HemingwayPlugin) {
  const pieces: Piece[] = [];
  let text = "";
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    pieces.push({ node: n as Text, from: text.length });
    text += (n as Text).data;
  }
  if (!text.trim()) return;

  const a: Analysis = analyze(text, plugin.analysisOptions());
  if (!a.issues.length) return;

  for (const { node, from } of pieces) {
    const to = from + node.data.length;
    const local = a.issues.filter((i) => i.start < to && i.end > from);
    if (!local.length) continue;
    const cuts = new Set<number>([0, node.data.length]);
    for (const i of local) {
      cuts.add(Math.max(0, i.start - from));
      cuts.add(Math.min(node.data.length, i.end - from));
    }
    const pts = [...cuts].sort((x, y) => x - y);
    const frag = createFragment();
    for (let p = 0; p < pts.length - 1; p++) {
      const s = pts[p];
      const e = pts[p + 1];
      const chunk = node.data.slice(s, e);
      const covering = local.filter((i) => i.start - from <= s && i.end - from >= e);
      if (!covering.length) {
        frag.append(chunk);
        continue;
      }
      const span = block.createSpan({
        cls: "cm-hw " + covering.map((i) => CLASSES[i.kind]).join(" "),
        text: chunk,
      });
      span.title = covering.map((i) => TITLES[i.kind]).join(" ");
      frag.append(span);
    }
    node.replaceWith(frag);
  }
}
