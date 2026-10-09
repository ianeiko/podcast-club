export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length)
    throw new Error("Embedding dimensions do not match");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function rankPassages<
  T extends { start: number; end: number; embedding: number[] },
>(passages: T[], query: number[], windowEnd: number, count: number) {
  return passages
    .filter((p) => p.start >= 0 && p.start < windowEnd && p.end <= windowEnd)
    .map((p) => ({ ...p, score: cosineSimilarity(p.embedding, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}
