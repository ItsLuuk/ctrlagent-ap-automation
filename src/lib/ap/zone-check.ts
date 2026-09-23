async function readZoneText(image: Blob, zone: Zone): Promise<string | undefined> {
  const bitmap = await createImageBitmap(image);
  try {
    const padX = ZONE_PAD * bitmap.width;
    const padY = ZONE_PAD * bitmap.height;
    const x = Math.max(0, Math.round(zone.x * bitmap.width - padX));
    const y = Math.max(0, Math.round(zone.y * bitmap.height - padY));
    const w = Math.max(1, Math.min(bitmap.width - x, Math.round(zone.w * bitmap.width + 2 * padX)));
    const h = Math.max(
      1,
      Math.min(bitmap.height - y, Math.round(zone.h * bitmap.height + 2 * padY)),
    );
    // Per-zone crops are small, but keep the OffscreenCanvas discipline so the
    // backing store is not held by the main-thread compositor longer than needed.
    const offscreen = new OffscreenCanvas(w, h);
    const ctx = offscreen.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    const blob = await offscreen.convertToBlob({ type: "image/png" });
    if (!blob) return undefined;
    const { default: Tesseract } = await import("tesseract.js");
    const result = await Tesseract.recognize(blob, "eng+nld");
    const text = (result.data.text ?? "").trim().replace(/\s+/g, " ");
    return text || undefined;
  } finally {
    bitmap.close();
  }
}