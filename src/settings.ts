import { App, PluginSettingTab, Setting } from "obsidian";
import type { Kind } from "./analyzer";
import type HemingwayPlugin from "./main";

const KIND_LABELS: Array<[Kind, string, string]> = [
  ["veryhard", "Very hard sentences", "Red highlights."],
  ["hard", "Hard sentences", "Yellow highlights."],
  ["adverb", "Adverbs", "Blue highlights."],
  ["passive", "Passive voice", "Blue highlights."],
  ["weakener", "Weakening phrases", "Blue highlights."],
  ["simpler", "Simpler alternatives", "Purple highlights."],
];

const lines = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

export class HemingwaySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HemingwayPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl: el } = this;
    const s = this.plugin.settings;
    el.empty();

    el.createDiv({
      cls: "hw-disclaimer",
      text: "Unofficial community plugin. Not affiliated with, endorsed by or connected to Hemingway Editor, the Hemingway App or Boondoggle Studio, LLC (hemingwayapp.com).",
    });

    new Setting(el)
      .setName("Show highlights")
      .setDesc("Same as the Write / Edit tabs. Off hides all highlights.")
      .addToggle((t) => t.setValue(s.mode === "edit").onChange((v) => void this.plugin.setMode(v ? "edit" : "write")));

    new Setting(el).setName("Highlight types").setHeading();
    for (const [kind, name, desc] of KIND_LABELS) {
      new Setting(el)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(!s.hidden.includes(kind)).onChange((v) => {
            s.hidden = s.hidden.filter((k) => k !== kind);
            if (!v) s.hidden.push(kind);
            void this.plugin.persist();
          })
        );
    }

    new Setting(el).setName("Readability").setHeading();
    new Setting(el)
      .setName("Target grade level")
      .setDesc("Grades at or below this show as Good. Hemingway uses 9.")
      .addSlider((sl) =>
        sl.setLimits(4, 16, 1).setValue(s.gradeTarget).onChange((v) => {
          s.gradeTarget = v;
          void this.plugin.persist();
        })
      );
    new Setting(el)
      .setName("Reading speed")
      .setDesc("Words per minute, used for reading time.")
      .addText((t) =>
        t.setValue(String(s.wpm)).onChange((v) => {
          const n = parseInt(v, 10);
          if (n >= 50 && n <= 1000) {
            s.wpm = n;
            void this.plugin.persist();
          }
        })
      );

    new Setting(el).setName("Goals").setHeading();
    const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);
    new Setting(el)
      .setName("Word goal per note")
      .setDesc("Shows progress in the panel and status bar. 0 turns it off.")
      .addText((t) =>
        t.setValue(String(s.wordGoal)).onChange((v) => {
          s.wordGoal = num(v);
          void this.plugin.persist();
        })
      );
    new Setting(el)
      .setName("Daily word goal")
      .setDesc("Counts new words across all notes and tracks your streak. 0 turns it off.")
      .addText((t) =>
        t.setValue(String(s.dailyGoal)).onChange((v) => {
          s.dailyGoal = num(v);
          void this.plugin.persist();
        })
      );

    new Setting(el).setName("Focus").setHeading();
    new Setting(el)
      .setName("Focus mode")
      .setDesc("Hides sidebars, tabs and the status bar. Also available as a command.")
      .addButton((b) => b.setButtonText("Toggle").onClick(() => this.plugin.toggleFocus()));

    new Setting(el).setName("Word lists").setHeading();
    new Setting(el)
      .setName("Extra weakening phrases")
      .setDesc("One per line. Highlighted in blue.")
      .addTextArea((t) =>
        t.setValue(s.extraWeakeners.join("\n")).onChange((v) => {
          s.extraWeakeners = lines(v);
          void this.plugin.persist().then(() => this.plugin.reanalyze());
        })
      );
    new Setting(el)
      .setName("Ignored words")
      .setDesc("One per line. Never highlighted, e.g. words you use on purpose.")
      .addTextArea((t) =>
        t.setValue(s.ignore.join("\n")).onChange((v) => {
          s.ignore = lines(v);
          void this.plugin.persist().then(() => this.plugin.reanalyze());
        })
      );
  }
}
