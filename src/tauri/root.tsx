import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { ErrorScreen, NotFoundScreen } from "@/components/ap/route-fallback";
import { ApProvider } from "@/lib/ap/store";
import { UploadJobsProvider } from "@/lib/ap/upload-jobs";
import { tauriQueryClient } from "./query-client";

const BUILD_HASH = import.meta.env["VITE_TAURI_BUILD_HASH"] || "dev";
const BUILD_ID = import.meta.env["VITE_TAURI_BUILD_ID"] || "browser";
const BUILD_COMMIT = import.meta.env["VITE_TAURI_COMMIT"] || "working-tree";
const IS_DEV = import.meta.env.DEV;

function BuildIdentity() {
  const [nativeBuildId, setNativeBuildId] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string>("native_build_id")
      .then(setNativeBuildId)
      .catch(() => undefined);
  }, []);

  // `tauri dev` intentionally runs the Vite frontend and an unversioned native
  // binary together, so their ids are expected to differ. Only packaged builds
  // can use the native/frontend id comparison to detect a mixed executable.
  const mixed = !IS_DEV && nativeBuildId !== null && nativeBuildId !== BUILD_ID;
  const identity = IS_DEV
    ? "DEV"
    : mixed
      ? "MIXED BUILD"
      : BUILD_ID === "browser"
        ? BUILD_HASH
        : BUILD_ID.slice(-10);

  return (
    <div
      className={`pointer-events-none fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-[10px] font-medium shadow-sm backdrop-blur ${
        mixed ? "border-destructive text-destructive" : "border-border/70 text-muted-foreground"
      }`}
      data-tauri-build-hash={BUILD_HASH}
      data-tauri-build-id={BUILD_ID}
      data-tauri-native-build-id={nativeBuildId ?? "unavailable"}
      data-tauri-build-commit={BUILD_COMMIT}
      data-tauri-build-mixed={mixed}
      data-tauri-build-mode={IS_DEV ? "development" : "packaged"}
      title={`Tauri ${IS_DEV ? "development" : "build"} ${BUILD_ID} · native ${nativeBuildId ?? "unavailable"} · commit ${BUILD_COMMIT}`}
      aria-label={`Tauri build ${identity}, commit ${BUILD_COMMIT}`}
    >
      <span className="uppercase tracking-[0.12em]">Build</span>
      <code className="font-mono text-foreground">{identity}</code>
      <span aria-hidden="true">·</span>
      <code className="font-mono">{BUILD_COMMIT}</code>
    </div>
  );
}

/**
 * The desktop root. The providers live in the shell rather than in the route's
 * component on purpose: the shell wraps every match, error and not-found screens
 * included, and those screens render the app chrome (see route-fallback.tsx) —
 * which needs the store. Putting them here is what keeps a crash recoverable.
 */
export function TauriShell({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={tauriQueryClient}>
      <ApProvider>
        <UploadJobsProvider>
          {children}
          <Toaster position="bottom-right" />
          <BuildIdentity />
        </UploadJobsProvider>
      </ApProvider>
    </QueryClientProvider>
  );
}

export const tauriRootRoute = createRootRoute({
  shellComponent: TauriShell,
  errorComponent: ErrorScreen,
  notFoundComponent: NotFoundScreen,
});
