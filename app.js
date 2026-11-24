const canvas = document.querySelector("#canvas");
const canvasWrap = document.querySelector(".canvas-wrap");
const collage = document.querySelector(".collage");
const main = document.querySelector("main");
const header = document.querySelector(".site-header");
const controls = document.querySelector(".controls");
const aspectRatioGroup = document.querySelector(".aspect-ratios");
const gifLayer = document.querySelector("#gif-layer");
const status = document.querySelector("#status");
const hint = document.querySelector("#canvas-hint");
const undoButton = document.querySelector("#undo");
const clearButton = document.querySelector("#clear");
const backgroundButton = document.querySelector("#background");
const exportToggle = document.querySelector("#export-toggle");
const exportPanel = document.querySelector("#export-panel");
const exportBackdrop = document.querySelector("#export-backdrop");
const exportCloseButton = document.querySelector("#export-close");
const exportSubmitButton = document.querySelector("#export-submit");
const exportFormatButtons = Array.from(document.querySelectorAll("[data-export-format]"));
const exportSizeButtons = Array.from(document.querySelectorAll("[data-export-size]"));
const gifQualityControls = document.querySelector("#gif-quality-controls");
const gifQualityInput = document.querySelector("#gif-quality");
const gifQualityValue = document.querySelector("#gif-quality-value");
const mp4DurationControls = document.querySelector("#mp4-duration-controls");
const mp4DurationInput = document.querySelector("#mp4-duration");
const mp4DurationValue = document.querySelector("#mp4-duration-value");
const exportEffectControls = document.querySelector("#export-effect-controls");
const exportEffectInput = document.querySelector("#export-effect");
const exportEffectValue = document.querySelector("#export-effect-value");
const aspectRatioButtons = Array.from(document.querySelectorAll(".aspect-ratios button"));

const exportFileTypes = {
  png: { filename: "gifcollage.png", description: "PNG image", mimeType: "image/png", extension: ".png" },
  jpg: { filename: "gifcollage.jpg", description: "JPEG image", mimeType: "image/jpeg", extension: ".jpg" },
  gif: { filename: "gifcollage.gif", description: "GIF image", mimeType: "image/gif", extension: ".gif" },
  mp4: { filename: "gifcollage.mp4", description: "MP4 video", mimeType: "video/mp4", extension: ".mp4" },
};

const UPWARD_RESIZE_RATE = 1 / 70; // Increase this value to make upward resizing faster.
const DOWNWARD_RESIZE_RATE = 1 / 180; // Increase this value to make downward resizing faster.
const GIF_EXPORT_SCALE = 0.5;
const GIF_EXPORT_FPS = 12;
const JPEG_QUALITY = 0.92;
const BAYER_MATRIX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const backgroundPalette = [
  "#f94144",
  "#f3722c",
  "#f9c74f",
  "#90be6d",
  "#43aa8b",
  "#577590",
  "#6d597a",
  "#b56576",
  "#ffafcc",
  "#4cc9f0",
  "#7b2cbf",
  "#ff0000",
  "#ff5900",
  "#ffb300",
  "#6fff00",
  "#00a272",
  "#0088ff",
  "#9900ff",
  "#ff009d",
  "#0d00ff",
  "#00c3ff",
  "#8800ff",
  "#00ffd5",
  "#000000",
  "#ffffff",
];
const BACKGROUND_TILE_SIZE = 100; // Adjust this value to change the size of each tiled background image.
const placedGifs = [];
let gifs = [];
let backgrounds = [];
let currentGif = null;
let pointer = null;
let lastGif = null;
let canvasBackground = { type: "solid", color: "#fff" };
let isExporting = false;
let selectedExportFormat = "png";
const exportSizes = { png: 1, jpg: 1, mp4: 1 };

function updateControls() {
  undoButton.disabled = placedGifs.length === 0;
  clearButton.disabled = placedGifs.length === 0;
}

function waitForImage(image, description) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error(`Could not load ${description} for export.`));
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => {
      reject(new Error(`Could not load ${description} for export.`));
    }, { once: true });
  });
}

async function prepareExportAssets() {
  const imagePromises = placedGifs.map((stamp) => waitForImage(stamp.image, stamp.gif.name));
  if (canvasBackground.type === "tile") {
    imagePromises.push(waitForImage(canvasBackground.image, "the canvas background"));
  }
  await Promise.all(imagePromises);
}

async function decodeGifAnimation(gif, width, height) {
  const response = await fetch(gif.url);
  if (!response.ok) {
    throw new Error(`Could not read ${gif.name} for animated export (HTTP ${response.status}).`);
  }

  const data = await response.arrayBuffer();
  if (typeof ImageDecoder === "function" && typeof ImageDecoder.isTypeSupported === "function"
      && await ImageDecoder.isTypeSupported("image/gif")) {
    return decodeGifAnimationWithImageDecoder(data, width, height);
  }
  return decodeGifAnimationWithOmggif(data, width, height);
}

