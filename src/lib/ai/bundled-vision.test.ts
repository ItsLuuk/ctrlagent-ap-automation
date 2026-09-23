import { describe, expect, it } from "bun:test";
import { startVisionRuntime, type VisionRuntimeDeps } from "./bundled-vision";

type Script = {
  /** Probe answers for successive calls; last value repeats. */
  probeAnswers?: boolean[];
  /** Resolves when the fake runtime process exits; never = stays alive. */
  exits?: Promise<void>;
  spawnThrows?: boolean;
  resourceDirThrows?: boolean;
};

function makeDeps(script: Script = {}): VisionRuntimeDeps & { spawned: number } {
  const deps = {
    spawned: 0,
    isTauri: () => true,
    resourceDir: async () => {
      if (script.resourceDirThrows) throw new Error("no resource dir");
      return "C:/app/resources";
    },
    spawnRuntime: async () => {
      if (script.spawnThrows) throw new Error("command not allowed");
      deps.spawned += 1;
      return { closed: script.exits ?? new Promise<void>(() => {}) };
    },
    probe: async () => {
      const answers = script.probeAnswers ?? [true];
      const index = Math.min(probeCalls, answers.length - 1);
      probeCalls += 1;
      return answers[index]!;
    },
    delay: async () => {},
  };
  let probeCalls = 0;
  return deps;
}

describe("startVisionRuntime", () => {
  it("is a silent no-op in the browser", async () => {
    const deps = makeDeps();
    deps.isTauri = () => false;
    expect(await startVisionRuntime(deps)).toBe("browser");
    expect(deps.spawned).toBe(0);
  });

  it("reports bundled once our runtime answers the probe", async () => {
    const deps = makeDeps({ probeAnswers: [false, false, true] });
    expect(await startVisionRuntime(deps)).toBe("bundled");
    expect(deps.spawned).toBe(1);
  });

  it("reports external when ours dies because the port was already taken", async () => {
    let exit!: () => void;
    const exits = new Promise<void>((resolve) => {
      exit = resolve;
    });
    // First iteration: not yet exited, probe false → delay; exit wins next.
    const deps = makeDeps({ exits, probeAnswers: [false, true] });
    const pending = startVisionRuntime(deps);
    exit();
    expect(await pending).toBe("external");
  });

  it("reports external when spawn is refused but a user install answers", async () => {
    const deps = makeDeps({ spawnThrows: true, probeAnswers: [true] });
    expect(await startVisionRuntime(deps)).toBe("external");
    expect(deps.spawned).toBe(0);
  });

  it("falls back when nothing answers and nothing can start", async () => {
    const deps = makeDeps({ spawnThrows: true, probeAnswers: [false] });
    expect(await startVisionRuntime(deps)).toBe("fallback");
  });

  it("falls back when our runtime dies and the port is dead", async () => {
    let exit!: () => void;
    const exits = new Promise<void>((resolve) => {
      exit = resolve;
    });
    const deps = makeDeps({ exits, probeAnswers: [false] });
    const pending = startVisionRuntime(deps);
    exit();
    expect(await pending).toBe("fallback");
  });

  it("gives up after the probe budget instead of hanging startup", async () => {
    const deps = makeDeps({ probeAnswers: [false] });
    expect(await startVisionRuntime(deps)).toBe("fallback");
  });

  it("never throws, even when the resource directory is unavailable", async () => {
    const deps = makeDeps({ resourceDirThrows: true, probeAnswers: [false] });
    expect(await startVisionRuntime(deps)).toBe("fallback");
  });
});
