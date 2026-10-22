import { StateEffect, StateField, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Analysis, Issue, Kind, analyze } from "./analyzer";
import { setIcon } from "obsidian";
import { HELP, TITLES } from "./info";
import type HemingwayPlugin from "./main";

export interface Field {
  analysis: Analysis;
  decos: DecorationSet;
}

const marks: Record<Kind, Decoration> = {
  hard: Decoration.mark({ class: "cm-hw cm-hw-hard" }),
  veryhard: Decoration.mark({ class: "cm-hw cm-hw-veryhard" }),
  adverb: Decoration.mark({ class: "cm-hw cm-hw-adverb" }),
  passive: Decoration.mark({ class: "cm-hw cm-hw-passive" }),
  weakener: Decoration.mark({ class: "cm-hw cm-hw-weakener" }),
  simpler: Decoration.mark({ class: "cm-hw cm-hw-simpler" }),
};

export const rebuildEffect = StateEffect.define<null>();

function build(text: string, plugin: HemingwayPlugin): Field {
  const analysis = analyze(text, plugin.analysisOptions());
  const ranges: Range<Decoration>[] = analysis.issues
    .filter((i) => i.end > i.start)
    .map((i) => marks[i.kind].range(i.start, i.end));
  return { analysis, decos: Decoration.set(ranges, true) };
}

export function createField(plugin: HemingwayPlugin) {
  return StateField.define<Field>({
    create: (state) => build(state.doc.toString(), plugin),
    update: (value, tr) =>
      tr.docChanged || tr.effects.some((e) => e.is(rebuildEffect)) ? build(tr.state.doc.toString(), plugin) : value,
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });
}

