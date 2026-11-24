# GIFCOLLAGE

Open `index.html` directly in Safari or another browser. The GIFs and background images are embedded in `embedded-assets.js`, which is loaded only for `file://` pages so local use does not need a web server. GitHub Pages uses the small path-only `asset-manifest.js` and loads the image files directly.

Browsers do not allow a page opened from a file to scan a folder automatically, and static hosts such as GitHub Pages do not provide folder listings. After adding or removing GIFs or backgrounds, run `python3 generate_asset_manifest.py` to refresh both manifests. The app uses folder discovery when available and falls back to the path manifest on static hosts.

Safari does not provide the web Save File Picker API, so exports use Safari's normal download behavior. To choose a save location each time, set Safari > Settings > General > File download location to **Ask for each download**.

Hover over the canvas to preview the current GIF. Drag upward to enlarge it or downward to shrink it; it stays anchored at the point where you started dragging. Release to stamp it there, even if you finish the drag outside the canvas. Stamped GIFs keep animating. Use **Undo** or **Clear** to remove stamps.

GIFs play as native images over the canvas. Files containing only one frame will appear still.

Use the aspect-ratio buttons below **Undo** and **Clear** to resize the canvas. Click a ratio again to switch to its inverse; the button label shows the current orientation.

Click **background** to randomly apply either a horizontal, vertical, or radial gradient with one to three colors, or a tiled image from `BACKGROUNDS/`. Adjust `BACKGROUND_TILE_SIZE` in `app.js` to change the image tile size.

Open the export menu, select PNG, JPG, GIF, or MP4, then press **Export**. PNG, JPG, and MP4 each have full- and half-resolution options. GIF is always half-resolution and loops for two seconds at 12 FPS; GIF's 10 ms delay increments mean timing is approximate. MP4 duration is adjustable from one to ten seconds and records at 24 FPS. PNG, JPG, and MP4 have a dithering/posterization slider; GIF has its own quality slider. Animated exports use the browser's GIF `ImageDecoder` when available and the bundled decoder otherwise. MP4 requires a browser with recording support. Supported browsers open a save dialog for the filename and location; otherwise the browser handles the download.

GIF encoding uses the vendored `gifenc` 1.0.3 library. GIF exports are rendered at half the canvas width and height. Its MIT license is in `vendor/gifenc-LICENSE.md`. Animated exports use the browser's `ImageDecoder` when available and fall back to the vendored `omggif` decoder for browsers such as Safari that do not support it. Its MIT license is in `vendor/omggif-LICENSE.md`. Both libraries run locally without a worker or server.
