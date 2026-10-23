import { App, ButtonComponent, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { STYLES } from "./ai";
import { BUILTIN, deleteModel, getEngine, gpuSupport, isInstalled } from "./webllm";
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

// Setting has a then() method, so a render callback that returns it reads as a Promise to linters.
type RenderSetting = (setting: Setting) => unknown;

interface SettingRow {
  name: string;
  desc: string;
  render: RenderSetting;
}

class ConfirmModal extends Modal {
  private answered = false;

  constructor(app: App, private message: string, private confirmText: string, private done: (ok: boolean) => void) {
    super(app);
  }

  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((b) => markDestructive(b.setButtonText(this.confirmText)).onClick(() => this.finish(true)));
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.done(false);
    this.answered = true;
  }

  private finish(ok: boolean) {
    if (this.answered) return;
    this.answered = true;
    this.done(ok);
    this.close();
  }
}

const confirmAction = (app: App, message: string, confirmText: string) =>
  new Promise<boolean>((resolve) => new ConfirmModal(app, message, confirmText, resolve).open());

// setDestructive needs a recent Obsidian; older versions get the same red style by class.
function markDestructive(button: ButtonComponent): ButtonComponent {
  if (typeof button.setDestructive === "function") return button.setDestructive();
  button.buttonEl.addClass("mod-warning");
  return button;
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

  // Obsidian before 1.13 only knows display(); newer versions use getSettingDefinitions() instead.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
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

  private refreshAi?: () => void;

  hide() {
    this.onClose?.();
    this.onClose = undefined;
    this.refreshAi = undefined;
  }

  private renderBuiltinSetup(setting: Setting) {
    let alive = true;
    const prevHide = this.refreshAi;
    const key = () => this.plugin.settings.aiBuiltinModel;
    const label = () => BUILTIN[key()]?.label.split(" · ")[0] ?? key();
    const render = (state: "checking" | "unsupported" | "missing" | "ready" | "loading", detail = "") => {
      if (!alive) return;
      setting.controlEl.empty();
      const msg = {
        checking: "Checking…",
        unsupported: "This computer's graphics (WebGPU) isn't available. Built-in AI requires WebGPU.",
        missing: `${label()} isn't downloaded yet.`,
        ready: `✓ Ready. ${label()} is installed and works offline.`,
        loading: detail || "Starting download…",
      }[state];
      setting.setName("AI setup").setDesc(msg);
      if (state === "missing") setting.addButton((b) => b.setButtonText("Download & enable").setCta().onClick(() => void install()));
      if (state === "ready") {
        setting.addButton((b) => b.setButtonText("Check again").onClick(() => void check()));
        setting.addButton((b) => markDestructive(b.setButtonText("Delete model")).onClick(() => void remove()));
      }
    };
    const remove = async () => {
      const ok = await confirmAction(
        this.app,
        `Delete ${label()} and free its disk space? AI rewrite will turn off. You can download it again any time.`,
        "Delete model"
      );
      if (!ok) return;
      render("checking");
      try {
        await deleteModel(key());
        this.plugin.settings.aiEnabled = false;
        void this.plugin.persist();
        new Notice(`${label()} deleted. AI rewrite is off.`);
        this.display();
      } catch (e) {
        await check();
        setting.setDesc(`Couldn't delete: ${e instanceof Error ? e.message : "unknown error"}.`);
      }
    };
    const check = async () => {
      render("checking");
      if ((await gpuSupport()) === "none") return render("unsupported");
      render((await isInstalled(key())) ? "ready" : "missing");
    };
    const install = async () => {
      render("loading");
      try {
        await getEngine(key(), (f, text) => {
          const pct = Math.round(f * 100);
          render("loading", `${/fetch|download/i.test(text) ? "Downloading" : "Preparing"} ${label()}… ${pct}%`);
        });
        this.plugin.settings.aiEnabled = true;
        void this.plugin.persist();
        new Notice("AI rewrite is ready and switched on.");
        render("ready");
      } catch (e) {
        render("missing");
        setting.setDesc(`Download failed: ${e instanceof Error ? e.message : "unknown error"}. Check your connection and try again.`);
      }
    };
    this.refreshAi = () => {
      prevHide?.();
      void check();
    };
    this.refreshAi = () => void check();
    this.onClose = () => {
      alive = false;
    };
    void check();
  }

  private onClose?: () => void;

  private settingSections(): SettingSection[] {
    const row = (name: string, desc: string, render: RenderSetting): SettingRow => ({
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
        heading: "AI rewrite (optional)",
        rows: [
          row("Enable AI rewrite", "Adds a “Rewrite with AI” button to yellow and red sentences. The model runs on your computer, so your writing never leaves it.", (setting) =>
            setting.addToggle((toggle) =>
              toggle.setValue(this.plugin.settings.aiEnabled).onChange((value) => {
                this.plugin.settings.aiEnabled = value;
                void this.plugin.persist();
              })
            )
          ),
          row("Rewrite style", "How the AI edits. “Keep my voice” changes the least.", (setting) =>
            setting.addDropdown((dd) =>
              dd
                .addOptions(STYLES)
                .setValue(this.plugin.settings.aiStyle)
                .onChange((value) => {
                  this.plugin.settings.aiStyle = value === "voice" || value === "punchy" ? value : "balanced";
                  void this.plugin.persist();
                })
            )
          ),
          row("AI model", "Choose a model to download once for offline use. Both run locally and keep your writing on your device.", (setting) =>
            setting.addDropdown((dd) =>
              dd
                .addOptions(Object.fromEntries(Object.entries(BUILTIN).map(([k, m]) => [k, m.label])))
                .setValue(this.plugin.settings.aiBuiltinModel)
                .onChange((value) => {
                  this.plugin.settings.aiBuiltinModel = value;
                  void this.plugin.persist();
                  this.refreshAi?.();
                })
            )
          ),
          row("AI setup", "", (setting) => this.renderBuiltinSetup(setting)),
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