export function hemingwayExtension(plugin: HemingwayPlugin, field: StateField<Field>) {
  let tip: HTMLElement | null = null;
  let onDocDown: ((e: MouseEvent) => void) | null = null;
  let onScroll: (() => void) | null = null;
  const closeTip = () => {
    tip?.remove();
    tip = null;
    if (onDocDown) document.removeEventListener("mousedown", onDocDown, true);
    if (onScroll) window.removeEventListener("scroll", onScroll, true);
    onDocDown = onScroll = null;
  };

  // Removes a word and tidies the spacing; recapitalises if it opened a sentence.
  const removeWord = (view: EditorView, issue: Issue) => {
    const doc = view.state.doc.toString();
    let from = issue.start;
    let to = issue.end;
    const before = doc.slice(0, from).replace(/[ \t]+$/, "");
    const atStart = before === "" || /[.!?:\n]$/.test(before) || /\n$/.test(doc.slice(0, from));
    const lead = doc.slice(0, from).length - before.length;
    const changes: { from: number; to: number; insert: string }[] = [];
    if (atStart) {
      while (doc[to] === " " || doc[to] === "\t") to++;
      changes.push({ from, to, insert: "" });
      const next = doc[to];
      if (next && next !== next.toUpperCase()) changes.push({ from: to, to: to + 1, insert: next.toUpperCase() });
    } else {
      from -= lead;
      if (/^[,.;:!?)]/.test(doc.slice(to))) changes.push({ from, to, insert: "" });
      else changes.push({ from, to, insert: lead ? " " : "" });
    }
    view.dispatch({ changes, selection: { anchor: Math.max(0, changes[0].from) } });
    view.focus();
  };

  const showTip = (view: EditorView, hits: Issue[], pos: number) => {
    closeTip();
    const coords = view.coordsAtPos(pos);
    if (!coords) return;
    const el = document.body.createDiv({ cls: "hw-tip", attr: { role: "dialog" } });
    tip = el;
    const text = view.state.doc.toString();
    let index = 0;

    const render = () => {
      el.empty();
      const issue = hits[index];
      el.className = "hw-tip hw-tip-" + issue.kind;
      el.createDiv({ cls: "hw-tip-arrow" });

      const head = el.createDiv({ cls: "hw-tip-head" });
      head.createDiv({ cls: "hw-tip-title", text: TITLES[issue.kind] });
      if (hits.length > 1) {
        const pager = head.createDiv({ cls: "hw-tip-pager" });
        const step = (d: number) => {
          index = (index + hits.length + d) % hits.length;
          render();
          place();
        };
        pager.createEl("button", { text: "‹", attr: { "aria-label": "Previous issue" } }).addEventListener("click", () => step(-1));
        pager.createSpan({ text: `${index + 1}/${hits.length}` });
        pager.createEl("button", { text: "›", attr: { "aria-label": "Next issue" } }).addEventListener("click", () => step(1));
      }
      const close = head.createEl("button", { cls: "hw-tip-close", attr: { "aria-label": "Close" } });
      setIcon(close, "x");
      close.addEventListener("click", () => {
        closeTip();
        view.focus();
      });

      const phrase = text.slice(issue.start, issue.end);
      const hard = issue.kind === "hard" || issue.kind === "veryhard";
      el.createDiv({ cls: "hw-tip-sub", text: HELP[issue.kind] });
      if (hard) el.createDiv({ cls: "hw-tip-meta", text: `${issue.words} words · grade ${issue.grade}` });
      else if (issue.kind === "passive") el.createDiv({ cls: "hw-tip-meta", text: `“${phrase}”` });

      const actions = el.createDiv({ cls: "hw-tip-actions" });
      const done = () => closeTip();
      if (issue.kind === "simpler") {
        for (const s of issue.suggestions ?? []) {
          actions.createEl("button", { cls: "mod-cta", text: s }).addEventListener("click", () => {
            done();
            view.dispatch({ changes: { from: issue.start, to: issue.end, insert: s }, selection: { anchor: issue.start + s.length } });
            view.focus();
          });
        }
      }
      if (issue.kind === "adverb" || issue.kind === "weakener") {
        actions.createEl("button", { cls: "mod-cta", text: "Remove" }).addEventListener("click", () => {
          done();
          removeWord(view, issue);
        });
      }
      if (!hard) {
        actions.createEl("button", { cls: "hw-ghost", text: "Ignore" }).addEventListener("click", () => {
          done();
          void plugin.ignoreWord(phrase);
        });
      }
      if (!actions.childElementCount) actions.remove();
    };

    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 12;
      let left = coords.left - 24;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = coords.bottom + gap + h < window.innerHeight || coords.top - gap - h < 8;
      el.toggleClass("is-above", !below);
      el.style.left = left + "px";
      el.style.top = (below ? coords.bottom + gap : coords.top - gap - h) + "px";
      el.style.setProperty("--hw-arrow-x", Math.max(14, Math.min(coords.left - left, w - 14)) + "px");
    };

    render();
    place();
    onDocDown = (e) => {
      if (tip && !tip.contains(e.target as Node)) closeTip();
    };
    onScroll = () => closeTip();
    document.addEventListener("mousedown", onDocDown, true);
    window.addEventListener("scroll", onScroll, true);
  };

  const watcher = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        plugin.notify(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) {
          if (u.docChanged) closeTip();
          plugin.notify(u.view);
        }
      }
      destroy() {
        closeTip();
      }
    }
  );

  const events = EditorView.domEventHandlers({
    mouseup(_e, view) {
      if (!plugin.highlightsOn()) return false;
      // Let the selection settle first.
      window.setTimeout(() => {
        const sel = view.state.selection.main;
        if (!sel.empty) return closeTip();
        const hits = view.state
          .field(field)
          .analysis.issues.filter((i) => sel.head >= i.start && sel.head <= i.end && !plugin.isKindHidden(i.kind));
        if (!hits.length) return closeTip();
        hits.sort((a, b) => a.end - a.start - (b.end - b.start));
        showTip(view, hits, sel.head);
      }, 0);
      return false;
    },
    keydown(e) {
      if (e.key === "Escape") closeTip();
      return false;
    },
  });

  return [field, watcher, events];
}
