import esbuild from "esbuild";
import { builtinModules } from "node:module";

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const shim = resolve("src/jstokenizer.ts");

// WebLLM's emscripten runtime mistakes Obsidian's Electron for Node and needs createRequire.
// Force the browser code path.
const forceBrowser = {
  name: "force-browser-runtime",
  setup(build) {
    build.onLoad({ filter: /@mlc-ai[\\/]web-llm[\\/]lib[\\/]index\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const patched = source
        .replaceAll(
          'ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string";',
          "ENVIRONMENT_IS_NODE=false;"
        )
        // The bundled loglevel library persists its level in localStorage; use a throwaway object instead.
        .replaceAll("window.localStorage", "({})")
        // Drop the embedded tokenizer WebAssembly (about 4.6 MB) and use the small JS tokenizer instead.
        .replace(/data:application\/octet-stream;base64,[A-Za-z0-9+/=]{2000000,}/, "data:application/octet-stream;base64,")
        .replaceAll("libExports.Tokenizer.", "hwTokenizer.");
      if (patched === source || !patched.includes("hwTokenizer.fromJSON")) {
        throw new Error("WebLLM changed: update the tokenizer patch in esbuild.config.mjs.");
      }
      return {
        contents: `import { Tokenizer as hwTokenizer } from ${JSON.stringify(shim)};\n${patched}`,
        loader: "js",
        resolveDir: dirname(args.path),
      };
    });
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
