import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prepare_club import select_window, chunk_segments


def test_window_excludes_boundary_crossing_and_later_captions():
    captions = [{"start": 0, "duration": 3, "text": "Beginning"},
                {"start": 2696, "duration": 4, "text": "In scope"},
                {"start": 2699, "duration": 3, "text": "Crosses boundary"},
                {"start": 2700, "duration": 4, "text": "Spoiler"}]
    assert [s["text"] for s in select_window(captions, 2700)] == ["Beginning", "In scope"]


def test_chunks_cover_all_selected_words_and_keep_timestamps():
    captions = [{"start": i * 5, "duration": 5, "text": f"Line {i} " * 10} for i in range(80)]
    chunks = chunk_segments(captions, "NYFGCESmikA", max_chars=600)
    assert len(chunks) > 1
    assert all(c["end"] <= 400 for c in chunks)
    assert all(s["text"] in "\n".join(c["text"] for c in chunks) for s in captions)
    assert len({c["id"] for c in chunks}) == len(chunks)
    assert chunks[0]["start"] == 0
    assert chunks[-1]["end"] == 400


def test_rejects_invalid_segments():
    with pytest.raises(ValueError):
        select_window([{"start": -1, "duration": 4, "text": "bad"}], 2700)
