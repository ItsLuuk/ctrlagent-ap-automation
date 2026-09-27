import { describe, expect, it } from "bun:test";
import {
  processingFailureReason,
  processingFailureState,
  processingStageLabel,
} from "./processing-errors";

describe("processing failure communication", () => {
  it("names the user-facing stage", () => {
    expect(processingStageLabel("reading document")).toBe("Reading invoice fields");
    expect(processingStageLabel("AI reading document")).toBe("Reading invoice fields");
    expect(processingStageLabel("pdf worker startup")).toBe("Starting the PDF reader");
  });

  it("explains a PDF worker failure and offers recovery", () => {
    const reason = processingFailureReason(new Error("PDF worker failed to load"), "pdf worker");
    expect(reason).toContain("PDF reader");
    expect(reason).toContain("try again");
    expect(reason).not.toContain("undefined");
  });

  it("turns local persistence errors into an actionable reason", () => {
    const reason = processingFailureReason(
      new Error("IndexedDB quota exceeded"),
      "saving source file",
    );
    expect(reason).toContain("save the original file locally");
    expect(reason).toContain("disk space");
  });

  it("persists the raw failed stage alongside the safe state", () => {
    const failure = processingFailureState(
      new Error("worker failed"),
      "PDF worker startup",
      "started",
    );
    expect(failure.stage).toBe("queued");
    expect(failure.errorStage).toBe("PDF worker startup");
    expect(failure.error).toContain("PDF reader");
    expect(failure.startedAt).toBe("started");
  });

  it("does not expose a generic legacy failure message", () => {
    const reason = processingFailureReason(new Error("unexpected runtime failure"), "reading document");
    expect(reason).toContain("reading invoice fields");
    expect(reason).toContain("unexpected runtime failure");
    expect(reason).not.toBe("We couldn’t read this document");
  });
});
