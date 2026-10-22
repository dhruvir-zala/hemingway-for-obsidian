import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { Kind } from "./analyzer";
import type HemingwayPlugin from "./main";

export const VIEW_TYPE = "hemingway-panel";

function formatTime(words: number, wpm: number): string {
  const total = Math.floor((words / Math.max(1, wpm)) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export class HemingwayPanel extends ItemView {
  private showDetails = false;

  constructor(leaf: WorkspaceLeaf, private plugin: HemingwayPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Hemingway";
  }
  getIcon() {
    return "feather";
  }

  async onOpen() {
    this.contentEl.addClass("hw-panel");
    this.render();
  }

  private renderGoals(root: HTMLElement, words: number, selection: boolean) {
    const s = this.plugin.settings;
    const bar = (label: string, value: number, goal: number) => {
      const box = root.createDiv({ cls: "hw-goal" });
      const top = box.createDiv({ cls: "hw-goal-top" });
      top.createSpan({ text: label });
      top.createSpan({ cls: "hw-goal-n", text: `${value.toLocaleString()} / ${goal.toLocaleString()}` });
      const track = box.createDiv({ cls: "hw-goal-track" });
      const fill = track.createDiv({ cls: "hw-goal-fill" });
      fill.style.width = Math.min(100, (value / goal) * 100) + "%";
      fill.toggleClass("is-done", value >= goal);
    };
    if (s.wordGoal > 0 && !selection) bar("Note goal", words, s.wordGoal);
    if (s.dailyGoal > 0) {
      bar("Written today", this.plugin.todayWords(), s.dailyGoal);
      const n = this.plugin.streak();
      if (n > 0) root.createDiv({ cls: "hw-streak", text: `🔥 ${n}-day streak` });
    } else if (this.plugin.todayWords() > 0) {
      const r = root.createDiv({ cls: "hw-stat hw-today" });
      r.createSpan({ cls: "hw-stat-k", text: "Written today" });
      r.createSpan({ cls: "hw-stat-v", text: this.plugin.todayWords().toLocaleString() });
    }
  }

  render() {
    const root = this.contentEl;
    root.empty();
    const data = this.plugin.panelData();
    const s = this.plugin.settings;
    const hidden = s.hidden;

    const tabs = root.createDiv({ cls: "hw-tabs" });
    (["write", "edit"] as const).forEach((m) => {
      const t = tabs.createEl("button", { cls: "hw-tab", text: m === "write" ? "Write" : "Edit" });
      t.toggleClass("is-active", s.mode === m);
      t.addEventListener("click", () => void this.plugin.setMode(m));
    });

    const a = data?.analysis;
    if (!a || a.words === 0) {
      root.createDiv({ cls: "hw-empty", text: "Open or write a note to see its readability." });
      return;
    }

    if (data.selection) root.createDiv({ cls: "hw-selection", text: "Selected text" });

    const target = s.gradeTarget;
    const label = a.grade <= target ? "Good" : a.grade <= target + 3 ? "OK" : "Poor";
    const box = root.createDiv({ cls: "hw-grade-box" });
    box.createDiv({ cls: "hw-grade hw-grade-" + label.toLowerCase(), text: `Grade ${a.grade}` });
    box.createDiv({
      cls: "hw-grade-hint",
      text: label === "Good" ? "Good." : `${label}. Aim for grade ${target} or lower.`,
    });

    const stats = root.createDiv({ cls: "hw-stats" });
    const row = (k: string, v: string) => {
      const r = stats.createDiv({ cls: "hw-stat" });
      r.createSpan({ cls: "hw-stat-k", text: k });
      r.createSpan({ cls: "hw-stat-v", text: v });
    };
    row("Letters", String(a.letters));
    row("Characters", String(a.characters));
    row("Words", String(a.words));
    row("Sentences", String(a.sentences));
    row("Paragraphs", String(a.paragraphs));
    row("Reading time", formatTime(a.words, s.wpm));

    this.renderGoals(root, a.words, data.selection);

    if (s.mode === "write") {
      root.createDiv({ cls: "hw-cards-hint", text: "Highlights are hidden. Switch to Edit to see them." });
      return;
    }

    const cards = root.createDiv({ cls: "hw-cards" });
    const n = a.sentences;
    const c = a.counts;

    const eyeButton = (parent: HTMLElement, kinds: Kind[]) => {
      const off = kinds.every((k) => hidden.includes(k));
      const eye = parent.createEl("button", { cls: "hw-eye", attr: { "aria-label": "Show or hide highlights" } });
      setIcon(eye, off ? "eye-off" : "eye");
      eye.addEventListener("click", () => void this.plugin.toggleKinds(kinds));
    };

    const card = (kinds: Kind[], color: string, count: number, text: string) => {
      const el = cards.createDiv({ cls: `hw-card hw-card-${color}` });
      el.toggleClass("is-off", kinds.every((k) => hidden.includes(k)));
      el.toggleClass("is-zero", count === 0);
      const p = el.createEl("p");
      p.createSpan({ cls: "hw-count hw-count-" + color, text: String(count) });
      p.appendText(text);
      eyeButton(el, kinds);
      return el;
    };

    card(["veryhard"], "red", c.veryhard, ` of ${n} ${n === 1 ? "sentence is" : "sentences are"} very hard to read.`);
    card(["hard"], "yellow", c.hard, ` of ${n} ${n === 1 ? "sentence is" : "sentences are"} hard to read.`);

    const weak = c.adverb + c.passive + c.weakener;
    const wk = card(["adverb", "passive", "weakener"], "blue", weak, weak === 1 ? " weakener." : " weakeners.");
    const hiddenCount = (["adverb", "passive", "weakener"] as Kind[]).filter((k) => hidden.includes(k)).length;
    const btn = wk.createEl("button", {
      cls: "hw-details-btn",
      text: this.showDetails ? "Hide details" : `View details${hiddenCount ? ` (${hiddenCount} hidden)` : ""}`,
    });
    btn.addEventListener("click", () => {
      this.showDetails = !this.showDetails;
      this.render();
    });
    if (this.showDetails) {
      const d = wk.createDiv({ cls: "hw-details" });
      const goal = (k: number, what: string) => (k > 0 ? `Aim for ${k} or less.` : `Better to use no ${what}.`);
      const detail = (kind: Kind, text: string) => {
        const r = d.createDiv({ cls: "hw-detail-row" });
        r.toggleClass("is-off", hidden.includes(kind));
        r.createEl("p", { text });
        eyeButton(r, [kind]);
      };
      detail("adverb", `${c.adverb} ${c.adverb === 1 ? "adverb" : "adverbs"}. ${goal(Math.floor(a.words / 100), "adverbs")}`);
      detail("passive", `${c.passive} ${c.passive === 1 ? "use" : "uses"} of passive voice. ${goal(Math.floor(a.sentences / 10), "passive voice")}`);
      detail("weakener", `${c.weakener} weakening ${c.weakener === 1 ? "phrase" : "phrases"}.`);
    }

    card(["simpler"], "purple", c.simpler, ` ${c.simpler === 1 ? "word or phrase has" : "words or phrases have"} a simpler alternative.`);
  }
}
