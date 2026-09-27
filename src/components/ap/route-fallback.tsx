/**
 * The two screens a user reaches without a route of their own: one that failed
 * to draw, and a URL that matched nothing.
 *
 * Both render inside the app shell. A crash screen without the sidebar is a dead
 * end — the router's own default ("Something went wrong") offers one button that
 * hides the error and nothing else — so the chrome is the escape route: every
 * screen in the app stays one click away. The providers that Shell needs live in
 * each root's shellComponent, above every match, so these two render with the
 * store already mounted.
 *
 * "Go home" is a router Link, never an anchor. The desktop build serves the app
 * from /tauri.html, where href="/" leaves the window for the server's 404
 * instead of navigating the running app.
 */
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { CircleAlert, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./primitives";
import { Shell } from "./shell";

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <Shell>
      <EmptyState
        icon={Search}
        title="Page not found"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ to: "/" })}
          >
            Go home
          </Button>
        }
      >
        The page you're looking for doesn't exist or has been moved.
      </EmptyState>
    </Shell>
  );
}

export function ErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const navigate = useNavigate();

  // The window shows the app, not a stack trace: the details go to the console,
  // where devtools and any reporter still find them.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell>
      <EmptyState
        icon={CircleAlert}
        title="This screen didn't load"
        action={
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                router.invalidate();
                reset();
              }}
            >
              Try again
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/" })}
            >
              Go home
            </Button>
          </div>
        }
      >
        Something went wrong while drawing this screen. Nothing you had already confirmed was lost —
        the invoices you captured are still in the inbox.
      </EmptyState>
    </Shell>
  );
}