async function decodeGifAnimationWithImageDecoder(data, width, height) {
  const decoder = new ImageDecoder({
    data,
    type: "image/gif",
  });
  const frames = [];
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.frameCount) {
      throw new Error(`No animation frames were found in ${gif.name}.`);
    }

    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameContext = frameCanvas.getContext("2d");
    if (!frameContext) {
      throw new Error("Could not create an image decoder canvas.");
    }

    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      try {
        const delayCentiseconds = image.duration > 0
          ? Math.max(1, Math.round(image.duration / 10_000))
          : 10;
        frameContext.clearRect(0, 0, width, height);
        frameContext.drawImage(image, 0, 0, width, height);
        const bitmap = await createImageBitmap(frameCanvas);
        frames.push({
          image: bitmap,
          delayCentiseconds,
          durationUs: delayCentiseconds * 10_000,
        });
      } finally {
        image.close();
      }
    }
  } catch (error) {
    for (const frame of frames) {
      frame.image.close();
    }
    throw error;
  } finally {
    decoder.close();
  }

  const durationCentiseconds = frames.reduce((total, frame) => total + frame.delayCentiseconds, 0);
  return {
    frames,
    durationCentiseconds,
    durationUs: durationCentiseconds * 10_000,
  };
}

async function decodeGifAnimationWithOmggif(data, width, height) {
  const bytes = new Uint8Array(data);
  const reader = new window.omggif.GifReader(bytes);
  const frameCount = reader.numFrames();
  if (!frameCount) {
    throw new Error("No animation frames were found in the GIF.");
  }

  const sourceWidth = reader.width;
  const sourceHeight = reader.height;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext("2d");
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext("2d");
  if (!sourceContext || !outputContext) {
    throw new Error("Could not create a GIF decoder canvas.");
  }

  const packedFields = bytes[10];
  const backgroundIndex = bytes[11];
  const hasGlobalPalette = (packedFields & 0x80) !== 0;
  const backgroundOffset = 13 + backgroundIndex * 3;
  const backgroundColor = hasGlobalPalette
    ? [bytes[backgroundOffset], bytes[backgroundOffset + 1], bytes[backgroundOffset + 2], 255]
    : [0, 0, 0, 0];
  const pixels = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
  const firstFrameInfo = reader.frameInfo(0);
  const initialBackground = firstFrameInfo.transparent_index === null
    ? backgroundColor
    : [0, 0, 0, 0];
  const fillFrameRectangle = (frame, color) => {
    for (let y = frame.y; y < frame.y + frame.height; y++) {
      for (let x = frame.x; x < frame.x + frame.width; x++) {
        const offset = (y * sourceWidth + x) * 4;
        pixels.set(color, offset);
      }
    }
  };
  fillFrameRectangle({ x: 0, y: 0, width: sourceWidth, height: sourceHeight }, initialBackground);

  const frames = [];
  let previousFrameInfo = null;
  let previousRestorePixels = null;
  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      if (previousFrameInfo?.disposal === 2) {
        const disposalBackground = previousFrameInfo.transparent_index === null
          ? backgroundColor
          : [0, 0, 0, 0];
        fillFrameRectangle(previousFrameInfo, disposalBackground);
      } else if (previousFrameInfo?.disposal === 3 && previousRestorePixels) {
        pixels.set(previousRestorePixels);
      }

      const frameInfo = reader.frameInfo(frameIndex);
      const restorePixels = frameInfo.disposal === 3 ? pixels.slice() : null;
      reader.decodeAndBlitFrameRGBA(frameIndex, pixels);
      const imageData = sourceContext.createImageData(sourceWidth, sourceHeight);
      imageData.data.set(pixels);
      sourceContext.putImageData(imageData, 0, 0);
      outputContext.clearRect(0, 0, width, height);
      outputContext.drawImage(sourceCanvas, 0, 0, width, height);

      const delayCentiseconds = frameInfo.delay > 0
        ? frameInfo.delay
        : 10;
      frames.push({
        image: await createImageBitmap(outputCanvas),
        delayCentiseconds,
        durationUs: delayCentiseconds * 10_000,
      });
      previousFrameInfo = frameInfo;
      previousRestorePixels = restorePixels;
    }
  } catch (error) {
    for (const frame of frames) {
      frame.image.close();
    }
    throw error;
  }

  const durationCentiseconds = frames.reduce((total, frame) => total + frame.delayCentiseconds, 0);
  return {
    frames,
    durationCentiseconds,
    durationUs: durationCentiseconds * 10_000,
  };
}

async function prepareStampAnimations() {
  const decodedBySize = new Map();
  const players = new Map();
  try {
    for (const stamp of placedGifs) {
      const size = sizeForWidth(stamp.gif, stamp.width);
      const width = Math.max(1, Math.round(size.width));
      const height = Math.max(1, Math.round(size.height));
      const key = `${stamp.gif.url}:${width}x${height}`;
      let animation = decodedBySize.get(key);
      if (!animation) {
        animation = await decodeGifAnimation(stamp.gif, width, height);
        decodedBySize.set(key, animation);
      }
      players.set(stamp, {
        ...animation,
        offsetUs: Math.max(0, (performance.now() - stamp.startedAt) * 1000),
      });
    }
  } catch (error) {
    const uniqueAnimations = new Set(decodedBySize.values());
    for (const animation of uniqueAnimations) {
      for (const frame of animation.frames) {
        frame.image.close();
      }
    }
    throw error;
  }
  return players;
}

function releaseStampAnimations(animationPlayers) {
  const released = new Set();
  for (const animation of animationPlayers.values()) {
    for (const frame of animation.frames) {
      if (!released.has(frame.image)) {
        frame.image.close();
        released.add(frame.image);
      }
    }
  }
}

