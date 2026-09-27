/**
 * Shared file-type detection for invoice source documents.
 *
 * `File.type` is unreliable: drag-dropped PDFs on some OS/browser combos
 * arrive with an empty `type`, while the upload pipeline (`ocr.ts`) already
 * detects PDFs by filename fallback. The overlay/preview code must use the
 * same logic or PDFs get misclassified as "unsupported file type" even when
 * the file itself is fine.
 */
export function isPdfInvoice(fileType: string | undefined, fileName?: string | undefined): boolean {
  if (fileType === "application/pdf") return true;
  return !!fileName && /\.pdf$/i.test(fileName);
}

export function isImageInvoice(
  fileType: string | undefined,
  fileName?: string | undefined,
): boolean {
  if (fileType?.startsWith("image/")) return true;
  return !!fileName && /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(fileName);
}
