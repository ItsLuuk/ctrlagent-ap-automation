import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { ErrorScreen, NotFoundScreen } from "@/components/ap/route-fallback";
import { ApProvider } from "@/lib/ap/store";
import { UploadJobsProvider } from "@/lib/ap/upload-jobs";
import { reportLovableError } from "../lib/lovable-error-reporting";

/**
 * Reports still go to Lovable; the screen itself is the app's own, shared with
 * the desktop root so the two builds cannot drift apart.
 */
function WebErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return <ErrorScreen error={error} reset={reset} />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Foundry — AP automation" },
      {
        name: "description",
        content: "Capture, verify and approve invoices in one focused accounts payable workspace.",
      },
      { name: "author", content: "Foundry" },
      { property: "og:title", content: "Foundry — AP automation" },
      {
        property: "og:description",
        content: "Capture, verify and approve invoices in one focused accounts payable workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },

      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundScreen,
  errorComponent: WebErrorComponent,
});

/**
 * The store contexts live in the shell, above every match, so the error and
 * not-found screens — which render inside the shell and show the app chrome —
 * have them. The query client stays in the component below, where the router's
 * context supplies it (nothing in the app queries through it yet).
 */
function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ApProvider>
          <UploadJobsProvider>
            {children}
            <Toaster position="bottom-right" />
          </UploadJobsProvider>
        </ApProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Required: nested routes render here. Removing <Outlet /> breaks all child routes.
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