function animationFrameAt(animation, elapsedUs) {
  const cycleTime = ((elapsedUs + animation.offsetUs) % animation.durationUs + animation.durationUs)
    % animation.durationUs;
  let frameEnd = 0;
  for (const frame of animation.frames) {
    frameEnd += frame.durationUs;
    if (cycleTime < frameEnd) {
      return frame;
    }
  }
  return animation.frames[animation.frames.length - 1];
}

function drawCanvasBackground(context) {
  const { width, height } = canvas;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  if (canvasBackground.type === "solid") {
    context.fillStyle = canvasBackground.color;
    context.fillRect(0, 0, width, height);
    return;
  }

  if (canvasBackground.type === "tile") {
    const pattern = context.createPattern(canvasBackground.image, "repeat");
    if (!pattern) {
      throw new Error("Could not create the tiled canvas background for export.");
    }
    const tileSize = BACKGROUND_TILE_SIZE * width / canvasWrap.clientWidth;
    const scaleX = tileSize / canvasBackground.image.naturalWidth;
    const scaleY = tileSize / canvasBackground.image.naturalHeight;
    context.save();
    context.scale(scaleX, scaleY);
    context.fillStyle = pattern;
    context.fillRect(0, 0, width / scaleX, height / scaleY);
    context.restore();
    return;
  }

  const colors = canvasBackground.colors;
  const gradient = canvasBackground.direction === "radial"
    ? context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width / 2, height / 2))
    : canvasBackground.direction === "vertical"
      ? context.createLinearGradient(0, 0, 0, height)
      : context.createLinearGradient(0, 0, width, 0);
  colors.forEach((color, index) => {
    gradient.addColorStop(index / (colors.length - 1), color);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawCollageFrame(context, elapsedUs = 0, animationPlayers = null) {
  drawCanvasBackground(context);
  for (const stamp of placedGifs) {
    const size = sizeForWidth(stamp.gif, stamp.width);
    const animation = animationPlayers?.get(stamp);
    const image = animation ? animationFrameAt(animation, elapsedUs).image : stamp.image;
    context.drawImage(
      image,
      stamp.x - size.width / 2,
      stamp.y - size.height / 2,
      size.width,
      size.height,
    );
  }
}

function createExportCanvas(willReadFrequently = false, scale = 1) {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const context = exportCanvas.getContext("2d", { alpha: false, willReadFrequently });
  if (!context) {
    throw new Error("Could not create an export canvas in this browser.");
  }
  context.scale(exportCanvas.width / canvas.width, exportCanvas.height / canvas.height);
  return { canvas: exportCanvas, context };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasToBlob(exportCanvas, mimeType, format, quality) {
  return new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(`Could not create the ${format} export.`));
      }
    }, mimeType, quality);
  });
}

function gifColorBits(quality) {
  const bits = [1, 1, 1];
  let remaining = 3 + Math.round(((quality - 1) / 99) * 5) - 3;
  const channels = [0, 1, 2, 0, 1];
  for (let index = 0; index < remaining; index++) {
    bits[channels[index]]++;
  }
  return bits;
}

function quantizeGifFrame(imageData, quality) {
  const [redBits, greenBits, blueBits] = gifColorBits(quality);
  const redLevels = 1 << redBits;
  const greenLevels = 1 << greenBits;
  const blueLevels = 1 << blueBits;
  const greenShift = blueBits;
  const redShift = greenBits + blueBits;
  const width = imageData.width;
  const height = imageData.height;
  const indices = new Uint8Array(width * height);
  const dither = 0.1 + ((100 - quality) / 99) * 0.9;
  const clamp = (value) => Math.max(0, Math.min(255, value));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      const threshold = (BAYER_MATRIX[y % 4][x % 4] / 16 - 0.5) * dither;
      const red = clamp(imageData.data[pixelOffset] + threshold * (255 / (redLevels - 1)));
      const green = clamp(imageData.data[pixelOffset + 1] + threshold * (255 / (greenLevels - 1)));
      const blue = clamp(imageData.data[pixelOffset + 2] + threshold * (255 / (blueLevels - 1)));
      const redIndex = Math.round((red / 255) * (redLevels - 1));
      const greenIndex = Math.round((green / 255) * (greenLevels - 1));
      const blueIndex = Math.round((blue / 255) * (blueLevels - 1));
      indices[y * width + x] = (redIndex << redShift) | (greenIndex << greenShift) | blueIndex;
    }
  }
  return indices;
}

function applyDitherPosterize(context, width, height, amount) {
  if (amount <= 0) {
    return;
  }

  const imageData = context.getImageData(0, 0, width, height);
  const quality = Math.max(1, 100 - amount);
  const [redBits, greenBits, blueBits] = gifColorBits(quality);
  const levels = [1 << redBits, 1 << greenBits, 1 << blueBits];
  const dither = 0.1 + ((100 - quality) / 99) * 0.9;
  const createLookup = (channelLevels) => Array.from({ length: 16 }, (_, phase) => {
    const threshold = (BAYER_MATRIX[Math.floor(phase / 4)][phase % 4] / 16 - 0.5) * dither;
    return Uint8Array.from({ length: 256 }, (_, value) => {
      const adjusted = Math.max(
        0,
        Math.min(255, value + threshold * (255 / (channelLevels - 1))),
      );
      const index = Math.round((adjusted / 255) * (channelLevels - 1));
      return Math.round((index * 255) / (channelLevels - 1));
    });
  });
  const [redLookup, greenLookup, blueLookup] = levels.map(createLookup);
  const pixels = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      const phase = ((y % 4) * 4) + (x % 4);
      pixels[pixelOffset] = redLookup[phase][pixels[pixelOffset]];
      pixels[pixelOffset + 1] = greenLookup[phase][pixels[pixelOffset + 1]];
      pixels[pixelOffset + 2] = blueLookup[phase][pixels[pixelOffset + 2]];
    }
  }

  context.putImageData(imageData, 0, 0);
}

