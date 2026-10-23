import esbuild from "esbuild";
import { builtinModules } from "node:module";

import { readFile } from "node:fs/promises";

// WebLLM's emscripten runtime mistakes Obsidian's Electron for Node and needs createRequire.
// Force the browser code path.
const forceBrowser = {
  name: "force-browser-runtime",
  setup(build) {
    build.onLoad({ filter: /@mlc-ai[\\/]web-llm[\\/]lib[\\/]index\.js$/ }, async (args) => ({
      contents: (await readFile(args.path, "utf8")).replaceAll(
        'ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string";',
        "ENVIRONMENT_IS_NODE=false;"
      ),
      loader: "js",
    }));
  },
};

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [forceBrowser],
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
