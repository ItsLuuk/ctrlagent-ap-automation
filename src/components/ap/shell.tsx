import { Link, useRouterState } from "@tanstack/react-router";
import {
  CircleAlert,
  FoundryMark,
  History,
  IconWell,
  Inbox,
  Settings,
  Users,
} from "@/components/icons";
import { useEffect, type ReactNode } from "react";
import { useAp } from "@/lib/ap/store";
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
import { prewarmVisionModel } from "@/lib/ai/gemma";
import { startVisionRuntime } from "@/lib/ai/bundled-vision";

let warmed = false;

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (warmed) return;
    warmed = true;
    // Decide the vision runtime first so the warm-up aims at a live server
    // instead of racing the bundled one out of the gate. Every path resolves.
    void startVisionRuntime().finally(() => {
      // Best-effort: a failed warm-up does not block extraction, and a missing
      // Ollama is the normal fallback path (Tesseract only). prewarmVisionModel
      // already catches internally; the outer catch is defensive only.
      try {
        prewarmVisionModel();
      } catch {
        /* ignore */
      }
    });
  }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAccountsPayable = pathname === "/" || pathname.startsWith("/invoices/");
  const { isFirstRun } = useAp();

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar
        side="left"
        variant="inset"
        collapsible="icon"
        className="border-r border-sidebar-border bg-card/95 backdrop-blur-xl"
      >
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <Link to="/" className="flex items-center gap-2.5">
              <IconWell className="bg-primary text-primary-foreground">
                <FoundryMark className="size-4" />
              </IconWell>
              <span className="font-display text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Foundry
              </span>
            </Link>
            <SidebarTrigger className="ml-auto" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isAccountsPayable}
                    tooltip="Accounts Payable"
                  >
                    <Link to="/" activeOptions={{ exact: true }}>
                      <Inbox className="size-4" />
                      <span>Accounts Payable</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/exceptions"}
                    tooltip="Exceptions"
                  >
                    <Link to="/exceptions">
                      <CircleAlert className="size-4" />
                      <span>Exceptions</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/history"} tooltip="History">
                    <Link to="/history">
                      <History className="size-4" />
                      <span>History</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/vendors"} tooltip="Vendors">
                    <Link to="/vendors">
                      <Users className="size-4" />
                      <span>Vendors</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <li className="px-2 py-2" aria-hidden="true">
                  <div className="h-px bg-sidebar-border/80" />
                </li>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/settings"} tooltip="Settings">
                    <Link to="/settings">
                      <Settings className="size-4" />
                      <span>Settings</span>
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
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">
                LK
              </span>
              <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                LK
              </span>
            </div>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-2 border-b border-border/50 bg-background/75 p-2 backdrop-blur-xl md:hidden">
          {/* The mark travels with the narrow layout: below `md` the sidebar is
              behind the trigger, so without this the app has no identity at all
              — the 404 and crash screens especially. */}
          <Link to="/" className="flex items-center gap-2.5">
            <IconWell className="bg-foreground text-background">
              <FoundryMark className="size-4" />
            </IconWell>
            <span className="font-display text-base font-semibold tracking-tight">Foundry</span>
          </Link>
          <SidebarTrigger className="ml-auto" />
          {!isFirstRun && <UploadDialog />}
        </div>
        <div className="mx-auto w-full max-w-[1400px] p-4 md:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