function createGifEncoder(width, height, quality) {
  const bits = gifColorBits(quality);
  const totalBits = bits[0] + bits[1] + bits[2];
  const paletteSize = 1 << totalBits;
  const palette = [];

  for (let index = 0; index < paletteSize; index++) {
    const blueIndex = index & ((1 << bits[2]) - 1);
    const greenIndex = (index >> bits[2]) & ((1 << bits[1]) - 1);
    const redIndex = index >> (bits[1] + bits[2]);
    palette.push([
      Math.round((redIndex * 255) / ((1 << bits[0]) - 1)),
      Math.round((greenIndex * 255) / ((1 << bits[1]) - 1)),
      Math.round((blueIndex * 255) / ((1 << bits[2]) - 1)),
    ]);
  }

  const encoder = window.gifenc.GIFEncoder({
    initialCapacity: Math.max(4096, width * height),
  });
  let firstFrame = true;

  return {
    addFrame(indices, delayCentiseconds) {
      encoder.writeFrame(indices, width, height, {
        palette: firstFrame ? palette : undefined,
        repeat: firstFrame ? 0 : undefined,
        delay: Math.max(10, Math.round(delayCentiseconds * 10)),
        colorDepth: totalBits,
      });
      firstFrame = false;
    },
    finish() {
      encoder.finish();
      return new Blob([encoder.bytes()], { type: "image/gif" });
    },
  };
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
  };
}

function sizeForWidth(gif, width) {
  const aspectRatio = gif.image?.naturalWidth && gif.image?.naturalHeight
    ? gif.image.naturalWidth / gif.image.naturalHeight
    : 1;
  const height = width / aspectRatio;
  const fit = Math.min(1, canvas.width * 0.9 / width, canvas.height * 0.9 / height);
  return { width: width * fit, height: height * fit };
}

function positionGif(image, gif, x, y, width) {
  const size = sizeForWidth(gif, width);
  image.style.left = `${(x / canvas.width) * 100}%`;
  image.style.top = `${(y / canvas.height) * 100}%`;
  image.style.width = `${(size.width / canvas.width) * 100}%`;
}

function loadImage(gif) {
  if (gif.image) {
    return;
  }

  gif.image = new Image();
  gif.image.className = "gif-image gif-preview";
  gif.image.alt = "";
  gif.image.draggable = false;
  gif.image.onload = () => {
    updateGifLayer();
  };
  gif.image.onerror = () => {
    gif.failed = true;
    status.textContent = `Could not load ${gif.name}. Check that it is a valid GIF in GIFS/.`;
    if (currentGif === gif) {
      selectRandomGif();
    }
  };
  gif.image.src = gif.url;
}

function updateGifLayer() {
  for (const stamp of placedGifs) {
    positionGif(stamp.image, stamp.gif, stamp.x, stamp.y, stamp.width);
  }

  if (pointer && currentGif?.image) {
    positionGif(currentGif.image, currentGif, pointer.x, pointer.y, pointer.width);
    if (currentGif.image.parentElement !== gifLayer) {
      gifLayer.append(currentGif.image);
    }
  } else {
    currentGif?.image?.remove();
  }
}

function fitCanvasToViewport() {
  const mainStyles = window.getComputedStyle(main);
  const controlsStyles = window.getComputedStyle(controls);
  const aspectStyles = window.getComputedStyle(aspectRatioGroup);
  const statusStyles = window.getComputedStyle(status);
  const spacing = (styles, property) => Number.parseFloat(styles[property]) || 0;
  const reservedHeight = header.getBoundingClientRect().height
    + spacing(mainStyles, "paddingTop")
    + spacing(mainStyles, "paddingBottom")
    + controls.getBoundingClientRect().height
    + spacing(controlsStyles, "marginTop")
    + aspectRatioGroup.getBoundingClientRect().height
    + spacing(aspectStyles, "marginTop")
    + status.getBoundingClientRect().height
    + spacing(statusStyles, "marginTop");
  const availableHeight = Math.max(0, window.innerHeight - reservedHeight);
  const aspectRatio = canvas.width / canvas.height;
  const width = Math.min(collage.getBoundingClientRect().width, availableHeight * aspectRatio);

  canvasWrap.style.width = `${width}px`;
  canvasWrap.style.height = `${width / aspectRatio}px`;
}

