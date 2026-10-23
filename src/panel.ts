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

  private infoTip: HTMLElement | null = null;

  private closeInfoTip() {
    this.infoTip?.remove();
    this.infoTip = null;
  }

  async onClose() {
    this.closeInfoTip();
  }

  // The tip lives on <body> with fixed positioning so the narrow sidebar can't clip it.
  private renderInfoTip(parent: HTMLElement) {
    const btn = parent.createEl("button", {
      cls: "clickable-icon hw-info-btn",
      attr: { "aria-label": "What is readability?", "aria-expanded": "false", "aria-describedby": "hw-info-tip" },
    });
    setIcon(btn, "info");
    let pinned = false;
    const close = () => {
      pinned = false;
      btn.setAttr("aria-expanded", "false");
      this.closeInfoTip();
    };
    const open = () => {
      if (this.infoTip) return;
      const tip = document.body.createDiv({ cls: "hw-info-tip", attr: { id: "hw-info-tip", role: "tooltip" } });
      tip.createDiv({ cls: "hw-info-title", text: "What is readability?" });
      tip.createEl("p", {
        text:
          "Hemingway measures readability using grade levels. The lower the grade level, the more people who can understand your message. " +
          "Be careful not to confuse low grade levels with childish writing. The average reading level for adults is only grade 7 or 8. " +
          "Instead, lower grade levels show that complexity isn't getting in the way of your message. " +
          "Also, don't be afraid to leave some highlights for variety. Fix only as many as you need to tailor the text for your target audience.",
      });
      const r = btn.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 16);
      tip.style.width = w + "px";
      tip.style.top = r.bottom + 6 + "px";
      tip.style.left = Math.max(8, Math.min(r.right - w + 8, window.innerWidth - w - 8)) + "px";
      tip.addEventListener("mouseleave", () => !pinned && close());
      this.infoTip = tip;
      btn.setAttr("aria-expanded", "true");
    };
    btn.addEventListener("mouseenter", open);
    btn.addEventListener("mouseleave", (e) => {
      if (!pinned && !(e.relatedTarget instanceof Node && this.infoTip?.contains(e.relatedTarget))) close();
    });
    btn.addEventListener("focus", open);
    btn.addEventListener("blur", close);
    btn.addEventListener("click", () => {
      if (pinned) close();
      else {
        open();
        pinned = true;
      }
    });
    btn.addEventListener("keydown", (e) => e.key === "Escape" && close());
  }

  private renderGoals(root: HTMLElement, words: number, selection: boolean) {
    const s = this.plugin.settings;
    const bar = (label: string, value: number, goal: number) => {
      const box = root.createDiv({ cls: "hw-goal" });
      box.setAttr("role", "progressbar");
      box.setAttr("aria-label", label);
      box.setAttr("aria-valuemin", "0");
      box.setAttr("aria-valuemax", String(goal));
      box.setAttr("aria-valuenow", String(Math.min(value, goal)));
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
    }
  }

  render() {
    const root = this.contentEl;
    this.closeInfoTip();
    root.empty();
    const s = this.plugin.settings;
    const hidden = s.hidden;

    const tabs = root.createDiv({ cls: "hw-tabs", attr: { role: "tablist" } });
    (["write", "edit"] as const).forEach((m) => {
      const t = tabs.createEl("button", { cls: "hw-tab", text: m === "write" ? "Write" : "Edit", attr: { role: "tab", "aria-selected": String(s.mode === m) } });
      t.toggleClass("is-active", s.mode === m);
      t.addEventListener("click", () => void this.plugin.setMode(m));
    });

    const data = this.plugin.panelData();
    const a = data?.analysis;
    if (!a || a.words === 0) {
      root.createDiv({ cls: "hw-empty", text: "Open or write a note to see its readability." });
      return;
    }

    if (data.selection) root.createDiv({ cls: "hw-selection", text: "Selected text" });

    const target = s.gradeTarget;
    const label = a.grade <= target ? "Good" : a.grade <= target + 3 ? "OK" : "Poor";
    const box = root.createDiv({ cls: "hw-grade-box hw-grade-box-" + label.toLowerCase() });
    const head = box.createDiv({ cls: "hw-grade-label" });
    head.createSpan({ text: "Readability" });
    this.renderInfoTip(head);
    box.createDiv({ cls: "hw-grade hw-grade-" + label.toLowerCase(), text: `Grade ${a.grade}` });
    box.createDiv({
      cls: "hw-grade-hint",
      text: label === "Good" ? `Good. Within the grade ${target} target.` : `${label}. Aim for grade ${target} or lower.`,
    });

    const stats = root.createDiv({ cls: "hw-stats" });
    const row = (k: string, v: string) => {
      const r = stats.createDiv({ cls: "hw-stat" });
      r.createSpan({ cls: "hw-stat-v", text: v });
      r.createSpan({ cls: "hw-stat-k", text: k });
    };
    row("Words", a.words.toLocaleString());
    row("Sentences", a.sentences.toLocaleString());
    row("Paragraphs", a.paragraphs.toLocaleString());
    row("Reading time", formatTime(a.words, s.wpm));
    row("Letters", a.letters.toLocaleString());
    row("Characters", a.characters.toLocaleString());

    this.renderGoals(root, a.words, data.selection);

    if (s.mode === "write") {
      root.createDiv({ cls: "hw-cards-hint", text: "Highlights are hidden. Switch to Edit to see them." });
      return;
    }

    root.createDiv({ cls: "hw-section-title hw-issues-title", text: "Issues" });
    const cards = root.createDiv({ cls: "hw-cards" });
    const n = a.sentences;
    const c = a.counts;

    const eyeButton = (parent: HTMLElement, kinds: Kind[]) => {
      const off = kinds.every((k) => hidden.includes(k));
      const eye = parent.createEl("button", {
        cls: "clickable-icon hw-eye",
        attr: { "aria-label": off ? "Show highlights" : "Hide highlights", "aria-pressed": String(!off) },
      });
      setIcon(eye, off ? "eye-off" : "eye");
      eye.addEventListener("click", () => void this.plugin.toggleKinds(kinds));
    };

    const card = (kinds: Kind[], color: string, count: number, text: string) => {
      const el = cards.createDiv({ cls: `hw-card hw-card-${color}` });
      el.toggleClass("is-off", kinds.every((k) => hidden.includes(k)));
      el.toggleClass("is-zero", count === 0);
      el.createSpan({ cls: "hw-count hw-count-" + color, text: String(count) });
      el.createEl("p", { text: text.trim() });
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
      attr: { "aria-expanded": String(this.showDetails) },
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
