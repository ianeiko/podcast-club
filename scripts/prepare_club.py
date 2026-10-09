"""Preserve a full transcript, select a strict window, and export a Chroma index."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".claude/skills/yt-summary"))
from fetch_transcript import format_transcript, format_timestamp


def select_window(segments, end):
    selected = []
    for segment in segments:
        start, duration = segment["start"], segment["duration"]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 for v in (start, duration)):
            raise ValueError("Caption timestamps must be finite and nonnegative")
        # Word-level timings are unavailable. Exclude crossing captions instead of leaking spoilers.
        if start < end and start + duration <= end and segment["text"].strip():
            selected.append(segment)
    return sorted(selected, key=lambda s: s["start"])


def chunk_segments(segments, video_id, max_chars=1800):
    chunks, i = [], 0
    while i < len(segments):
        j, size = i, 0
        while j < len(segments):
            extra = len(segments[j]["text"]) + 12
            if j > i and size + extra > max_chars:
                break
            size += extra
            j += 1
        batch = segments[i:j]
        start = batch[0]["start"]
        end = max(s["start"] + s["duration"] for s in batch)
        chunks.append({"id": f"{video_id}-{len(chunks):04d}", "start": start, "end": end,
                       "text": format_transcript(batch), "videoId": video_id,
                       "timestamp": format_timestamp(start),
                       "url": f"https://www.youtube.com/watch?v={video_id}&t={int(start)}s"})
        if j == len(segments):
            break
        i = max(i + 1, j - 2)  # two captions of overlap, always make progress
    return chunks


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def index_chunks(chunks, manifest):
    import chromadb
    import requests
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env.local")
    load_dotenv(ROOT / ".env")
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("Add OPENROUTER_API_KEY to .env.local, then run npm run ingest")
    model = os.environ.get("EMBEDDING_MODEL", "openai/text-embedding-3-small")
    vectors = []
    for offset in range(0, len(chunks), 32):
        batch = chunks[offset:offset + 32]
        response = requests.post("https://openrouter.ai/api/v1/embeddings",
                                 headers={"Authorization": f"Bearer {key}"},
                                 json={"model": model, "input": [c["text"] for c in batch]}, timeout=90)
        if not response.ok:
            raise RuntimeError(f"OpenRouter embeddings failed (HTTP {response.status_code}); check key and credits")
        rows = sorted(response.json()["data"], key=lambda row: row["index"])
        if len(rows) != len(batch):
            raise RuntimeError("Embedding response count does not match captions")
        vectors.extend(row["embedding"] for row in rows)
        print(f"Embedded {min(offset + 32, len(chunks))}/{len(chunks)} passages", flush=True)
    dimension = len(vectors[0])
    if any(len(v) != dimension or not all(math.isfinite(x) for x in v) for v in vectors):
        raise RuntimeError("Invalid embedding dimensions or values")
    # Content-addressed names prevent stale chunks after a new transcript/model is indexed.
    digest = hashlib.sha256((json.dumps(chunks) + model).encode()).hexdigest()[:12]
    name = f"podcast-{manifest['videoId']}-{digest}"
    if os.environ.get("CHROMA_API_KEY"):
        client = chromadb.CloudClient(api_key=os.environ["CHROMA_API_KEY"],
                                      tenant=os.environ["CHROMA_TENANT"], database=os.environ["CHROMA_DATABASE"])
    elif os.environ.get("CHROMA_URL"):
        from urllib.parse import urlparse
        url = urlparse(os.environ["CHROMA_URL"])
        client = chromadb.HttpClient(host=url.hostname, port=url.port or (443 if url.scheme == "https" else 8000),
                                     ssl=url.scheme == "https")
    else:
        client = chromadb.PersistentClient(path=str(ROOT / ".club/chroma"))
    collection = client.get_or_create_collection(name, embedding_function=None,
                    metadata={"embedding_model": model, "window_end": manifest["windowEnd"], "hnsw:space": "cosine"})
    collection.upsert(ids=[c["id"] for c in chunks], documents=[c["text"] for c in chunks],
                      embeddings=vectors, metadatas=[{k: v for k, v in c.items() if k not in ("id", "text")} for c in chunks])
    # Read the snapshot back FROM Chroma; deployment uses the exact stored vectors and documents.
    stored = collection.get(include=["embeddings", "documents", "metadatas"])
    passages = [{"id": id_, "text": stored["documents"][i], **stored["metadatas"][i],
                 "embedding": stored["embeddings"][i].tolist()} for i, id_ in enumerate(stored["ids"])]
    passages.sort(key=lambda c: c["start"])
    check = collection.query(query_embeddings=[vectors[0]], n_results=1)
    if check["ids"][0][0] != chunks[0]["id"]:
        raise RuntimeError("Chroma retrieval verification failed")
    write_json(ROOT / "data/vector-index.json", {"collection": name, "embeddingModel": model,
               "dimension": dimension, "windowEnd": manifest["windowEnd"], "videoId": manifest["videoId"], "passages": passages})
    print(f"Verified Chroma: {collection.count()} passages, {dimension} dimensions. Snapshot exported.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data/full-transcript.json")
    parser.add_argument("--skip-index", action="store_true", help="prepare transcripts without API calls")
    args = parser.parse_args()
    video = json.loads(args.source.read_text())
    end = 45 * 60
    segments = select_window(video["segments"], end)
    if not segments:
        raise RuntimeError("No captions inside the discussion window")
    chunks = chunk_segments(segments, video["video_id"])
    manifest = {"videoId": video["video_id"], "title": video["title"], "duration": video["duration_seconds"],
                "language": video.get("language", "unknown"), "source": video.get("source", "captions"),
                "windowStart": 0, "windowEnd": end, "lastCaptionEnd": max(s["start"] + s["duration"] for s in segments),
                "totalSegments": len(video["segments"]), "discussionSegments": len(segments),
                "passageCount": len(chunks), "wordCount": sum(len(s["text"].split()) for s in segments)}
    if not args.skip_index:
        index_chunks(chunks, manifest)
    write_json(ROOT / "data/episode.json", manifest)
    write_json(ROOT / "data/discussion.json", {"segments": segments, "passages": chunks})
    (ROOT / "public/transcripts").mkdir(parents=True, exist_ok=True)
    (ROOT / "public/transcripts/full.txt").write_text(format_transcript(video["segments"]))
    (ROOT / "public/transcripts/first-45-minutes.txt").write_text(format_transcript(segments))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
