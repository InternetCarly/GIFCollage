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

manifest = {}
embedded_assets = {}
for category, directory in ASSET_DIRECTORIES.items():
    manifest[category] = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        mime_type, _ = mimetypes.guess_type(path.name)
        if mime_type is None:
            raise ValueError(f"Could not determine image type for {path.name}.")

        relative_path = path.relative_to(ROOT).as_posix()
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        manifest[category].append({
            "name": path.name,
            "path": relative_path,
        })
        embedded_assets[relative_path] = f"data:{mime_type};base64,{encoded}"

(ROOT / "asset-manifest.js").write_text(
    f"window.GIFCOLLAGE_ASSETS = {json.dumps(manifest, indent=2)};\n",
    encoding="utf-8",
)
(ROOT / "embedded-assets.js").write_text(
    f"window.GIFCOLLAGE_EMBEDDED_ASSETS = {json.dumps(embedded_assets, indent=2)};\n",
    encoding="utf-8",
)
