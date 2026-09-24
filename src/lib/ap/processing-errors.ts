import type { ProcessingState } from "./types";

/** Convert an internal pipeline stage into the wording a customer should see. */
export function processingStageLabel(stage: string | undefined): string {
  const value = stage?.toLowerCase() ?? "";
  if (value.includes("upload")) return "Opening the uploaded file";
  if (value.includes("layout") || value.includes("ocr")) return "Reading the page layout";
  if (value.includes("preprocess")) return "Preparing the document";
  if (value.includes("matching") || value.includes("template")) {
    return "Matching the vendor template";
  }
  if (value.includes("ai") || value.includes("vlm")) return "Reading invoice fields";
  if (value.includes("final")) return "Saving the extracted fields";
  if (value.includes("pdf") || value.includes("worker")) return "Starting the PDF reader";
  return stage
    ? stage.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Processing the document";
}

/**
 * Turn runtime/import/PDF errors into a short reason that tells the user what
 * happened without exposing a stack trace or reducing every failure to a
 * generic toast.
 */
export function processingFailureReason(error: unknown, stage?: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const normalized = message.toLowerCase();
  const where = processingStageLabel(stage).toLowerCase();

  if (normalized.includes("node:") || normalized.includes("externalized for")) {
    return `The document reader tried to load a desktop-only module while ${where}. Restart Foundry and try again.`;
  }
  if (normalized.includes("worker") || normalized.includes("pdfjs") || normalized.includes("pdf")) {
    return `The PDF reader could not start while ${where}. The file is still saved; try again or review it manually.`;
  }
  if (normalized.includes("password") || normalized.includes("encrypted")) {
    return "This document is password-protected. Remove the password and upload it again.";
  }
  if (normalized.includes("memory") || normalized.includes("out of memory")) {
    return "This document is too large to read in one pass. Try a smaller or flattened PDF.";
  }
  if (normalized.includes("unsupported") || normalized.includes("file type")) {
    return "This file type is not supported. Upload a PDF, PNG, or JPG invoice.";
  }
  if (
    normalized.includes("indexeddb") ||
    normalized.includes("storage") ||
    normalized.includes("quota")
  ) {
    return "Foundry could not save the original file locally. Check available disk space and local storage permissions, then try again.";
  }
  if (normalized.includes("empty") || normalized.includes("no pages")) {
    return "The document contains no readable pages. Upload a non-empty PDF or image.";
  }

  const cleaned = message.replace(/\s+/g, " ").trim();
  if (cleaned && cleaned !== "Unknown error") {
    return `The processor stopped while ${where}: ${cleaned.slice(0, 220)}`;
  }
  return `The processor stopped while ${where}. The original file is saved; try again or review it manually.`;
}

export function processingFailureState(
  error: unknown,
  stage: string | undefined,
  startedAt = new Date().toISOString(),
): ProcessingState {
  return {
    stage: stageToProcessingState(stage),
    progress: 0,
    background: true,
    error: processingFailureReason(error, stage),
    errorStage: stage,
    startedAt,
  };
}

export function stageToProcessingState(stage: string | undefined): ProcessingState["stage"] {
  const value = stage?.toLowerCase() ?? "";
  if (value.includes("preprocess")) return "preprocessing";
  if (value.includes("matching") || value.includes("template")) return "matching vendor";
  if (value.includes("ai") || value.includes("vlm")) return "ai reading";
  if (value.includes("final")) return "finalizing";
  return "queued";
}
