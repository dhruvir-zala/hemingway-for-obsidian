# Contributing

Thanks for helping improve the plugin.

## Setup

```bash
npm install
npm run dev
```

Put the repo (or a symlink) in `<vault>/.obsidian/plugins/hemingway/` and use a test vault.

## Before opening a pull request

- `npm run build` must pass (it runs the TypeScript checker).
- `npm test` must pass. Add a test in `test/analyzer.test.mts` for any change to detection rules.
- Keep changes focused. Don't commit `main.js`.

## Layout

| File | Purpose |
| --- | --- |
| `src/analyzer.ts` | Pure text analysis: grade, sentences, issues. No Obsidian imports. |
| `src/lexicon.ts` | Word lists (simpler words, weakeners, exceptions). Easy place to contribute. |
| `src/editor.ts` | CodeMirror extension: highlights and the click popup. |
| `src/reading.ts` | Highlights in Reading view. |
| `src/panel.ts` | Side panel. |
| `src/settings.ts` | Settings tab. |
| `src/main.ts` | Plugin entry, goals, focus mode. |

## Reporting false positives

Include the sentence, which highlight was wrong and what you expected. Wrong flags are usually fixed by adding a word to an exception list in `src/lexicon.ts`.

## Independence from Hemingway Editor

Do not copy code, text, images, logos or word lists from hemingwayapp.com. Write contributions independently.
