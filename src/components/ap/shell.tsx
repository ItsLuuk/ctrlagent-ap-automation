import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, FoundryMark, IconWell, Inbox, Settings } from "@/components/icons";
import { useEffect, type ReactNode } from "react";
import { startVisionRuntime } from "@/lib/ai/bundled-vision";
import { prewarmVisionModel } from "@/lib/ai/gemma";
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

let warmed = false;

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (warmed) return;
    warmed = true;
    // Decide the vision runtime first so the warm-up aims at a live server
    // instead of racing the bundled one out of the gate. Every path resolves.
    void startVisionRuntime().finally(() => prewarmVisionModel());
  }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";
  // The first-run screen owns the one upload action there is; a second button
  // in the shell's narrow-width bar would be the same action twice, under a
  // slightly different name.
  const { isFirstRun } = useAp();

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar side="left" variant="inset" collapsible="icon">
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
                  <SidebarMenuButton asChild isActive={isHome} tooltip="Accounts Payable">
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
                      <AlertTriangle className="size-4" />
                      <span>Exceptions</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
              <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
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
