import { Tokenizer } from "../src/jstokenizer";

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// A tiny byte-level BPE tokenizer: "Ġ" is a space, and "<|eot|>" is a special token.
const spec = {
  version: "1.0",
  truncation: null,
  padding: null,
  added_tokens: [{ id: 6, content: "<|eot|>", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true }],
  normalizer: null,
  pre_tokenizer: { type: "ByteLevel", add_prefix_space: false, trim_offsets: true, use_regex: true },
  post_processor: null,
  decoder: { type: "ByteLevel", add_prefix_space: true, trim_offsets: true, use_regex: true },
  model: {
    type: "BPE",
    dropout: null,
    unk_token: null,
    continuing_subword_prefix: null,
    end_of_word_suffix: null,
    fuse_unk: false,
    byte_fallback: false,
    vocab: { h: 0, i: 1, Ġ: 2, hi: 3, a: 4, b: 5 },
    merges: ["h i"],
  },
};

const buf = new TextEncoder().encode(JSON.stringify(spec));
const tok = await Tokenizer.fromJSON(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

eq("encode merges", Array.from(tok.encode("hi")), [3]);
eq("encode special token", Array.from(tok.encode("hi<|eot|>")), [3, 6]);
eq("decode round trip", tok.decode(tok.encode("hi ab")), "hi ab");
eq("decode empty", tok.decode(new Int32Array(0)), "");
eq("id to token", tok.idToToken(3), "hi");
eq("unknown id to token", tok.idToToken(999), "");
eq("vocab size counts special tokens", tok.getVocabSize(), 7);

let rejected = false;
try {
  await Tokenizer.fromSentencePiece();
} catch {
  rejected = true;
}
eq("sentencepiece rejected", rejected, true);

console.log(fail ? `${fail} failed` : "all ok");
if (fail) process.exit(1);
