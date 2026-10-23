import { Tokenizer as HfTokenizer } from "@huggingface/tokenizers";

/**
 * Pure JavaScript stand-in for the WebAssembly tokenizer bundled with WebLLM.
 * It exposes the same methods WebLLM calls, and drops about 4.6 MB from main.js.
 */
export class JsTokenizer {
  private size: number;

  constructor(private tok: HfTokenizer) {
    this.size = tok.get_vocab(true).size;
  }

  encode(text: string): Int32Array {
    return Int32Array.from(this.tok.encode(text, { add_special_tokens: false }).ids);
  }

  decode(ids: ArrayLike<number>): string {
    if (!ids.length) return "";
    return this.tok.decode(Array.from(ids), { skip_special_tokens: false, clean_up_tokenization_spaces: false });
  }

  getVocabSize(): number {
    return this.size;
  }

  idToToken(id: number): string {
    return this.tok.id_to_token(id) ?? "";
  }

  dispose(): void {}
}

export const Tokenizer = {
  async fromJSON(json: ArrayBuffer): Promise<JsTokenizer> {
    const spec: unknown = JSON.parse(new TextDecoder().decode(json));
    return new JsTokenizer(new HfTokenizer(spec as object, { clean_up_tokenization_spaces: false }));
  },
  async fromByteLevelBPE(): Promise<JsTokenizer> {
    throw new Error("This tokenizer format isn't supported. The model needs a tokenizer.json file.");
  },
  async fromSentencePiece(): Promise<JsTokenizer> {
    throw new Error("This tokenizer format isn't supported. The model needs a tokenizer.json file.");
  },
};
