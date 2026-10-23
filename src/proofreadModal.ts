import { App, Modal, Notice, Setting } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { ChunkResult, runProofread } from "./proofread";
import { Edit, ProofLevel, splitChunks } from "./proofread-core";
import type HemingwayPlugin from "./main";

interface Row {
  result: ChunkResult;
  edit: Edit;
  on: boolean;
}

const wordsIn = (t: string) => t.match(/\S+/g)?.length ?? 0;

export class ProofreadModal extends Modal {
  // Always the full pass: typos, punctuation, grammar and wrong or repeated words.
  private level: ProofLevel = "edit";
  private stop = false;
  private running = false;

  constructor(
    app: App,
    private plugin: HemingwayPlugin,
    private view: EditorView,
    private range: { from: number; to: number },
    private whole: boolean
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("hw-pf-modal");
    void this.run();
  }

  onClose() {
    this.stop = true;
    this.contentEl.empty();
  }

  private async run() {
    const chunks = splitChunks(this.view.state.doc.toString(), this.range.from, this.range.to);
    if (!chunks.length) {
      new Notice("There's no text to check here.");
      return this.close();
    }
    this.stop = false;
    this.running = true;

    const el = this.contentEl;
    el.empty();
    this.setTitle(this.whole ? "Proofreading the note…" : "Proofreading…");
    const status = el.createEl("p", { text: "Starting. The first run loads the model, so it can take a moment." });
    const bar = el.createEl("progress", { cls: "hw-pf-bar" });
    bar.max = chunks.length;
    bar.value = 0;
    new Setting(el).addButton((b) => b.setButtonText("Stop and show results").onClick(() => (this.stop = true)));

    let results: ChunkResult[] = [];
    try {
      results = await runProofread(
        this.plugin.aiConfig(),
        this.level,
        chunks,
        (done, total) => {
          bar.value = done;
          status.setText(`Checking section ${Math.min(done + 1, total)} of ${total}…`);
        },
        () => this.stop
      );
    } catch (e) {
      this.running = false;
      if (!this.contentEl.isConnected) return;
      el.empty();
      this.setTitle("Proofread with AI");
      el.createEl("p", { text: e instanceof Error ? e.message : "Something went wrong." });
      new Setting(el).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }
    this.running = false;
    if (!this.contentEl.isConnected) return;
    this.renderResults(results, chunks.length);
  }

  private context(text: string, from: number, to: number): [string, string] {
    let before = text.slice(Math.max(0, from - 50), from);
    let after = text.slice(to, to + 50);
    if (from > 50) before = "…" + before.replace(/^\S*\s/, "");
    if (to + 50 < text.length) after = after.replace(/\s\S*$/, "") + "…";
    return [before, after];
  }

  private renderResults(results: ChunkResult[], total: number) {
    const el = this.contentEl;
    el.empty();
    const rows: Row[] = results.flatMap((result) => result.edits.map((edit) => ({ result, edit, on: true })));
    const skipped = results.filter((r) => r.skipped).length;
    const unchecked = total - results.length;
    this.setTitle(rows.length ? `${rows.length} suggestion${rows.length === 1 ? "" : "s"}` : "No mistakes found");

    if (!rows.length) el.createEl("p", { text: "✓ Nothing needs fixing." });
    if (skipped) {
      el.createEl("p", {
        cls: "setting-item-description",
        text: `${skipped} section${skipped === 1 ? " was" : "s were"} skipped because the model tried to rewrite instead of correct. Try a smaller selection.`,
      });
    }
    if (unchecked) el.createEl("p", { cls: "setting-item-description", text: `${unchecked} sections weren't checked because you stopped early.` });

    let apply: HTMLButtonElement | null = null;
    const refresh = () => {
      const n = rows.filter((r) => r.on).length;
      apply?.setText(`Apply ${n} fix${n === 1 ? "" : "es"}`);
      if (apply) apply.disabled = n === 0;
    };

    if (rows.length) {
      const tools = el.createDiv({ cls: "hw-pf-tools" });
      const list = el.createDiv({ cls: "hw-pf-list" });
      const boxes: HTMLInputElement[] = [];
      for (const row of rows) {
        const item = list.createDiv({ cls: "hw-pf-row" });
        const box = item.createEl("input", { type: "checkbox" });
        box.checked = true;
        boxes.push(box);
        box.addEventListener("change", () => {
          row.on = box.checked;
          refresh();
        });
        const body = item.createDiv({ cls: "hw-pf-body" });
        body.createSpan({ cls: "hw-pf-label", text: row.edit.label });
        const line = body.createDiv({ cls: "hw-pf-line" });
        const [before, after] = this.context(row.result.chunk.text, row.edit.from, row.edit.to);
        line.appendText(before);
        if (row.edit.del) line.createSpan({ cls: "hw-diff-del", text: row.edit.del.trim() || "␣" });
        if (row.edit.ins) line.createSpan({ cls: "hw-diff-ins", text: row.edit.ins.trim() || "␣" });
        line.appendText(after);
      }
      const all = (on: boolean) => {
        rows.forEach((r, i) => {
          r.on = on;
          boxes[i].checked = on;
        });
        refresh();
      };
      tools.createEl("a", { text: "Select all" }).addEventListener("click", () => all(true));
      tools.createEl("a", { text: "Select none" }).addEventListener("click", () => all(false));
    }

    const footer = new Setting(el);
    footer.addButton((b) => b.setButtonText(rows.length ? "Cancel" : "Close").onClick(() => this.close()));
    if (rows.length) {
      footer.addButton((b) => {
        b.setCta().onClick(() => this.apply(rows));
        apply = b.buttonEl;
      });
      refresh();
    }
  }

  private apply(rows: Row[]) {
    const doc = this.view.state.doc.toString();
    const changes: { from: number; to: number; insert: string }[] = [];
    let stale = 0;
    let applied = 0;
    for (const { result, edit, on } of rows) {
      if (!on) continue;
      const { chunk } = result;
      if (doc.slice(chunk.from, chunk.from + chunk.text.length) !== chunk.text) {
        stale++;
        continue;
      }
      changes.push({ from: chunk.from + edit.from, to: chunk.from + edit.to, insert: edit.ins });
      applied++;
    }
    changes.sort((a, b) => a.from - b.from);
    if (changes.length) this.view.dispatch({ changes });
    this.close();
    this.view.focus();
    new Notice(
      stale
        ? `Applied ${applied} fixes. Skipped ${stale} because that text changed meanwhile.`
        : `Applied ${applied} fix${applied === 1 ? "" : "es"}. Undo with ⌘Z / Ctrl+Z.`
    );
  }
}
