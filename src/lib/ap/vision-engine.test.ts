/**
 * The port, exercised end to end.
 *
 * The VLM used to be a function call into the Gemma adapter, and the adapter
 * called back into `ocr.ts` for `ExtractedFields` — a cycle neither side could
 * be tested apart. Now the domain asks for a `VisionEngine` and the app
 * registers one, so this whole path can run on a fake: no Ollama, no browser,
 * no model.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { tryVlmPath } from "./ocr";
import {
  parseVisionPage,
  setVisionEngine,
  visionEngine,
  type VisionEngine,
  type VisionPageRequest,
  type VisionPageResult,
} from "./vision";

/** A page with its image already rendered, the way the pipeline hands them over. */
const page = {
  pageNumber: 1,
  text: "Factuur 2026-014 van Acme BV",
  words: [],
  method: "text-layer",
  image: new Blob(["page"]),
  visionB64: "cached-b64",
};

const readPage: VisionPageResult = {
  page: parseVisionPage(
    JSON.stringify({ vendor: "Acme BV", invoiceNumber: "2026-014", total: 100 }),
  ),
  model: "fake-vision-1b",
};

function fakeEngine(overrides: Partial<VisionEngine> = {}): VisionEngine {
  return {
    id: "fake",
    modelName: () => "fake-vision-1b",
    modelOrder: () => ["fake-vision-1b"],
    healthy: async () => true,
    encodePageImage: async () => "encoded-b64",
    extractPage: async () => readPage,
    ...overrides,
  };
}

const SRC_ROOT = resolve(import.meta.dir, "../..");

describe("the composition roots", () => {
  // Registration is the one thing that cannot be inferred from a type: forget
  // it and vision silently degrades to "no model on this machine" in
  // production while every test still passes.
  for (const root of ["routes/__root.tsx", "tauri/root.tsx"]) {
    it(`${root} registers a vision engine`, () => {
      expect(readFileSync(resolve(SRC_ROOT, root), "utf8")).toContain("registerVisionEngine()");
    });
  }
});

describe("the engine registry", () => {
  afterEach(() => setVisionEngine(undefined));

  it("is empty until a composition root registers an adapter", () => {
    expect(visionEngine()).toBeUndefined();
  });

  it("hands back the engine the app registered", () => {
    const engine = fakeEngine();
    setVisionEngine(engine);
    expect(visionEngine()).toBe(engine);
  });

  it("can be cleared, so one test never inherits another's engine", () => {
    setVisionEngine(fakeEngine());
    setVisionEngine(undefined);
    expect(visionEngine()).toBeUndefined();
  });
});

describe("the OCR pipeline reads vision through the port", () => {
  afterEach(() => setVisionEngine(undefined));

  it("reads text only when no composition root registered an engine", async () => {
    expect(await tryVlmPath([page], undefined, undefined)).toBeUndefined();
  });

  it("asks the registered engine and takes the fields it read", async () => {
    let asked: VisionPageRequest | undefined;
    setVisionEngine(
      fakeEngine({
        extractPage: async (request) => {
          asked = request;
          return readPage;
        },
      }),
    );

    const result = await tryVlmPath([page], undefined, undefined);

    expect(asked?.imageB64).toBe("cached-b64");
    expect(asked?.page).toBe(1);
    expect(asked?.totalPages).toBe(1);
    expect(result?.fields.vendor).toBe("Acme BV");
    expect(result?.fields.total).toBe(100);
    expect(result?.model).toBe("fake-vision-1b");
    expect(result?.provenance.vendor).toBe("read");
    expect(result?.fieldSources.vendor).toBe(1);
  });

  it("never calls an engine that reports itself unhealthy", async () => {
    let called = false;
    setVisionEngine(
      fakeEngine({
        healthy: async () => false,
        extractPage: async () => {
          called = true;
          return readPage;
        },
      }),
    );

    expect(await tryVlmPath([page], undefined, undefined)).toBeUndefined();
    expect(called).toBe(false);
  });
});
