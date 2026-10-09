import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, rankPassages } from "./vector-math";

test("cosine handles length, zero vectors, and normalized ranking", () => {
  assert.equal(cosineSimilarity([2, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.throws(() => cosineSimilarity([1], [1, 2]));
});
test("retrieval excludes later and crossing passages before ranking", () => {
  const passages = [
    { id: "spoiler", start: 2800, end: 2805, embedding: [1, 0] },
    { id: "crossing", start: 2699, end: 2701, embedding: [1, 0] },
    { id: "relevant", start: 4, end: 8, embedding: [1, 0.1] },
    { id: "other", start: 8, end: 12, embedding: [0, 1] },
  ];
  assert.deepEqual(
    rankPassages(passages, [1, 0], 2700, 3).map((p) => p.id),
    ["relevant", "other"],
  );
});
