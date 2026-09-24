import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(AP_DIR, "../../..");
const USE_CASE_DIR = resolve(AP_DIR, "use-cases");

const CORE_MODULES = [
  "src/lib/ap/business-registration.ts",
  "src/lib/ap/iban.ts",
  "src/lib/ap/line-item-extraction.ts",
  "src/lib/ap/mapping.ts",
  "src/lib/ap/state-machine.ts",
  "src/lib/ap/template-apply.ts",
  "src/lib/ap/template-lookup.ts",
  "src/lib/ap/types.ts",
  "src/lib/ap/vendor-master.ts",
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
  return Array.from(stripComments(source).matchAll(STATIC_IMPORT_PATTERN), (match) => match[1]);
}

function resolveDependency(owner: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;

  const base = resolve(dirname(resolve(REPO_ROOT, owner)), specifier);
  const resolved = [`${base}.ts`, resolve(base, "index.ts")].find(existsSync);
  return resolved ? toRepoPath(resolved) : toRepoPath(base);
}

function dependenciesFor(paths: readonly string[]): SourceDependency[] {
  return paths.flatMap((owner) =>
    staticDependencies(readSource(owner)).map((specifier) => ({ owner, specifier })),
  );
}

function assertDependenciesStayWithin(
  owners: readonly string[],
  allowed: ReadonlySet<string>,
): void {
  const violations = dependenciesFor(owners).filter(({ owner, specifier }) => {
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

  it("keeps OCR independent from the vendor profile persistence adapter", () => {
    const owner = "src/lib/ap/ocr.ts";
    const forbidden = new Set(["src/lib/ap/vendor-profile-store"]);
    const dependencies = staticDependencies(readSource(owner));

    expect(
      dependencies
        .map((specifier) => resolveDependency(owner, specifier))
        .filter((target): target is string => target !== null && forbidden.has(target)),
    ).toEqual([]);
  });
});
