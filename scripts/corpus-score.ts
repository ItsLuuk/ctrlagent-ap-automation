#!/usr/bin/env bun
/**
 * Corpus scoring helpers — shared contract between the corpus runner and the
 * golden-corpus test so both sides of the measurement use the same types.
 */
export type FieldCompare = "correct" | "wrong" | "missing" | "unexpected" | "absent";

export type Counts = { correct: number; wrong: number; missing: number; unexpected: number };

export type ProducerReport = {
  producer: string;
  invoiceCount: number;
  scoredCount: number;
  skippedCount: number;
  methodCounts: Record<string, number>;
  counts: Counts;
  precision: number;
  recall: number;
  f1: number;
  vlmSkipRate: number;
  vlmSkipCount: number;
  failureByField: Record<string, { missing: number; wrong: number }>;
  invoices: Array<{
    file: string;
    producer: string | null;
    creator: string | null;
    method: "text-layer" | "image-only" | "mixed" | "none";
    elapsedMs: number;
    skipped: boolean;
    skipReason?: string;
    counts: Counts;
    outcomes: Record<string, FieldCompare>;
    criticalMissing: string[];
    criticalOk: string[];
  }>;
};

export type OverallReport = {
  counts: Counts;
  precision: number;
  recall: number;
  f1: number;
  vlmSkipRate: number;
  vlmSkipCount: number;
  scoredCount: number;
  methodCounts: Record<string, number>;
  failureByField: Record<string, { missing: number; wrong: number }>;
};
