import type { MLCEngine } from "@mlc-ai/web-llm";

export interface BuiltinModel {
  label: string;
  f16: string;
  f32: string;
}

// q4f16 models need the GPU "shader-f16" feature; q4f32 is the compatible fallback.
export const BUILTIN: Record<string, BuiltinModel> = {
  llama3b: {
    label: "Llama 3.2 3B Instruct • Q4 MLC, ~2.3 GB",
    f16: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    f32: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  },
};

export const DEFAULT_BUILTIN = "llama3b";

type WebLLM = typeof import("@mlc-ai/web-llm");

let lib: Promise<WebLLM> | null = null;
const load = () => (lib ??= import("@mlc-ai/web-llm"));

let engine: MLCEngine | null = null;
let engineModel = "";
let loading: Promise<MLCEngine> | null = null;
let f16: boolean | null = null;

interface GpuAdapter {
  features: { has(name: string): boolean };
}

export async function gpuSupport(): Promise<"ok" | "none"> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) return "none";
    f16 = adapter.features.has("shader-f16");
    return "ok";
  } catch {
    return "none";
  }
}

async function modelId(key: string): Promise<string> {
  const m = BUILTIN[key] ?? BUILTIN[DEFAULT_BUILTIN];
  if (f16 === null) await gpuSupport();
  return f16 ? m.f16 : m.f32;
}

export async function isInstalled(key: string): Promise<boolean> {
  try {
    const w = await load();
    return await w.hasModelInCache(await modelId(key), { ...w.prebuiltAppConfig, cacheBackend: "indexeddb" as const });
  } catch {
    return false;
  }
}

export function getEngine(
  key: string,
  onProgress?: (fraction: number, text: string) => void
): Promise<MLCEngine> {
  if (loading) return loading;
  const p = (async () => {
    const w = await load();
    const id = await modelId(key);
    if (engine && engineModel === id) return engine;
    await unloadEngine();
    const created = await w.CreateMLCEngine(id, {
      appConfig: { ...w.prebuiltAppConfig, cacheBackend: "indexeddb" as const },
      initProgressCallback: (r) => onProgress?.(r.progress, r.text),
    });
    engine = created;
    engineModel = id;
    return created;
  })();
  loading = p;
  const clear = () => {
    if (loading === p) loading = null;
  };
  p.then(clear, clear);
  return p;
}

export async function unloadEngine(): Promise<void> {
  const e = engine;
  engine = null;
  engineModel = "";
  try {
    await e?.unload();
  } catch {
    /* already gone */
  }
}

export async function builtinChat(
  key: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  temperature: number,
  onToken?: (text: string) => void
): Promise<string> {
  if ((await gpuSupport()) === "none") throw new Error("This computer's graphics (WebGPU) isn't supported.");
  const e = await getEngine(key);
  const stream = await e.chat.completions.create({ stream: true, temperature, max_tokens: 1200, messages });
  let text = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      text += token;
      onToken?.(text);
    }
  }
  return text;
}

export async function deleteModel(key: string): Promise<void> {
  const w = await load();
  const id = await modelId(key);
  if (engineModel === id) await unloadEngine();
  await w.deleteModelAllInfoInCache(id, { ...w.prebuiltAppConfig, cacheBackend: "indexeddb" as const });
}
