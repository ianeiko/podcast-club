import json
import fetch_transcript as ft


def test_json_export_preserves_entire_video(monkeypatch, tmp_path, capsys):
    video = {"video_id": "NYFGCESmikA", "title": "Long podcast", "duration_seconds": 18000,
             "segments": [{"start": 0.0, "duration": 2.0, "text": "Opening"},
                          {"start": 17990.0, "duration": 10.0, "text": "Last words"}]}
    monkeypatch.setattr(ft, "fetch_video", lambda _: video)
    out = tmp_path / "full.txt"
    structured = tmp_path / "full.json"
    assert ft.main(["NYFGCESmikA", "--out", str(out), "--json-out", str(structured)]) == 0
    assert json.loads(structured.read_text()) == video
    assert "Last words" in out.read_text()
    assert json.loads(capsys.readouterr().out)["segments"] == 2
