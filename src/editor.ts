import { StateEffect, StateField, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Analysis, Issue, Kind, analyze } from "./analyzer";
import { Notice, setIcon } from "obsidian";
import { wordDiff } from "./diff";
import { ProofreadModal } from "./proofreadModal";
import { Rewrite, simplify } from "./ai";
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

  const iconButton = (parent: HTMLElement, icon: string, label: string) => {
    // A hidden text label keeps the button accessible without Obsidian's hover tooltip that aria-label triggers.
    const b = parent.createEl("button", { cls: "clickable-icon hw-tip-icon" });
    setIcon(b, icon);
    b.createSpan({ cls: "hw-sr-only", text: label });
    return b;
  };

  const iconLabel = (b: HTMLElement, icon: string, text: string) => {
    b.empty();
    setIcon(b.createSpan({ cls: "hw-btn-icon" }), icon);
    b.createSpan({ text });
  };

  const MAX_OPTIONS = 4;
  const MAX_CHARS = 2000;

  // Shows a rewrite button that produces flip-through options for the range.
  const mountAi = (el: HTMLElement, actions: HTMLElement, view: EditorView, range: { from: number; to: number }, label: string, place: () => void) => {
    const original = view.state.doc.sliceString(range.from, range.to);
    const lead = original.length - original.trimStart().length;
    const trail = original.length - original.trimEnd().length;
    const sentence = original.trim();
    const context = view.state.doc.sliceString(Math.max(0, range.from - 300), range.from).trim();
    const box = el.createDiv({ cls: "hw-ai-box" });
    const results: Rewrite[] = [];
    let idx = 0;
    let busy = false;
    let showDiff = false;
    let error = "";
    let progressEl: HTMLElement | null = null;
    let progressText = "";
    el.insertBefore(box, actions);

    const addProofread = () => {
      const pf = actions.createEl("button", { cls: "hw-ghost" });
      iconLabel(pf, "check-check", "Proofread");
      pf.addEventListener("click", () => {
        closeTip();
        new ProofreadModal(plugin.app, plugin, view, range, false).open();
      });
    };

    const stale = () => view.state.doc.sliceString(range.from, range.to) !== original;

    const paint = () => {
      box.empty();
      actions.empty();
      progressEl = null;
      const r = results[idx];
      if (r) {
        if (results.length > 1) {
          const pager = box.createDiv({ cls: "hw-tip-pager hw-ai-pager" });
          iconButton(pager, "chevron-left", "Previous option").addEventListener("click", () => {
            idx = (idx + results.length - 1) % results.length;
            paint();
          });
          pager.createSpan({ cls: "hw-tip-count", text: `Option ${idx + 1} of ${results.length}` });
          iconButton(pager, "chevron-right", "Next option").addEventListener("click", () => {
            idx = (idx + 1) % results.length;
            paint();
          });
        }
        const out = box.createDiv({ cls: "hw-ai-result" });
        if (showDiff) {
          for (const part of wordDiff(sentence, r.text)) {
            if (part.type === "same") out.appendText(part.text);
            else out.createSpan({ cls: part.type === "ins" ? "hw-diff-ins" : "hw-diff-del", text: part.text });
          }
        } else out.setText(r.text);
        if (r.lostLinks.length) box.createDiv({ cls: "hw-tip-meta", text: `Heads up: the link text “${r.lostLinks.join("”, “")}” was reworded, so that link will be removed.` });
        const note = r.changed ? "" : " Same as before, try another.";
        box.createDiv({ cls: "hw-tip-meta", text: `Grade ${r.gradeBefore} → ${r.gradeAfter}.${r.improved || r.gradeBefore === r.gradeAfter ? "" : " Not simpler."}${note}` });
        actions.createEl("button", { cls: "mod-cta", text: "Apply" }).addEventListener("click", () => {
          closeTip();
          if (stale()) return;
          const insert = original.slice(0, lead) + r.text + original.slice(original.length - trail);
          view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + insert.length } });
          view.focus();
        });
        actions.createEl("button", { cls: "hw-ghost", text: showDiff ? "Hide changes" : "Show changes" }).addEventListener("click", () => {
          showDiff = !showDiff;
          paint();
        });
        const more = actions.createEl("button", { cls: "hw-ghost", text: busy ? "Thinking…" : "Another option" });
        more.disabled = busy || results.length >= MAX_OPTIONS;
        if (results.length >= MAX_OPTIONS) more.setText("Max options");
        more.addEventListener("click", () => void generate());
        addProofread();
      } else {
        const go = actions.createEl("button", { cls: "mod-cta", text: busy ? "Rewriting…" : label });
        go.disabled = busy;
        if (!busy) iconLabel(go, "sparkles", label);
        go.addEventListener("click", () => void generate());
        addProofread();
      }
      if (busy) {
        if (progressText) {
          progressEl = box.createDiv({ cls: "hw-ai-result", attr: { "aria-live": "polite" } });
          progressEl.setText(progressText);
        }
      }
      if (error) box.createDiv({ cls: "hw-tip-meta", text: error });
      place();
    };

    const generate = async () => {
      if (sentence.length > MAX_CHARS) {
        error = `Select less text (under ${MAX_CHARS} characters).`;
        return paint();
      }
      busy = true;
      error = "";
      progressText = "";
      paint();
      try {
        const out = await simplify(
          plugin.aiConfig(),
          sentence,
          plugin.settings.gradeTarget,
          context,
          results.map((x) => x.text),
          (text) => {
            if (tip !== el) return;
            progressText = text || progressText;
            if (progressText) {
              if (!progressEl) {
                progressEl = box.createDiv({ cls: "hw-ai-result", attr: { "aria-live": "polite" } });
              }
              progressEl.setText(progressText);
              place();
            }
          }
        );
        if (tip === el) {
          if (!out.changed) error = "The model had no new version. Try again.";
          else {
            results.push(out);
            idx = results.length - 1;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "Rewrite failed.";
      } finally {
        busy = false;
      }
      if (tip !== el) return;
      if (stale()) return closeTip();
      paint();
    };
    paint();
  };

  const sentenceAround = (doc: string, from: number, to: number) => {
    const end = (i: number) => /[.!?]/.test(doc[i]) && (i + 1 >= doc.length || /\s/.test(doc[i + 1]));
    let s = from;
    while (s > 0 && doc[s - 1] !== "\n" && !(end(s - 1) && /\s/.test(doc[s] ?? ""))) s--;
    while (s < from && /[ \t]/.test(doc[s])) s++;
    let e = to;
    while (e < doc.length && doc[e] !== "\n" && !end(e)) e++;
    if (e < doc.length && doc[e] !== "\n") e++;
    return { from: s, to: e };
  };

  // Card for rewriting whatever text is selected.
  const showSelectionTip = (view: EditorView) => {
    const sel = view.state.selection.main;
    if (sel.empty) return void new Notice("Select some text to rewrite first.");
    if (!plugin.settings.aiEnabled) return void new Notice("Turn on AI rewrite in Hemingway's settings first.");
    closeTip();
    const coords = view.coordsAtPos(sel.head);
    if (!coords) return;
    const el = document.body.createDiv({ cls: "hw-tip hw-tip-selection", attr: { role: "dialog" } });
    tip = el;
    el.createDiv({ cls: "hw-tip-arrow" });
    const head = el.createDiv({ cls: "hw-tip-head" });
    head.createSpan({ cls: "hw-tip-dot" });
    head.createDiv({ cls: "hw-tip-title", text: "Rewrite selection", attr: { id: "hw-tip-title" } });
    el.setAttr("aria-labelledby", "hw-tip-title");
    const close = iconButton(head, "x", "Close");
    close.addEventListener("click", () => {
      closeTip();
      view.focus();
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      closeTip();
      view.focus();
    });
    el.createDiv({ cls: "hw-tip-sub", text: "Rewrites the selected text in a clearer, more direct style." });
    const actions = el.createDiv({ cls: "hw-tip-actions" });
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 12;
      const left = Math.max(8, Math.min(coords.left - 24, window.innerWidth - w - 8));
      const below = coords.bottom + gap + h < window.innerHeight || coords.top - gap - h < 8;
      el.toggleClass("is-above", !below);
      el.style.left = left + "px";
      el.style.top = (below ? coords.bottom + gap : coords.top - gap - h) + "px";
      el.style.setProperty("--hw-arrow-x", Math.max(14, Math.min(coords.left - left, w - 14)) + "px");
    };
    mountAi(el, actions, view, { from: sel.from, to: sel.to }, "Rewrite with AI", place);
    place();
    onDocDown = (e) => {
      if (tip && !tip.contains(e.target as Node)) closeTip();
    };
    onScroll = () => closeTip();
    document.addEventListener("mousedown", onDocDown, true);
    window.addEventListener("scroll", onScroll, true);
  };
  plugin.rewriteSelection = showSelectionTip;

  const showTip = (view: EditorView, hits: Issue[], pos: number) => {
    closeTip();
    const coords = view.coordsAtPos(pos);
    if (!coords) return;
    const el = document.body.createDiv({ cls: "hw-tip", attr: { role: "dialog" } });
    tip = el;
    const text = view.state.doc.toString();
    let index = 0;
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      closeTip();
      view.focus();
    });

    const render = () => {
      el.empty();
      const issue = hits[index];
      el.className = "hw-tip hw-tip-" + issue.kind;
      el.createDiv({ cls: "hw-tip-arrow" });

      const head = el.createDiv({ cls: "hw-tip-head" });
      head.createSpan({ cls: "hw-tip-dot" });
      head.createDiv({ cls: "hw-tip-title", text: TITLES[issue.kind], attr: { id: "hw-tip-title" } });
      el.setAttr("aria-labelledby", "hw-tip-title");
      if (hits.length > 1) {
        const pager = head.createDiv({ cls: "hw-tip-pager" });
        const step = (d: number) => {
          index = (index + hits.length + d) % hits.length;
          render();
          place();
        };
        iconButton(pager, "chevron-left", "Previous issue").addEventListener("click", () => step(-1));
        pager.createSpan({ cls: "hw-tip-count", text: `${index + 1} of ${hits.length}` });
        iconButton(pager, "chevron-right", "Next issue").addEventListener("click", () => step(1));
      }
      const close = iconButton(head, "x", "Close");
      close.addEventListener("click", () => {
        closeTip();
        view.focus();
      });

      const phrase = text.slice(issue.start, issue.end);
      const hard = issue.kind === "hard" || issue.kind === "veryhard";
      el.createDiv({ cls: "hw-tip-sub", text: HELP[issue.kind] });
      if (hard) {
        const meta = el.createDiv({ cls: "hw-tip-meta" });
        meta.createSpan({ cls: "hw-chip", text: `${issue.words} words` });
        meta.createSpan({ cls: "hw-chip", text: `Grade ${issue.grade}` });
      }
      else el.createDiv({ cls: "hw-tip-quote", text: phrase });

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
      if ((hard || issue.kind === "passive") && plugin.settings.aiEnabled) {
        const range = hard ? { from: issue.start, to: issue.end } : sentenceAround(text, issue.start, issue.end);
        mountAi(el, actions, view, range, hard ? "Rewrite with AI" : "Rewrite sentence", place);
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
