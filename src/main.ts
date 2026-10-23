import { Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Analysis, Kind, Options, analyze } from "./analyzer";
import { createField, hemingwayExtension, rebuildEffect } from "./editor";
import { ALL_KINDS } from "./info";
import { HemingwayPanel, VIEW_TYPE } from "./panel";
import { highlightRendered } from "./reading";
import type { AiConfig, RewriteStyle } from "./ai";
import { ProofreadModal } from "./proofreadModal";
import { BUILTIN, DEFAULT_BUILTIN, unloadEngine } from "./webllm";
import { HemingwaySettingTab } from "./settings";

export type Mode = "write" | "edit";

export interface Settings {
  mode: Mode;
  hidden: Kind[];
  gradeTarget: number;
  wpm: number;
  extraWeakeners: string[];
  ignore: string[];
  wordGoal: number;
  dailyGoal: number;
  daily: Record<string, number>;
  aiEnabled: boolean;
  aiBuiltinModel: string;
  aiStyle: RewriteStyle;
}

export const DEFAULTS: Settings = {
  mode: "edit",
  hidden: [],
  gradeTarget: 9,
  wpm: 240,
  extraWeakeners: [],
  ignore: [],
  wordGoal: 0,
  dailyGoal: 0,
  daily: {},
  aiEnabled: false,
  aiBuiltinModel: DEFAULT_BUILTIN,
  aiStyle: "balanced",
};

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is Kind {
  return typeof value === "string" && ALL_KINDS.some((kind) => kind === value);
}

function normalizeSettings(value: unknown): Settings {
  const saved = isRecord(value) ? value : {};
  const number = (key: string, fallback: number) => {
    const candidate = saved[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
  };
  const daily: Record<string, number> = {};
  if (isRecord(saved.daily)) {
    for (const [date, count] of Object.entries(saved.daily)) {
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) daily[date] = count;
    }
  }

  return {
    ...DEFAULTS,
    mode: saved.mode === "write" || saved.mode === "edit" ? saved.mode : DEFAULTS.mode,
    hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(isKind) : [],
    gradeTarget: number("gradeTarget", DEFAULTS.gradeTarget),
    wpm: number("wpm", DEFAULTS.wpm),
    extraWeakeners: Array.isArray(saved.extraWeakeners)
      ? saved.extraWeakeners.filter((item): item is string => typeof item === "string")
      : [],
    ignore: Array.isArray(saved.ignore)
      ? saved.ignore.filter((item): item is string => typeof item === "string")
      : [],
    wordGoal: number("wordGoal", DEFAULTS.wordGoal),
    dailyGoal: number("dailyGoal", DEFAULTS.dailyGoal),
    daily,
    aiEnabled: saved.aiEnabled === true,
    aiStyle: saved.aiStyle === "voice" || saved.aiStyle === "punchy" ? saved.aiStyle : "balanced",
    aiBuiltinModel: typeof saved.aiBuiltinModel === "string" && saved.aiBuiltinModel in BUILTIN ? saved.aiBuiltinModel : DEFAULT_BUILTIN,
  };
}

export interface PanelData {
  analysis: Analysis;
  selection: boolean;
}

