import { readFile } from "node:fs/promises";
import path from "node:path";
import { embed } from "ai";
import { ChromaClient, CloudClient } from "chromadb";
import episode from "@/data/episode.json";
import discussion from "@/data/discussion.json";
import { openRouter } from "./providers";
import { rankPassages } from "./vector-math";

export type Passage = {
  id: string;
  start: number;
  end: number;
  text: string;
  timestamp: string;
  url: string;
  videoId: string;
};
type Index = {
  collection: string;
  embeddingModel: string;
  dimension: number;
  windowEnd: number;
  videoId: string;
  passages: (Passage & { embedding: number[] })[];
};
let indexPromise: Promise<Index> | undefined;

async function getIndex() {
  indexPromise ??= readFile(
    path.join(process.cwd(), "data/vector-index.json"),
    "utf8",
  )
    .then((raw) => {
      const index = JSON.parse(raw) as Index;
      if (
        index.videoId !== episode.videoId ||
        index.windowEnd !== episode.windowEnd ||
        !index.passages.length
      )
        throw new Error("Index does not match the selected episode");
      return index;
    })
    .catch((error) => {
      indexPromise = undefined;
      throw error;
    });
  return indexPromise;
}

export async function searchTranscript(
  query: string,
  count = 5,
  abortSignal?: AbortSignal,
): Promise<Passage[]> {
  const index = await getIndex();
  const { embedding } = await embed({
    model: openRouter().embeddingModel(index.embeddingModel),
    value: query,
    abortSignal,
    maxRetries: 1,
  });
  if (embedding.length !== index.dimension)
    throw new Error("Embedding model dimension changed; rebuild the index");
  let ranked;
  if (process.env.CHROMA_API_KEY || process.env.CHROMA_URL) {
    const url = new URL(process.env.CHROMA_URL || "https://api.trychroma.com");
    const client = process.env.CHROMA_API_KEY
      ? new CloudClient({
          apiKey: process.env.CHROMA_API_KEY,
          tenant: process.env.CHROMA_TENANT,
          database: process.env.CHROMA_DATABASE,
        })
      : new ChromaClient({
          host: url.hostname,
          port: Number(url.port) || (url.protocol === "https:" ? 443 : 8000),
          ssl: url.protocol === "https:",
        });
    const collection = await client.getCollection({ name: index.collection });
    const result = await collection.query({
      queryEmbeddings: [embedding],
      nResults: count,
      where: {
        $and: [
          { videoId: episode.videoId },
          { start: { $gte: 0 } },
          { end: { $lte: episode.windowEnd } },
        ],
      },
    });
    // Map server IDs back to this verified episode snapshot; never accept arbitrary remote documents.
    ranked = result.ids[0]
      .map((id) => index.passages.find((p) => p.id === id))
      .filter((p) => p !== undefined);
  } else {
    ranked = rankPassages(index.passages, embedding, episode.windowEnd, count);
  }
  return ranked
    .filter((p) => p.start < episode.windowEnd && p.end <= episode.windowEnd)
    .map(({ id, start, end, text, timestamp, url, videoId }) => ({
      id,
      start,
      end,
      text,
      timestamp,
      url,
      videoId,
    }));
}

export function readWindow(start: number, end: number): Passage[] {
  if (start < 0 || end > episode.windowEnd || end <= start || end - start > 300)
    throw new Error("Choose a range of up to five minutes inside 00:00–45:00");
  const segments = discussion.segments.filter(
    (s) => s.start >= start && s.start + s.duration <= end,
  );
  if (!segments.length) return [];
  const first = segments[0].start;
  const timestamp = `${Math.floor(first / 60)}:${String(Math.floor(first % 60)).padStart(2, "0")}`;
  return [
    {
      id: `window-${start}-${end}`,
      start: first,
      end: Math.max(...segments.map((s) => s.start + s.duration)),
      text: segments
        .map(
          (s) =>
            `[${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, "0")}] ${s.text}`,
        )
        .join("\n"),
      timestamp,
      url: `https://www.youtube.com/watch?v=${episode.videoId}&t=${Math.floor(first)}s`,
      videoId: episode.videoId,
    },
  ];
}
