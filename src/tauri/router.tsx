import { createHashHistory, createRouter } from "@tanstack/react-router";

import { tauriQueryClient } from "./query-client";
import { tauriRootRoute } from "./root";
import { Route as IndexRoute } from "../routes/index";
import { Route as ExceptionsRoute } from "../routes/exceptions";
import { Route as HistoryRoute } from "../routes/history";
import { Route as SettingsRoute } from "../routes/settings";
import { Route as VendorsRoute } from "../routes/vendors";
import { Route as InvoicesIdRoute } from "../routes/invoices.$id";

// The router plugin normally injects id/path/parent into file routes via the
// generated Start tree. createFileRoute("/x") on its own DISCARDS the path
// (see FileRoute.createRoute in @tanstack/react-router), so without the
// plugin each route inits as a second __root__ -> "Invariant failed".
// Mirror routeTree.gen.ts explicitly: id + path + parent, no plugin needed.
const withTree = (route: { update: (opts: never) => never }, id: string, path: string) =>
  route.update({ id, path, getParentRoute: () => tauriRootRoute } as never) as never;

const routeTree = tauriRootRoute.addChildren([
  withTree(IndexRoute, "/", "/"),
  withTree(ExceptionsRoute, "/exceptions", "/exceptions"),
  withTree(HistoryRoute, "/history", "/history"),
  withTree(SettingsRoute, "/settings", "/settings"),
  withTree(VendorsRoute, "/vendors", "/vendors"),
  withTree(InvoicesIdRoute, "/invoices/$id", "/invoices/$id"),
]);

export function getTauriRouter() {
  return createRouter({
    routeTree,
    // One client for the router's context and the shell's provider — two would
    // be two caches waiting to disagree the day something queries through it.
    context: { queryClient: tauriQueryClient },
    // Hash history: Tauri serves static files (no server rewrite rules),
    // so browser-history deep links / reloads would blank-screen.
    history: createHashHistory(),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getTauriRouter>;
  }
}
