import base64
import json
import mimetypes
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ASSET_DIRECTORIES = {
    "gifs": ROOT / "GIFS",
    "backgrounds": ROOT / "BACKGROUNDS",
}
IMAGE_EXTENSIONS = {".gif", ".jpg", ".jpeg", ".png", ".webp"}

assets = {}
for category, directory in ASSET_DIRECTORIES.items():
    assets[category] = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        mime_type, _ = mimetypes.guess_type(path.name)
        if mime_type is None:
            raise ValueError(f"Could not determine image type for {path.name}.")

        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        assets[category].append({
            "name": path.name,
            "url": f"data:{mime_type};base64,{encoded}",
        })

manifest = f"window.GIFCOLLAGE_ASSETS = {json.dumps(assets, indent=2)};\n"
(ROOT / "asset-manifest.js").write_text(manifest, encoding="utf-8")
