import { createHashHistory, createRouter } from "@tanstack/react-router";

import { tauriQueryClient } from "./query-client";
import { tauriRootRoute } from "./root";
import { Route as IndexRoute } from "../routes/index";
import { Route as ExceptionsRoute } from "../routes/exceptions";
import { Route as AnalyticsRoute } from "../routes/analytics";
import { Route as HistoryRoute } from "../routes/history";
import { Route as ReportsRoute } from "../routes/reports";
import { Route as SettingsRoute } from "../routes/settings";
import { Route as VendorsRoute } from "../routes/vendors";
import { Route as InvoicesIdRoute } from "../routes/invoices.$id";

// The router plugin normally injects id/path/parent into file routes via the
// generated Start tree. createFileRoute("/x") on its own DISCARDS the path
// (see FileRoute.createRoute in @tanstack/react-router), so without the
// plugin each route inits as a second __root__ -> "Invariant failed".
// Mirror routeTree.gen.ts explicitly: id + path + parent, no plugin needed.
// The constraint only asks for an `update` that takes a `never` argument and
// returns anything: a real Route's `update` satisfies it (never is assignable
// to its parameter type), while pinning the return to `never` would — through
// this helper's own return type — erase every route from the registered router
// type, leaving `<Link to="/">` with only relative paths to offer.
const withTree = <T extends { update: (opts: never) => unknown }>(
  route: T,
  id: string,
  path: string,
): T => route.update({ id, path, getParentRoute: () => tauriRootRoute } as never) as T;

const routeTree = tauriRootRoute.addChildren([
  withTree(IndexRoute, "/", "/"),
  withTree(ExceptionsRoute, "/exceptions", "/exceptions"),
  withTree(HistoryRoute, "/history", "/history"),
  withTree(ReportsRoute, "/reports", "/reports"),
  withTree(AnalyticsRoute, "/analytics", "/analytics"),
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
