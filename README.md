# Hemingway for Obsidian

> ## ⚠️ Not affiliated with Hemingway Editor
> **Hemingway** (this plugin) is an **independent, unofficial, community-made** plugin. It is **not affiliated with, endorsed by, sponsored by, or connected to** Hemingway Editor, the Hemingway App, or Boondoggle Studio, LLC, the owner of [hemingwayapp.com](https://hemingwayapp.com/). "Hemingway Editor" and "Hemingway App" are trademarks of their respective owners and are used here only to describe the style of feedback this plugin gives. This plugin contains no code, logos, text or other assets from hemingwayapp.com. If you want the official product, including its AI and grammar tools, use [hemingwayapp.com](https://hemingwayapp.com/).

Hemingway-style writing feedback, live inside your normal Obsidian notes. No separate window, no copy and paste, no account, and nothing leaves your device.

| Colour | Meaning |
| --- | --- |
| Red | Very hard to read sentence |
| Yellow | Hard to read sentence |
| Blue | Adverbs, passive voice and weakening phrases |
| Purple | A word or phrase with a simpler alternative |

## Features

- **Live highlights** in Live Preview, Source mode and Reading view.
- **Click any highlight** for an explanation and a one-click fix: swap in a simpler word, remove an adverb or qualifier, or ignore a word for good. If several issues overlap, use the `‹ ›` pager.
- **Side panel** with the readability grade, letters, characters, words, sentences, paragraphs, reading time and a card for each issue type. The eye icons show or hide each highlight type.
- **Write / Edit tabs** to hide or show all highlights.
- **Selection stats:** select text and the panel and status bar switch to that selection.
- **Goals:** an optional word goal per note, a daily word goal and a streak counter.
- **Focus mode:** hides sidebars, tabs and the status bar. Use the "Toggle focus mode" command.
- **Settings:** target grade, reading speed, custom weakening phrases, ignored words, and per-type toggles.
- Markdown-aware: front matter, code, links, embeds, comments and syntax are not counted or flagged.

## Install

### From the community plugin list
Once published: **Settings → Community plugins → Browse → "Hemingway"**.

### Manually
1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Copy them to `<your vault>/.obsidian/plugins/hemingway/`.
3. Reload Obsidian and enable **Hemingway** under Settings → Community plugins.

### With BRAT
Add `dhruvir-zala/Hemingway-editor-for-Obsidian` in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.

## Commands

| Command | What it does |
| --- | --- |
| Toggle highlights (Write / Edit) | Show or hide all highlights |
| Toggle focus mode | Hide sidebars, tabs and the status bar |
| Open panel | Open the Hemingway side panel |

Assign hotkeys in Settings → Hotkeys.

## How it works

The grade uses the same formula as Hemingway: `4.71 × (letters / words) + 0.5 × (words / sentences) − 21.43`. A sentence is hard to read at 14 or more words and grade 10 or higher, and very hard at grade 14 or higher. Everything runs locally and the word lists are in [`src/lexicon.ts`](src/lexicon.ts). They are an approximation of Hemingway's, so results can differ slightly from the website.

Overlapping highlights: word-level colours (blue, purple) are drawn on top of sentence colours (red, yellow).

## Development

```bash
npm install
npm run dev      # rebuild on change
npm run build    # type-check and produce main.js
npm test         # analyzer unit tests
```

Symlink or copy the repo into `<vault>/.obsidian/plugins/hemingway/` and reload Obsidian to try changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releasing

1. `npm version patch` (or `minor` / `major`). This updates `manifest.json` and `versions.json`.
2. `git push --follow-tags`. The GitHub Action builds and creates a draft release with `main.js`, `manifest.json` and `styles.css`.
3. Publish the draft.

## Contributing

Bug reports, word-list additions and translations are welcome. Open an issue or a pull request.

## Disclaimer and trademarks

All product names, trademarks and registered trademarks are the property of their respective owners. Their use here does not imply any affiliation or endorsement. The readability grade uses a published formula, the word lists are independently written, and nothing was copied from hemingwayapp.com.

## License

[MIT](LICENSE)
