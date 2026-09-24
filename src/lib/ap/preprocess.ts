/**
 * Tauri WebView-side image preprocessing for the invoice pipeline. The rework
 * doc calls for deskew + binarize at ~300 DPI; we can't pull OpenCV into the
 * WebView bundle without bloating it, so we approximate the cheap 80% of the
 * win with canvas + the Sauvola-style adaptive threshold below.
 *
 * This is intentionally tiny: the heavy lifting still belongs to the VLM path.
 * The preprocess step here just makes downstream OCR cheaper and more stable
 * so the template path can match a fingerprint with confidence.
 */

/** Target long-edge DPI equivalent in pixels for a typical A4 page. */
const TARGET_LONG_EDGE = 2200; // ~290 DPI on the long edge of an A4 at 72dpi base.

/** Returns a fresh JPEG blob resized to roughly 300 DPI on the long edge. */
export async function normalizeTo300Dpi(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return source;
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge >= TARGET_LONG_EDGE ? 1 : TARGET_LONG_EDGE / longEdge;
  if (scale === 1) {
    bitmap.close();
    return source;
  }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return source;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  canvas.width = canvas.height = 0;
  return out ?? source;
}

/**
 * Coarse deskew by projection profile. Returns the angle in degrees (positive =
 * counter-clockwise) needed to rotate the image back to upright. Anything under
 * 0.3° is returned as 0 — below that, the OCR pipeline is more accurate when
 * we don't waste pixels on rotation.
 */
export async function estimateSkew(source: Blob): Promise<number> {
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return 0;
  // Downsample aggressively; skew is detectable at 200px wide.
  const targetW = 240;
  const scale = targetW / bitmap.width;
  const w = targetW;
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return 0;
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  // Binarize at 180 — anything darker is ink.
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const v = (r * 299 + g * 587 + b * 114) / 1000;
    binary[i] = v < 180 ? 1 : 0;
  }
  // Project onto horizontal axis at candidate angles and pick the one with
  // the sharpest peak (the ink rows align when the page is straight).
  const candidates = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3];
  let bestAngle = 0;
  let bestScore = -Infinity;
  for (const angle of candidates) {
    const score = projectionScore(binary, w, h, angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  canvas.width = canvas.height = 0;
  return Math.abs(bestAngle) < 0.3 ? 0 : bestAngle;
}

function projectionScore(binary: Uint8Array, w: number, h: number, angleDeg: number): number {
  // Rotate by shearing (cheap; good enough for ±3°).
  const rad = (angleDeg * Math.PI) / 180;
  const tan = Math.tan(rad / 2);
  const buf1 = new Uint8Array(w * h);
  shearX(binary, buf1, w, h, tan);
  const buf2 = new Uint8Array(w * h);
  shearX(buf1, buf2, w, h, -Math.sin(rad));
  const buf3 = new Uint8Array(w * h);
  shearX(buf2, buf3, w, h, tan);
  // Variance of row sums — sharp text lines give high variance.
  const rowSums = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += buf3[y * w + x]!;
    rowSums[y] = s;
  }
  let mean = 0;
  for (const s of rowSums) mean += s;
  mean /= h;
  let variance = 0;
  for (const s of rowSums) variance += (s - mean) ** 2;
  return variance / h;
}

function shearX(src: Uint8Array, dst: Uint8Array, w: number, h: number, offset: number): void {
  for (let y = 0; y < h; y++) {
    const dx = Math.round(offset * (h / 2 - y));
    for (let x = 0; x < w; x++) {
      const sx = x + dx;
      if (sx >= 0 && sx < w) dst[y * w + x] = src[y * w + sx]!;
    }
  }
}

/** Rotates an image by `angleDeg` (counter-clockwise) and returns a JPEG blob. */
export async function rotateImage(source: Blob, angleDeg: number): Promise<Blob> {
  if (!angleDeg) return source;
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return source;
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = Math.ceil(bitmap.width * cos + bitmap.height * sin);
  const h = Math.ceil(bitmap.width * sin + bitmap.height * cos);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return source;
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-rad);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  canvas.width = canvas.height = 0;
  return out ?? source;
}

/**
 * Sauvola-style adaptive binarization. Returns a 1-bit PNG blob. We keep this
 * here so the OCR pass gets a clean signal even on bad scans.
 */
export async function binarize(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return source;
  // Cap at 1200px on the long edge — binarization is O(N) and we just need a
  // good signal for the next stage.
  const longEdge = 1200;
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return source;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  // Local mean via a fast box blur (3-pass separable would be smoother; we
  // accept a small loss for a much smaller bundle).
  const window = Math.max(15, Math.round(Math.min(w, h) * 0.04));
  const mean = boxBlur(gray, w, h, window);
  const out = new Uint8ClampedArray(w * h * 4);
  const k = 0.2;
  for (let i = 0; i < gray.length; i++) {
    const m = mean[i]!;
    const threshold = m * (1 + k * ((gray[i]! - m) / 128 - 1));
    const v = gray[i]! < threshold ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  const imageData = new ImageData(out, w, h);
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = canvas.height = 0;
  return blob ?? source;
}

function boxBlur(src: Uint8ClampedArray, w: number, h: number, window: number): Uint8ClampedArray {
  const half = Math.floor(window / 2);
  const tmp = new Float64Array(w * h);
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -half; x <= half; x++) {
      const sx = Math.min(w - 1, Math.max(0, x));
      sum += src[y * w + sx]!;
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / window;
      const add = Math.min(w - 1, Math.max(0, x + half + 1));
      const sub = Math.min(w - 1, Math.max(0, x - half));
      sum += src[y * w + add]! - src[y * w + sub]!;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -half; y <= half; y++) {
      const sy = Math.min(h - 1, Math.max(0, y));
      sum += tmp[sy * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / window);
      const add = Math.min(h - 1, Math.max(0, y + half + 1));
      const sub = Math.min(h - 1, Math.max(0, y - half));
      sum += tmp[add * w + x]! - tmp[sub * w + x]!;
    }
  }
  return out;
}

/** Convenience: deskew + resize + binarize pipeline. */
export async function preprocess(source: Blob): Promise<Blob> {
  const resized = await normalizeTo300Dpi(source);
  const angle = await estimateSkew(resized);
  const rotated = angle ? await rotateImage(resized, angle) : resized;
  return binarize(rotated);
}