export default class HemingwayPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private cm: EditorView | null = null;
  private field = createField(this);
  private statusEl!: HTMLElement;
  private path: string | null = null;
  private lastWords = new Map<string, number>();
  private focusSaved: { left: boolean; right: boolean } | null = null;
  private focusBtn: HTMLElement | null = null;
  private saveSoon = debounce(() => void this.saveData(this.settings), 2000, true);

  rewriteSelection: (view: EditorView) => void = () => {};

  aiConfig(): AiConfig {
    const { aiBuiltinModel, aiStyle } = this.settings;
    return { builtinModel: aiBuiltinModel, style: aiStyle };
  }

  async onload() {
    const saved: unknown = await this.loadData();
    this.settings = normalizeSettings(saved);

    this.registerEditorExtension(hemingwayExtension(this, this.field));
    this.registerMarkdownPostProcessor((el) => highlightRendered(el, this));
    this.registerView(VIEW_TYPE, (leaf) => new HemingwayPanel(leaf, this));
    this.addSettingTab(new HemingwaySettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("hw-status");
    this.statusEl.addEventListener("click", () => void this.openPanel());

    const toggle = () => void this.setMode(this.settings.mode === "edit" ? "write" : "edit");
    this.addRibbonIcon("feather", "Hemingway: toggle highlights", toggle);
    this.addCommand({ id: "toggle-highlights", name: "Toggle highlights (Write / Edit)", callback: toggle });
    this.addCommand({ id: "toggle-focus", name: "Toggle focus mode", callback: () => this.toggleFocus() });
    this.addCommand({ id: "open-panel", name: "Open panel", callback: () => void this.openPanel() });

    const rewrite = (editor: Editor) => {
      const cm = (editor as unknown as { cm?: EditorView }).cm;
      if (cm) this.rewriteSelection(cm);
    };
    this.addCommand({ id: "rewrite-selection", name: "Rewrite selection with AI", editorCallback: rewrite });
    const proofread = (editor: Editor) => {
      const cm = (editor as unknown as { cm?: EditorView }).cm;
      if (!cm) return;
      if (!this.settings.aiEnabled) return void new Notice("Turn on AI rewrite in Hemingway's settings first.");
      const sel = cm.state.selection.main;
      const whole = sel.empty;
      const range = whole ? { from: 0, to: cm.state.doc.length } : { from: sel.from, to: sel.to };
      new ProofreadModal(this.app, this, cm, range, whole).open();
    };
    this.addCommand({ id: "proofread", name: "Proofread with AI (selection or whole note)", editorCallback: proofread });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!this.settings.aiEnabled) return;
        const has = !!editor.getSelection();
        if (has) menu.addItem((item) => item.setTitle("Hemingway: rewrite selection").setIcon("sparkles").onClick(() => rewrite(editor)));
        menu.addItem((item) =>
          item.setTitle(has ? "Hemingway: proofread selection" : "Hemingway: proofread note").setIcon("spell-check").onClick(() => proofread(editor))
        );
      })
    );

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.trackLeaf(leaf)));

    this.applyBody();
    this.app.workspace.onLayoutReady(() => {
      this.trackLeaf(this.app.workspace.getLeaf(false));
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) void this.openPanel(false);
    });
  }

  onunload() {
    void unloadEngine();
    if (this.focusSaved) this.toggleFocus();
    void this.saveData(this.settings);
    document.body.classList.remove("hw-on", "hw-focus", ...ALL_KINDS.map((k) => "hw-hide-" + k));
    document.body.querySelectorAll(".hw-tip").forEach((e) => e.remove());
  }

  private trackLeaf(leaf: WorkspaceLeaf | null) {
    const v = leaf?.view;
    if (v instanceof MarkdownView) {
      this.cm = (v.editor as unknown as { cm?: EditorView }).cm ?? null;
      this.path = v.file?.path ?? null;
      this.refresh();
    }
  }

  // Called by the editor extension on document or selection changes.
  notify = debounce(
    (view: EditorView) => {
      if (!this.cm || this.cm === view || !this.cm.dom.isConnected) {
        this.cm = view;
        this.refresh();
      }
    },
    150,
    true
  );

  analysisOptions(): Options {
    return { extraWeakeners: this.settings.extraWeakeners, ignore: this.settings.ignore };
  }

  panelData(): PanelData | null {
    const cm = this.cm;
    if (!cm) return null;
    try {
      const sel = cm.state.selection.main;
      if (!sel.empty) {
        return { analysis: analyze(cm.state.sliceDoc(sel.from, sel.to), this.analysisOptions()), selection: true };
      }
      return { analysis: cm.state.field(this.field).analysis, selection: false };
    } catch {
      return null;
    }
  }

  private refresh() {
    const d = this.panelData();
    const a = d?.analysis;
    const prefix = d?.selection ? "Selection" : "Hemingway";
    if (a && !d.selection) this.recordWords(a.words);
    const goal = this.settings.wordGoal;
    const progress = goal > 0 && a && !d.selection ? ` · ${a.words}/${goal}` : "";
    this.statusEl.setText(a && a.words ? `${prefix}: Grade ${a.grade}${progress}` : "Hemingway");
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) (leaf.view as HemingwayPanel).render();
  }

  // Counts newly written words (growth in a note's word count) towards today's total.
  private recordWords(words: number) {
    if (!this.path) return;
    const prev = this.lastWords.get(this.path);
    this.lastWords.set(this.path, words);
    if (prev === undefined || words <= prev) return;
    const key = dayKey();
    this.settings.daily[key] = (this.settings.daily[key] ?? 0) + (words - prev);
    const cutoff = dayKey(new Date(Date.now() - 400 * 86400000));
    for (const k of Object.keys(this.settings.daily)) if (k < cutoff) delete this.settings.daily[k];
    this.saveSoon();
  }

  todayWords(): number {
    return this.settings.daily[dayKey()] ?? 0;
  }

  /** Consecutive days meeting the daily goal; today may still be in progress. */
  streak(): number {
    const goal = this.settings.dailyGoal;
    if (goal <= 0) return 0;
    const d = new Date();
    if ((this.settings.daily[dayKey(d)] ?? 0) < goal) d.setDate(d.getDate() - 1);
    let n = 0;
    while ((this.settings.daily[dayKey(d)] ?? 0) >= goal) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  toggleFocus() {
    const ws = this.app.workspace;
    const b = document.body;
    if (this.focusSaved) {
      if (!this.focusSaved.left) ws.leftSplit.expand();
      if (!this.focusSaved.right) ws.rightSplit.expand();
      this.focusSaved = null;
      b.removeClass("hw-focus");
      this.focusBtn?.remove();
      this.focusBtn = null;
      return;
    }
    this.focusSaved = { left: ws.leftSplit.collapsed, right: ws.rightSplit.collapsed };
    ws.leftSplit.collapse();
    ws.rightSplit.collapse();
    b.addClass("hw-focus");
    const btn = b.createEl("button", { cls: "hw-focus-exit", text: "Exit focus" });
    setIcon(btn.createSpan(), "minimize-2");
    btn.addEventListener("click", () => this.toggleFocus());
    this.focusBtn = btn;
  }

  highlightsOn() {
    return this.settings.mode === "edit";
  }
  isKindHidden(k: Kind) {
    return this.settings.hidden.includes(k);
  }

  private applyBody() {
    const b = document.body;
    b.toggleClass("hw-on", this.highlightsOn());
    for (const k of ALL_KINDS) b.toggleClass("hw-hide-" + k, this.isKindHidden(k));
  }

  async persist() {
    await this.saveData(this.settings);
    this.applyBody();
    this.refresh();
  }

  async setMode(m: Mode) {
    this.settings.mode = m;
    await this.persist();
  }

  async toggleKinds(kinds: Kind[]) {
    const allHidden = kinds.every((k) => this.settings.hidden.includes(k));
    const rest = this.settings.hidden.filter((k) => !kinds.includes(k));
    this.settings.hidden = allHidden ? rest : [...rest, ...kinds];
    await this.persist();
  }

  async ignoreWord(word: string) {
    const w = word.trim().toLowerCase();
    if (w && !this.settings.ignore.includes(w)) this.settings.ignore.push(w);
    await this.persist();
    this.reanalyze();
  }

  /** Re-run analysis in every open note after word lists change. */
  reanalyze() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) return;
      const cm = (v.editor as unknown as { cm?: EditorView }).cm;
      cm?.dispatch({ effects: rebuildEffect.of(null) });
      (v.previewMode as unknown as { rerender?: (full: boolean) => void } | undefined)?.rerender?.(true);
    });
    this.refresh();
  }

  async openPanel(reveal = true) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE, active: reveal });
    }
    if (reveal) await this.app.workspace.revealLeaf(leaf);
  }
}
