import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
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

interface SettingRow {
  name: string;
  desc: string;
  render: (setting: Setting) => void;
}

interface SettingSection {
  heading?: string;
  rows: SettingRow[];
}

export class HemingwaySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HemingwayPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.settingSections().flatMap(({ rows }) =>
      rows.map(({ name, desc, render }) => ({
        name,
        desc,
        render: (setting: Setting) => {
          setting.setName(name).setDesc(desc);
          render(setting);
        },
      }))
    );
  }

  display() {
    const { containerEl: el } = this;
    el.empty();

    el.createDiv({
      cls: "hw-disclaimer",
      text: "Unofficial community plugin. Not affiliated with, endorsed by or connected to Hemingway Editor, the Hemingway App or Boondoggle Studio, LLC (hemingwayapp.com).",
    });

    for (const section of this.settingSections()) {
      if (section.heading) new Setting(el).setName(section.heading).setHeading();
      for (const row of section.rows) row.render(new Setting(el).setName(row.name).setDesc(row.desc));
    }
  }

  private settingSections(): SettingSection[] {
    const row = (name: string, desc: string, render: (setting: Setting) => void): SettingRow => ({
      name,
      desc,
      render,
    });
    const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

    return [
      {
        rows: [
          row("Show highlights", "Same as the Write / Edit tabs. Off hides all highlights.", (setting) =>
            setting.addToggle((toggle) =>
              toggle
                .setValue(this.plugin.settings.mode === "edit")
                .onChange((value) => void this.plugin.setMode(value ? "edit" : "write"))
            )
          ),
        ],
      },
      {
        heading: "Highlight types",
        rows: KIND_LABELS.map(([kind, name, desc]) =>
          row(name, desc, (setting) =>
            setting.addToggle((toggle) =>
              toggle.setValue(!this.plugin.settings.hidden.includes(kind)).onChange((value) => {
                const { settings } = this.plugin;
                settings.hidden = settings.hidden.filter((hiddenKind) => hiddenKind !== kind);
                if (!value) settings.hidden.push(kind);
                void this.plugin.persist();
              })
            )
          )
        ),
      },
      {
        heading: "Readability",
        rows: [
          row("Target grade level", "Grades at or below this show as Good. Hemingway uses 9.", (setting) =>
            setting.addSlider((slider) =>
              slider.setLimits(4, 16, 1).setValue(this.plugin.settings.gradeTarget).onChange((value) => {
                this.plugin.settings.gradeTarget = value;
                void this.plugin.persist();
              })
            )
          ),
          row("Reading speed", "Words per minute, used for reading time.", (setting) =>
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.wpm)).onChange((value) => {
                const wpm = parseInt(value, 10);
                if (wpm >= 50 && wpm <= 1000) {
                  this.plugin.settings.wpm = wpm;
                  void this.plugin.persist();
                }
              })
            )
          ),
        ],
      },
      {
        heading: "Goals",
        rows: [
          row("Word goal per note", "Shows progress in the panel and status bar. 0 turns it off.", (setting) =>
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.wordGoal)).onChange((value) => {
                this.plugin.settings.wordGoal = num(value);
                void this.plugin.persist();
              })
            )
          ),
          row("Daily word goal", "Counts new words across all notes and tracks your streak. 0 turns it off.", (setting) =>
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.dailyGoal)).onChange((value) => {
                this.plugin.settings.dailyGoal = num(value);
                void this.plugin.persist();
              })
            )
          ),
        ],
      },
      {
        heading: "Focus",
        rows: [
          row("Focus mode", "Hides sidebars, tabs and the status bar. Also available as a command.", (setting) =>
            setting.addButton((button) => button.setButtonText("Toggle").onClick(() => this.plugin.toggleFocus()))
          ),
        ],
      },
      {
        heading: "Word lists",
        rows: [
          row("Extra weakening phrases", "One per line. Highlighted in blue.", (setting) =>
            setting.addTextArea((text) =>
              text.setValue(this.plugin.settings.extraWeakeners.join("\n")).onChange((value) => {
                this.plugin.settings.extraWeakeners = lines(value);
                void this.plugin.persist().then(() => this.plugin.reanalyze());
              })
            )
          ),
          row("Ignored words", "One per line. Never highlighted, e.g. words you use on purpose.", (setting) =>
            setting.addTextArea((text) =>
              text.setValue(this.plugin.settings.ignore.join("\n")).onChange((value) => {
                this.plugin.settings.ignore = lines(value);
                void this.plugin.persist().then(() => this.plugin.reanalyze());
              })
            )
          ),
        ],
      },
    ];
  }
}