function setCanvasAspectRatio(width, height) {
  const previousHeight = canvas.height;
  const nextHeight = Math.round((canvas.width * height) / width);
  const verticalScale = nextHeight / previousHeight;

  for (const stamp of placedGifs) {
    stamp.y *= verticalScale;
  }
  if (pointer) {
    pointer.y *= verticalScale;
  }

  canvas.height = nextHeight;
  canvasWrap.style.aspectRatio = `${width} / ${height}`;
  fitCanvasToViewport();
  updateGifLayer();
}

function selectRandomGif() {
  currentGif?.image?.remove();
  const candidates = gifs.filter((gif) => !gif.failed);
  if (!candidates.length) {
    currentGif = null;
    status.textContent = "No loadable GIFs remain. Check the GIFs in GIFS/.";
    return;
  }

  const alternatives = candidates.filter((gif) => gif !== lastGif);
  const pool = alternatives.length ? alternatives : candidates;
  currentGif = pool[Math.floor(Math.random() * pool.length)];
  lastGif = currentGif;
  loadImage(currentGif);
  updateGifLayer();
}

async function listDirectoryImages(directoryName, extensions) {
  const directoryUrl = new URL(`${directoryName}/`, window.location.href);
  const response = await fetch(directoryUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${directoryName}/ (HTTP ${response.status}).`);
  }

  const listing = await response.text();
  const directoryListing = new DOMParser().parseFromString(listing, "text/html");
  return Array.from(directoryListing.querySelectorAll("a[href]"))
    .map((link) => new URL(link.getAttribute("href"), directoryUrl))
    .filter((url) => {
      const relativePath = url.pathname.slice(directoryUrl.pathname.length);
      return url.origin === directoryUrl.origin
        && url.pathname.startsWith(directoryUrl.pathname)
        && !relativePath.includes("/")
        && extensions.some((extension) => url.pathname.toLowerCase().endsWith(extension));
    })
    .map((url) => ({
      url: url.href,
      name: decodeURIComponent(url.pathname.split("/").pop()),
    }));
}

function getBundledImages(assets) {
  return assets.map((asset) => {
    const path = typeof asset === "string" ? asset : asset.path;
    const url = window.location.protocol === "file:"
      ? window.GIFCOLLAGE_EMBEDDED_ASSETS?.[path]
      : new URL(path, document.baseURI).href;
    if (!url) {
      throw new Error(`Missing embedded image data for ${path}. Run generate_asset_manifest.py.`);
    }
    return {
      url,
      name: typeof asset === "string" ? path.split("/").pop() : asset.name,
    };
  });
}

async function listDirectoryImagesWithFallback(directoryName, extensions, bundledAssets) {
  const bundledImages = () => getBundledImages(bundledAssets);
  if (window.location.protocol === "file:") {
    return { images: bundledImages(), usedBundled: true };
  }

  try {
    const images = await listDirectoryImages(directoryName, extensions);
    if (images.length) {
      return { images, usedBundled: false };
    }
  } catch (error) {
    const fallbackImages = bundledImages();
    if (!fallbackImages.length) {
      throw error;
    }
    console.warn(`Could not list ${directoryName}/; using bundled assets instead.`, error);
    return { images: fallbackImages, usedBundled: true };
  }

  return { images: bundledImages(), usedBundled: true };
}

async function loadGifs() {
  let usedBundled = false;
  try {
    const result = await listDirectoryImagesWithFallback(
      "GIFS",
      [".gif"],
      window.GIFCOLLAGE_ASSETS.gifs,
    );
    usedBundled = result.usedBundled;
    gifs = result.images
      .map((gif) => ({ ...gif, image: null, failed: false }));
  } catch (error) {
    const message = "Could not load GIFS/ or the bundled GIF files.";
    status.textContent = message;
    hint.textContent = message;
    hint.hidden = false;
    console.error("Failed to load GIF assets.", error);
    fitCanvasToViewport();
    return;
  }

  if (!gifs.length) {
    hint.textContent = "Add .gif files to the GIFS/ folder, then refresh.";
    hint.hidden = false;
    status.textContent = "No GIF files found in GIFS/.";
    fitCanvasToViewport();
    return;
  }

  hint.hidden = true;
  const bundledMessage = usedBundled ? " Using bundled GIFs." : "";
  status.textContent = `${gifs.length} GIF${gifs.length === 1 ? "" : "s"} ready.${bundledMessage} Hover to preview; drag up or down to resize in place.`;
  fitCanvasToViewport();
  selectRandomGif();
}

async function loadBackgrounds() {
  try {
    const result = await listDirectoryImagesWithFallback("BACKGROUNDS", [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
    ], window.GIFCOLLAGE_ASSETS.backgrounds);
    backgrounds = result.images;
  } catch (error) {
    status.textContent = "Could not load BACKGROUNDS/ or the bundled background files; gradients are still available.";
    console.error("Failed to load background assets.", error);
  }
}

function updatePointer(event) {
  const isMouseEvent = event.type === "mousemove";
  if (pointer?.dragging && pointer.pointerId !== null
      && event.pointerId !== pointer.pointerId && !isMouseEvent) {
    return;
  }
  const point = canvasPoint(event);
  if (!pointer) {
    pointer = { ...point, width: 180, dragging: false };
  } else if (!pointer.dragging) {
    pointer.x = point.x;
    pointer.y = point.y;
  }

  if (pointer.dragging) {
    const dragDistance = pointer.startClientY - event.clientY;
    const resizeRate = dragDistance >= 0 ? UPWARD_RESIZE_RATE : DOWNWARD_RESIZE_RATE;
    const scale = Math.exp(dragDistance * resizeRate);
    pointer.width = Math.max(24, Math.min(1000, pointer.startWidth * scale));
  }
  updateGifLayer();
}

function beginStamp(event) {
  if (!currentGif || pointer?.dragging || event.button !== 0) {
    return;
  }

  event.preventDefault();
  const point = canvasPoint(event);
  pointer = {
    ...point,
    width: 180,
    startWidth: 180,
    startClientY: event.clientY,
    dragging: true,
    pointerId: Number.isInteger(event.pointerId) ? event.pointerId : null,
  };
  canvas.classList.add("is-resizing");
  document.body.classList.add("is-resizing");
  updateGifLayer();
}

canvas.addEventListener("pointerleave", () => {
  if (pointer && !pointer.dragging) {
    pointer = null;
    updateGifLayer();
  }
});

function finishStamp(event) {
 const isMouseEvent = event.type === "mouseup";
 if (!pointer?.dragging
     || (pointer.pointerId !== null && event.pointerId !== pointer.pointerId && !isMouseEvent)) {
    return;
  }

  canvas.classList.remove("is-resizing");
 document.body.classList.remove("is-resizing");
  const point = canvasPoint(event);
  const gif = currentGif;
  const image = new Image();
  image.className = "gif-image gif-stamp";
  image.alt = "";
  image.draggable = false;
  const stamp = {
    gif: currentGif,
    image,
    x: pointer.x,
    y: pointer.y,
    width: pointer.width,
    startedAt: performance.now(),
  };
  image.onload = () => {
    stamp.startedAt = performance.now();
  };
  image.onerror = () => {
    status.textContent = `Could not display stamped GIF ${gif.name}.`;
  };
  image.src = gif.url;

  placedGifs.push(stamp);
  gifLayer.append(image);
  updateControls();
  status.textContent = "GIF stamped. A new one is ready.";
  pointer = { ...point, width: 180, dragging: false };
  selectRandomGif();
}

canvas.addEventListener("pointerup", finishStamp);
window.addEventListener("pointerup", finishStamp);

function cancelStamp(event) {
  if (!pointer?.dragging
      || (pointer.pointerId !== null && event.pointerId !== pointer.pointerId)) {
    return;
  }
  canvas.classList.remove("is-resizing");
  document.body.classList.remove("is-resizing");
  pointer = null;
  updateGifLayer();
}

if ("PointerEvent" in window) {
  canvas.addEventListener("pointerdown", beginStamp);
  canvas.addEventListener("pointermove", updatePointer);
  window.addEventListener("pointermove", (event) => {
    if (pointer?.dragging && event.target !== canvas) {
      updatePointer(event);
    }
  });
  canvas.addEventListener("pointerup", finishStamp);
  window.addEventListener("pointerup", finishStamp);
  canvas.addEventListener("pointercancel", cancelStamp);
  window.addEventListener("pointercancel", cancelStamp);
}

canvas.addEventListener("mousedown", beginStamp);
canvas.addEventListener("mousemove", updatePointer);
window.addEventListener("mousemove", (event) => {
  if (pointer?.dragging && event.target !== canvas) {
    updatePointer(event);
  }
});
window.addEventListener("mouseup", finishStamp);
canvas.addEventListener("mouseleave", () => {
  if (pointer && !pointer.dragging) {
    pointer = null;
    updateGifLayer();
  }
});

undoButton.addEventListener("click", () => {
  placedGifs.pop()?.image.remove();
  updateControls();
});

clearButton.addEventListener("click", () => {
  for (const stamp of placedGifs) {
    stamp.image.remove();
  }
  placedGifs.length = 0;
  updateControls();
});

backgroundButton.addEventListener("click", () => {
  if (backgrounds.length && Math.random() < 0.5) {
    const background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    const image = new Image();
    image.src = background.url;
    canvasBackground = { type: "tile", image };
    canvasWrap.style.backgroundImage = `url("${background.url}")`;
    canvasWrap.style.backgroundColor = "#fff";
    canvasWrap.style.backgroundSize = `${BACKGROUND_TILE_SIZE}px`;
    canvasWrap.style.backgroundRepeat = "repeat";
    canvasWrap.style.backgroundPosition = "left top";
    status.textContent = `Background image selected: ${background.name}.`;
    return;
  }

  const colors = [...backgroundPalette];
  for (let index = colors.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [colors[index], colors[swapIndex]] = [colors[swapIndex], colors[index]];
  }

  const colorCount = 1 + Math.floor(Math.random() * 3);
  const gradientColors = colors.slice(0, colorCount);
  if (colorCount === 1) {
    canvasBackground = { type: "solid", color: gradientColors[0] };
    canvasWrap.style.backgroundImage = "none";
    canvasWrap.style.backgroundColor = gradientColors[0];
  } else {
    const colorStops = gradientColors.join(", ");
    const directions = ["horizontal", "vertical", "radial"];
    const gradientType = Math.floor(Math.random() * directions.length);
    const gradients = [
      `linear-gradient(to right, ${colorStops})`,
      `linear-gradient(to bottom, ${colorStops})`,
      `radial-gradient(circle, ${colorStops})`,
    ];
    canvasBackground = { type: "gradient", colors: gradientColors, direction: directions[gradientType] };
    canvasWrap.style.backgroundImage = gradients[gradientType];
    canvasWrap.style.backgroundColor = "#fff";
  }

  canvasWrap.style.backgroundSize = "auto";
  canvasWrap.style.backgroundRepeat = "no-repeat";
  canvasWrap.style.backgroundPosition = "center";
  status.textContent = "Canvas background changed.";
});

function openExportMenu() {
  exportPanel.hidden = false;
  exportBackdrop.hidden = false;
  exportToggle.setAttribute("aria-expanded", "true");
  exportCloseButton.focus();
}

function closeExportMenu() {
  exportPanel.hidden = true;
  exportBackdrop.hidden = true;
  exportToggle.setAttribute("aria-expanded", "false");
  exportToggle.focus();
}

async function exportPng(scale, effectAmount) {
  const { canvas: exportCanvas, context } = createExportCanvas(effectAmount > 0, scale);
  await prepareExportAssets();
  drawCollageFrame(context);
  applyDitherPosterize(context, exportCanvas.width, exportCanvas.height, effectAmount);
  return canvasToBlob(exportCanvas, "image/png", "PNG");
}

async function exportJpg(scale, effectAmount) {
  const { canvas: exportCanvas, context } = createExportCanvas(effectAmount > 0, scale);
  await prepareExportAssets();
  drawCollageFrame(context);
  applyDitherPosterize(context, exportCanvas.width, exportCanvas.height, effectAmount);
  return canvasToBlob(exportCanvas, "image/jpeg", "JPG", JPEG_QUALITY);
}

async function exportGif() {
  const { canvas: exportCanvas, context } = createExportCanvas(true, GIF_EXPORT_SCALE);
  const quality = Number(gifQualityInput.value);
  await prepareExportAssets();
  const animationPlayers = await prepareStampAnimations();
  try {
    const durationCentiseconds = 200;
    const frameCount = Math.round((durationCentiseconds / 100) * GIF_EXPORT_FPS);
    const encoder = createGifEncoder(exportCanvas.width, exportCanvas.height, quality);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const startCentiseconds = Math.round((frameIndex * durationCentiseconds) / frameCount);
      const endCentiseconds = Math.round(((frameIndex + 1) * durationCentiseconds) / frameCount);
      const frameTimeUs = (frameIndex * 1_000_000) / GIF_EXPORT_FPS;
      drawCollageFrame(context, frameTimeUs, animationPlayers);
      const indices = quantizeGifFrame(
        context.getImageData(0, 0, exportCanvas.width, exportCanvas.height),
        quality,
      );
      encoder.addFrame(indices, endCentiseconds - startCentiseconds);
      if (frameIndex % 4 === 0) {
        status.textContent = `Encoding GIF frame ${frameIndex + 1} of ${frameCount}...`;
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }
    return encoder.finish();
  } finally {
    releaseStampAnimations(animationPlayers);
  }
}

async function exportMp4(durationSeconds, scale, effectAmount) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream
      || typeof MediaRecorder.isTypeSupported !== "function") {
    throw new Error("This browser does not support canvas video recording.");
  }
  const mimeType = ["video/mp4;codecs=avc1.42E01E", "video/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    throw new Error("This browser cannot encode MP4. Try Safari or another browser with MP4 recording support.");
  }

  const { canvas: exportCanvas, context } = createExportCanvas(effectAmount > 0, scale);
  await prepareExportAssets();
  const animationPlayers = await prepareStampAnimations();
  let stream;
  let animationFrame;

  try {
    stream = exportCanvas.captureStream(24);
    const blob = await new Promise((resolve, reject) => {
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("error", (event) => {
        reject(event.error || new Error("The browser could not record the MP4."));
      });
      recorder.addEventListener("stop", () => {
        if (!chunks.length) {
          reject(new Error("The browser produced an empty MP4 export."));
          return;
        }
        resolve(new Blob(chunks, { type: mimeType }));
      });

      const startedAt = performance.now();
      const drawNextFrame = () => {
        const elapsed = performance.now() - startedAt;
        if (elapsed >= durationSeconds * 1000) {
          recorder.stop();
          return;
        }
        drawCollageFrame(context, elapsed * 1000, animationPlayers);
        applyDitherPosterize(context, exportCanvas.width, exportCanvas.height, effectAmount);
        animationFrame = window.requestAnimationFrame(drawNextFrame);
      };

      recorder.start();
      drawNextFrame();
    });

    return blob;
  } finally {
    window.cancelAnimationFrame(animationFrame);
    stream?.getTracks().forEach((track) => track.stop());
    releaseStampAnimations(animationPlayers);
  }
}

function getExportFile(format) {
  const file = exportFileTypes[format];
  if (format === "mp4") {
    const duration = Number(mp4DurationInput.value);
    return { ...file, filename: `gifcollage-${duration}-seconds.mp4` };
  }
  return file;
}

function requestSaveFile(format) {
  const file = getExportFile(format);
  if (window.location.protocol === "file:" || !window.isSecureContext
      || typeof window.showSaveFilePicker !== "function") {
    return Promise.resolve(null);
  }
  return window.showSaveFilePicker({
    suggestedName: file.filename,
    types: [{
      description: file.description,
      accept: { [file.mimeType]: [file.extension] },
    }],
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "SecurityError") {
      return null;
    }
    throw error;
  });
}

function setExportControlsDisabled(disabled) {
  for (const button of [...exportFormatButtons, ...exportSizeButtons]) {
    button.disabled = disabled;
  }
  gifQualityInput.disabled = disabled;
  mp4DurationInput.disabled = disabled;
  exportEffectInput.disabled = disabled;
}

async function exportCollage(format, saveHandlePromise) {
  if (isExporting) {
    return;
  }
  isExporting = true;
  setExportControlsDisabled(true);
  exportSubmitButton.disabled = true;

  try {
    const fileHandle = await saveHandlePromise;
    const durationSeconds = Number(mp4DurationInput.value);
    const scale = format === "gif" ? GIF_EXPORT_SCALE : exportSizes[format];
    const effectAmount = Number(exportEffectInput.value);
    status.textContent = format === "png"
      ? "Preparing PNG export..."
      : format === "jpg"
        ? "Preparing JPG export..."
      : format === "gif"
        ? "Encoding animated GIF..."
        : `Recording MP4 at 24 fps for ${durationSeconds} seconds...`;

    let blob;
    if (format === "png") {
      blob = await exportPng(scale, effectAmount);
    } else if (format === "jpg") {
      blob = await exportJpg(scale, effectAmount);
    } else if (format === "gif") {
      blob = await exportGif();
    } else {
      blob = await exportMp4(durationSeconds, scale, effectAmount);
    }

    const file = getExportFile(format);
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      status.textContent = `Saved ${file.filename}.`;
    } else {
      downloadBlob(blob, file.filename);
      status.textContent = typeof window.showSaveFilePicker === "function"
        ? `${file.filename} sent to your browser downloads.`
        : `${file.filename} sent to browser downloads. Set Safari to ask where to save each download to choose a location.`;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      status.textContent = "Export canceled.";
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Export failed: ${message}`;
    console.error("Canvas export failed.", error);
  } finally {
    isExporting = false;
    setExportControlsDisabled(false);
    exportSubmitButton.disabled = false;
  }
}

