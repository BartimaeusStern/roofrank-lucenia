// Local MiniLM 384-dim embeddings (private, no external calls). Model downloads
// once (~90MB) then caches. Singleton so the model loads a single time.
import { pipeline } from "@huggingface/transformers";

let _extractor = null;
async function extractor() {
  if (!_extractor) _extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return _extractor;
}

export async function embed(text) {
  const e = await extractor();
  const out = await e(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// Batch for ingest speed. Returns array of 384-float arrays.
export async function embedMany(texts, batch = 32) {
  const e = await extractor();
  const vectors = [];
  for (let i = 0; i < texts.length; i += batch) {
    const out = await e(texts.slice(i, i + batch), { pooling: "mean", normalize: true });
    vectors.push(...out.tolist());
  }
  return vectors;
}
