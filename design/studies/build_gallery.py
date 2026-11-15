"""Inline catalog paintings into the night-gallery study.

Reads night-gallery.src.html, replaces the /*ART_JSON*/ marker with a JSON array of
paintings (metadata + base64 JPEG), writes night-gallery.html. Run from the repo root:

    python3 design/studies/build_gallery.py
"""
import base64
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "catalog" / "data"
STUDY = Path(__file__).resolve().parent

# Eight wall paintings (picked from the quiz rounds), then the arch painting last.
WALL_IDS = ["aic-9148", "aic-16794", "aic-14311", "aic-9", "aic-22857", "aic-7169", "aic-181777", "aic-21085"]
ARCH_ID = "aic-16584"


def jpeg_size(data: bytes) -> tuple[int, int]:
    i = 2
    while i < len(data):
        marker = data[i + 1]
        length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])
            return width, height
        i += 2 + length
    raise ValueError("no SOF marker")


def main() -> None:
    arts = {a["id"]: a for a in json.loads((CATALOG / "artworks.json").read_text())}
    out = []
    for art_id in [*WALL_IDS, ARCH_ID]:
        a = arts[art_id]
        raw = (CATALOG / a["image_path"]).read_bytes()
        width, height = jpeg_size(raw)
        out.append({
            "id": art_id, "title": a["title"], "artist": a["artist"], "year": a["year"],
            "medium": a["brush"], "w": width, "h": height,
            "src": "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii"),
        })
    src = (STUDY / "night-gallery.src.html").read_text()
    marker = "/*ART_JSON*/[]"
    if marker not in src:
        raise SystemExit("marker not found in night-gallery.src.html")
    built = src.replace(marker, json.dumps(out, ensure_ascii=False))
    (STUDY / "night-gallery.html").write_text(built)
    print(f"wrote night-gallery.html: {len(built) // 1024} KB, {len(out)} paintings")


if __name__ == "__main__":
    main()