exportToggle.addEventListener("click", openExportMenu);
exportCloseButton.addEventListener("click", closeExportMenu);
exportBackdrop.addEventListener("click", closeExportMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !exportPanel.hidden) {
    closeExportMenu();
  }
});

gifQualityInput.addEventListener("input", () => {
  gifQualityValue.value = `${gifQualityInput.value}%`;
});

mp4DurationInput.addEventListener("input", () => {
  mp4DurationValue.value = `${mp4DurationInput.value} SEC`;
});

exportEffectInput.addEventListener("input", () => {
  exportEffectValue.value = `${exportEffectInput.value}%`;
});

function selectExportFormat(format) {
  selectedExportFormat = format;
  for (const button of exportFormatButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.exportFormat === format));
  }
  gifQualityControls.hidden = format !== "gif";
  mp4DurationControls.hidden = format !== "mp4";
  exportEffectControls.hidden = format === "gif";
}

for (const button of exportFormatButtons) {
  button.addEventListener("click", () => {
    selectExportFormat(button.dataset.exportFormat);
  });
}

for (const button of exportSizeButtons) {
  button.addEventListener("click", () => {
    const format = button.dataset.exportSize;
    exportSizes[format] = Number(button.dataset.scale);
    for (const sizeButton of exportSizeButtons) {
      if (sizeButton.dataset.exportSize === format) {
        sizeButton.setAttribute("aria-pressed", String(sizeButton === button));
      }
    }
  });
}

