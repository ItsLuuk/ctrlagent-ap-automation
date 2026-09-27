import { Link, useRouterState } from "@tanstack/react-router";
import { Analytics, FoundryMark, IconWell, Inbox, Settings, Table2 } from "@/components/icons";
import { useEffect, type ReactNode } from "react";
import { useAp } from "@/lib/app/store";
import { operatorName } from "@/lib/ap/operator";
import { UploadDialog } from "./upload-dialog";
import { ProcessingBadge } from "./processing-badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prewarmVisionModel } from "@/lib/ai/gemma";
import { startVisionRuntime } from "@/lib/ai/bundled-vision";

let warmed = false;

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (warmed) return;
    warmed = true;
    let started = false;
    const startVision = () => {
      if (started) return;
      started = true;
      // Decide the vision runtime first so the warm-up aims at a live server
      // instead of racing the bundled one out of the gate. Every path resolves.
      void startVisionRuntime().finally(() => {
        // Best-effort: a failed warm-up does not block extraction, and a missing
        // Ollama handles pages without an embedded text layer. prewarmVisionModel
        // already catches internally; the outer catch is defensive only.
        try {
          prewarmVisionModel();
        } catch {
          /* ignore */
        }
      });
    };
    // The first frame belongs to the inbox. Starting the bundled runtime and
    // warming the model immediately made the window compete with that first
    // paint, so defer the nonessential work until the UI is usable.
    const timer = window.setTimeout(startVision, 1200);
    return () => {
      window.clearTimeout(timer);
      // React StrictMode mounts effects twice in development; let the second
      // mount schedule the work if the first one was torn down before it ran.
      if (!started) warmed = false;
    };
  }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";
  const { isFirstRun, businessProfile } = useAp();
  const operator = operatorName(businessProfile);
  const initials = operator
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar side="left" variant="inset" collapsible="icon">
        <SidebarHeader>
          {/* Icon mode leaves ~32px of content between the header's own
              padding — the mark and the minimize button cannot share a line
              there (the button used to land on top of the logo), so the header
              becomes a column: mark centred, minimize directly beneath it. */}
          <div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2">
            <Link
              to="/"
              className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center"
            >
              <IconWell className="bg-primary text-primary-foreground">
                <FoundryMark className="size-4" />
              </IconWell>
              <span className="font-display text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Foundry
              </span>
            </Link>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isHome} tooltip="Accounts Payable">
                    <Link to="/" activeOptions={{ exact: true }}>
                      <Inbox className="size-4" />
                      <span>Accounts Payable</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/analytics"} tooltip="Spend analytics">
                    <Link to="/analytics">
                      <Analytics className="size-4" />
                      <span>Spend analytics</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/reports"} tooltip="Consolidated report">
                    <Link to="/reports">
                      <Table2 className="size-4" />
                      <span>Reports</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-3 p-2">
            <ProcessingBadge />
            {/* The operator, and the menu that goes with being one: identity
                first, the account's only destination under it. Collapses to
                the initials alone, like the nav labels do. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account menu — ${operator}`}
                  className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials || "?"}
                  </span>
                  <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <span className="block truncate text-xs font-medium">{operator}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Processor
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-56">
                <DropdownMenuLabel className="px-2 py-1.5 font-normal">
                  <span className="block text-sm font-medium">{operator}</span>
                  <span className="block text-xs text-muted-foreground">Local workspace</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-2 border-b border-border/50 p-2 md:hidden">
          {/* The mark travels with the narrow layout: below `md` the sidebar is
              behind the trigger, so without this the app has no identity at all
              — the 404 and crash screens especially. */}
          <Link to="/" className="flex items-center gap-2.5">
            <IconWell className="bg-primary text-primary-foreground">
              <FoundryMark className="size-4" />
            </IconWell>
            <span className="font-display text-base font-semibold tracking-tight">Foundry</span>
          </Link>
          <SidebarTrigger className="ml-auto" />
          {!isFirstRun && <UploadDialog />}
        </div>
        <div className="mx-auto w-full max-w-[1400px] p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
