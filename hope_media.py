"""Convert uploads or links to MP3 and serve a download link."""
import os
import re
import subprocess
import tempfile
import time
import urllib.parse
import uuid
from pathlib import Path

DIR = Path(__file__).resolve().parent
MEDIA_DIR = DIR / "hope-media"
MEDIA_DIR.mkdir(exist_ok=True)

# Keep generated files for 2 hours
TTL = 7200

def _clean_old():
    now = time.time()
    for p in MEDIA_DIR.glob("*.mp3"):
        try:
            if now - p.stat().st_mtime > TTL:
                p.unlink()
        except Exception:
            pass

def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "audio")[:80]
    return base or "audio"

def convert_file_to_mp3(file_bytes: bytes, filename: str) -> dict:
    """Convert an uploaded audio/video file to MP3."""
    _clean_old()
    ext = Path(filename).suffix.lower() or ".bin"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / ("input" + ext)
        src.write_bytes(file_bytes)
        out_id = uuid.uuid4().hex[:12]
        out_path = MEDIA_DIR / f"{out_id}.mp3"
        cmd = [
            "ffmpeg", "-y", "-i", str(src),
            "-vn", "-acodec", "libmp3lame", "-q:a", "2",
            str(out_path)
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        except Exception as e:
            return {"ok": False, "error": f"ffmpeg failed: {e}"}
    return {
        "ok": True,
        "url": f"/api/media/{out_id}.mp3",
        "filename": _safe_name(Path(filename).stem) + ".mp3",
        "size": out_path.stat().st_size,
    }

def convert_url_to_mp3(url: str) -> dict:
    """Download a link (YouTube, SoundCloud, direct audio, etc.) and convert to MP3."""
    _clean_old()
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "Invalid URL"}
    out_id = uuid.uuid4().hex[:12]
    out_path = MEDIA_DIR / f"{out_id}.mp3"
    # yt-dlp extracts audio directly to mp3 when possible
    cmd = [
        "yt-dlp",
        "-x", "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", str(MEDIA_DIR / f"{out_id}.%(ext)s"),
        "--no-playlist",
        url,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=180)
    except Exception as e:
        return {"ok": False, "error": f"yt-dlp failed: {e}"}
    # yt-dlp may write .mp3 or need a rename
    candidates = list(MEDIA_DIR.glob(f"{out_id}.*"))
    if not candidates:
        return {"ok": False, "error": "No output file produced"}
    final = candidates[0]
    if final.suffix.lower() != ".mp3":
        # force convert if needed
        mp3_path = MEDIA_DIR / f"{out_id}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(final), "-vn", "-acodec", "libmp3lame", "-q:a", "2", str(mp3_path)],
            check=True, capture_output=True, timeout=120
        )
        final.unlink(missing_ok=True)
        final = mp3_path
    return {
        "ok": True,
        "url": f"/api/media/{out_id}.mp3",
        "filename": "download.mp3",
        "size": final.stat().st_size,
    }

def get_media_path(file_id: str) -> Path | None:
    p = MEDIA_DIR / f"{file_id}.mp3"
    return p if p.exists() else None