selectExportFormat(selectedExportFormat);
exportSubmitButton.addEventListener("click", () => {
  const format = selectedExportFormat;
  let saveHandlePromise;
  try {
    saveHandlePromise = requestSaveFile(format);
  } catch (error) {
    saveHandlePromise = Promise.reject(error);
  }
  closeExportMenu();
  exportCollage(format, saveHandlePromise);
});

for (const button of aspectRatioButtons) {
  button.addEventListener("click", () => {
    const baseWidth = Number(button.dataset.baseWidth);
    const baseHeight = Number(button.dataset.baseHeight);
    const inverted = button.dataset.inverted === "true";
    const width = inverted ? baseHeight : baseWidth;
    const height = inverted ? baseWidth : baseHeight;

    button.dataset.inverted = String(!inverted);
    button.textContent = `${width}:${height}`;
    for (const ratioButton of aspectRatioButtons) {
      ratioButton.setAttribute("aria-pressed", String(ratioButton === button));
    }

    setCanvasAspectRatio(width, height);
  });
}

window.addEventListener("resize", fitCanvasToViewport);
fitCanvasToViewport();
async function initializeAssets() {
  if (window.location.protocol === "file:") {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const embeddedAssetsUrl = new URL("embedded-assets.js", document.baseURI);
        embeddedAssetsUrl.searchParams.set("v", Date.now());
        script.src = embeddedAssetsUrl.href;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load embedded-assets.js."));
        document.head.append(script);
      });
    } catch (error) {
      const message = "Could not load embedded GIF data. Run generate_asset_manifest.py.";
      status.textContent = message;
      hint.textContent = message;
      hint.hidden = false;
      console.error("Failed to load local embedded assets.", error);
      return;
    }
  }

  await Promise.all([loadGifs(), loadBackgrounds()]);
}

initializeAssets();
