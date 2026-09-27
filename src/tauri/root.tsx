import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { ErrorScreen, NotFoundScreen } from "@/components/ap/route-fallback";
import { ApProvider } from "@/lib/app/store";
import { UploadJobsProvider } from "@/lib/app/upload-jobs";
import { registerVisionEngine } from "@/lib/app/vision-runtime";
import { tauriQueryClient } from "./query-client";

// The domain never imports the model client itself; the shell wires one in
// before the first upload can ask for it.
registerVisionEngine();

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
