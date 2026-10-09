import { access } from "node:fs/promises";
import path from "node:path";
import episode from "@/data/episode.json";
export async function GET() {
  const indexed = await access(
    path.join(process.cwd(), "data/vector-index.json"),
  ).then(
    () => true,
    () => false,
  );
  return Response.json(
    {
      episode: episode.videoId,
      windowEnd: episode.windowEnd,
      indexed,
      modelConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
