/*
 * OpenAI embeddings (text-embedding-3-small, 1536-d). Batched to keep request
 * sizes sane. Used by both the indexer (chunks) and project-qa (the query).
 */
const MODEL = "text-embedding-3-small";
const BATCH = 96;
const MAX_CHARS = 8000; // ~2k tokens, safely under the 8191-token input cap

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in the environment");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS));
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!res.ok) {
      throw new Error(
        `OpenAI embeddings ${res.status}: ${await res.text().catch(() => "")}`
      );
    }
    const j = (await res.json()) as { data: { embedding: number[] }[] };
    for (const d of j.data) out.push(d.embedding);
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}
