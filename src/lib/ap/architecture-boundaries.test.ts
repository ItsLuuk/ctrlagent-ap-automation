import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(AP_DIR, "../../..");
const USE_CASE_DIR = resolve(AP_DIR, "use-cases");

const CORE_MODULES = [
  "src/lib/ap/anomalies.ts",
  "src/lib/ap/audit-evidence.ts",
  "src/lib/ap/auto-tags.ts",
  "src/lib/ap/business-registration.ts",
  "src/lib/ap/demo-data.ts",
  "src/lib/ap/consolidated.ts",
  "src/lib/ap/duplicate-detection.ts",
  "src/lib/ap/entities.ts",
  "src/lib/ap/file-hash.ts",
  "src/lib/ap/fx.ts",
  "src/lib/ap/flex-matching.ts",
  "src/lib/ap/field-shape.ts",
  "src/lib/ap/gl-coding.ts",
  "src/lib/ap/iban.ts",
  "src/lib/ap/line-item-extraction.ts",
  "src/lib/ap/mapping-proposals.ts",
  "src/lib/ap/mapping.ts",
  "src/lib/ap/matching.ts",
  "src/lib/ap/purchase-order.ts",
  "src/lib/ap/samples.ts",
  "src/lib/ap/sod.ts",
  "src/lib/ap/state-machine.ts",
  "src/lib/ap/template-apply.ts",
  "src/lib/ap/template-lookup.ts",
  "src/lib/ap/tax.ts",
  "src/lib/ap/types.ts",
  "src/lib/ap/vat-collector.ts",
  "src/lib/ap/vendor-baseline.ts",
  "src/lib/ap/vendor-bank-changes.ts",
  "src/lib/ap/vendor-master.ts",
  "src/lib/ap/vocabulary.ts",
  "src/lib/ap/vision.ts",
  "src/lib/ap/zones.ts",
] as const;

const STATIC_IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;

type SourceDependency = {
  owner: string;
  specifier: string;
};

function toRepoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function readSource(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

function staticDependencies(source: string): string[] {
  return Array.from(stripComments(source).matchAll(STATIC_IMPORT_PATTERN), (match) => match[1]!);
}

function resolveDependency(owner: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;

  const base = resolve(dirname(resolve(REPO_ROOT, owner)), specifier);
  const resolved = [`${base}.ts`, resolve(base, "index.ts")].find(existsSync);
  return resolved ? toRepoPath(resolved) : toRepoPath(base);
}

/** Resolves both relative and `@/lib/ap/*` specifiers, for the persistence rule. */
function resolveDomainImport(owner: string, specifier: string): string | null {
  const aliasPrefix = "@/lib/ap/";
  if (specifier.startsWith(aliasPrefix)) {
    const base = `src/lib/ap/${specifier.slice(aliasPrefix.length)}`;
    const resolved = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
    return resolved ?? base;
  }
  if (!specifier.startsWith(".")) return null;

  const base = resolve(dirname(resolve(REPO_ROOT, owner)), specifier);
  const resolved = [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find(existsSync);
  return resolved ? toRepoPath(resolved) : toRepoPath(base);
}

/**
 * The persistence adapters — localStorage-backed modules. Nothing inward may
 * import these: a domain rule that reads storage is a rule you can no longer
 * test or swap. The dependency points from adapter to domain, never back.
 */
const PERSISTENCE_ADAPTERS: ReadonlySet<string> = new Set([
  "src/lib/ap/file-hash-gate.ts",
  "src/lib/ap/file-store.ts",
  "src/lib/ap/flex-store.ts",
  "src/lib/ap/po-store.ts",
  "src/lib/ap/template-store.ts",
  "src/lib/ap/vendor-profile-store.ts",
]);

/** The only modules allowed to depend on persistence: the application layer
 *  (React store, background jobs) and the adapters themselves. */
const PERSISTENCE_CONSUMERS: ReadonlySet<string> = new Set([
  "src/lib/app/store.tsx",
  "src/lib/app/upload-jobs.tsx",
  ...PERSISTENCE_ADAPTERS,
]);

/** Every non-test module directly under `src/lib/ap`. */
function domainModules(): string[] {
  return readdirSync(AP_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !entry.name.includes(".test.") &&
        !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => toRepoPath(resolve(AP_DIR, entry.name)))
    .sort();
}

function dependenciesFor(paths: readonly string[]): SourceDependency[] {
  return paths.flatMap((owner) =>
    staticDependencies(readSource(owner)).map((specifier) => ({ owner, specifier })),
  );
}

/**
 * Third-party packages are not dependencies between our modules. The rule is
 * about our own layering, so a domain module may use a library (`zod` for the
 * model-output contract in `vision.ts`) as long as it reaches no other layer.
 * Kept as an explicit list: adding a package is a decision, not a side effect.
 */
const EXTERNAL_PACKAGES: ReadonlySet<string> = new Set(["zod"]);

function assertDependenciesStayWithin(
  owners: readonly string[],
  allowed: ReadonlySet<string>,
): void {
  const violations = dependenciesFor(owners).filter(({ owner, specifier }) => {
    if (EXTERNAL_PACKAGES.has(specifier)) return false;
    const target = resolveDependency(owner, specifier);
    return target === null || !allowed.has(target);
  });

  expect(violations).toEqual([]);
}

function useCaseModules(): string[] {
  return readdirSync(USE_CASE_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => toRepoPath(resolve(USE_CASE_DIR, entry.name)))
    .sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
}

const BROWSER_API_RULES = [
  { label: "localStorage", pattern: /\blocalStorage\b/ },
  { label: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { label: "indexedDB", pattern: /\bindexedDB\b/ },
  {
    label: "window",
    pattern:
      /\bwindow\s*\.\s*(?:document|location|localStorage|sessionStorage|indexedDB|navigator|setTimeout|setInterval|requestAnimationFrame|addEventListener|fetch)\b/,
  },
  { label: "document", pattern: /\bdocument\s*(?:\.|\[)/ },
] as const;

function findBrowserApiViolations(paths: readonly string[]): string[] {
  return paths.flatMap((owner) => {
    const source = stripComments(readSource(owner));
    return BROWSER_API_RULES.filter(({ pattern }) => pattern.test(source)).map(
      ({ label }) => `${owner} uses ${label}`,
    );
  });
}

/** Every source file anywhere under the domain directory. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [toRepoPath(path)] : [];
  });
}

/** UI runtimes belong to the outer circle — the domain must not need them. */
const UI_RUNTIME_PATTERN = /["'](?:react(?:-dom)?(?:\/[^"']*)?|sonner|@tanstack\/react-[^"']*)["']/;

/**
 * Adapters are registered, never imported. The domain owns the `VisionEngine`
 * port; the app supplies the implementation from a composition root, so
 * `ocr.ts` and the model client can no longer import each other.
 *
 * `src/lib/ap/eval` is a CLI harness that drives the adapter itself and is
 * outside this rule — like `use-cases`, it is not a domain module.
 */
const ADAPTER_IMPORT_PATTERN = /(?:^|\/)ai\//;

describe("AP architecture boundaries", () => {
  it("keeps core modules dependent only on the domain core", () => {
    assertDependenciesStayWithin(CORE_MODULES, new Set(CORE_MODULES));
  });

  it("keeps core modules free of browser and persistence APIs", () => {
    expect(findBrowserApiViolations(CORE_MODULES)).toEqual([]);
  });

  it("keeps use cases dependent only on the domain core", () => {
    const useCases = useCaseModules();

    expect(useCases.length).toBeGreaterThan(0);
    assertDependenciesStayWithin(useCases, new Set(CORE_MODULES));
  });

  it("keeps use cases free of browser and persistence APIs", () => {
    expect(findBrowserApiViolations(useCaseModules())).toEqual([]);
  });

  it("keeps React in the outer circle", () => {
    const files = sourceFilesUnder(AP_DIR);
    const componentFiles = files.filter((file) => file.endsWith(".tsx"));
    const uiRuntimeImports = files.filter((file) =>
      UI_RUNTIME_PATTERN.test(stripComments(readSource(file))),
    );

    expect({ componentFiles, uiRuntimeImports }).toEqual({
      componentFiles: [],
      uiRuntimeImports: [],
    });
  });

  it("keeps the AI adapter out of the domain", () => {
    const violations = domainModules().flatMap((owner) =>
      staticDependencies(readSource(owner))
        .filter((specifier) => ADAPTER_IMPORT_PATTERN.test(specifier))
        .map((specifier) => `${owner} imports ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("keeps persistence behind the application layer", () => {
    const violations = domainModules()
      .filter((owner) => !PERSISTENCE_CONSUMERS.has(owner))
      .flatMap((owner) =>
        staticDependencies(readSource(owner))
          .map((specifier) => resolveDomainImport(owner, specifier))
          .filter(
            (target): target is string =>
              target !== null && PERSISTENCE_ADAPTERS.has(target),
          )
          .map((target) => `${owner} imports ${target}`),
      );

    expect(violations).toEqual([]);
  });

  it("keeps OCR independent from the persistence adapters", () => {
    const owner = "src/lib/ap/ocr.ts";
    const dependencies = staticDependencies(readSource(owner));

    expect(
      dependencies
        .map((specifier) => resolveDomainImport(owner, specifier))
        .filter(
          (target): target is string =>
            target !== null && PERSISTENCE_ADAPTERS.has(target),
        ),
    ).toEqual([]);
  });
});
