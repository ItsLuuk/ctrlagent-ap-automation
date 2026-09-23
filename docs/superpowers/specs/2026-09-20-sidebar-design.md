# Sidebar Migration Design — 2026-09-20

## Goal
Replace topbar in `src/components/ap/shell.tsx` with shadcn sidebar, variant inset floating. Full replace, no top header.

## Decisions (user-approved)
- Nav: minimal single link (Accounts Payable → `/`)
- Behavior: collapsible icon on desktop, sheet drawer on mobile
- Layout: full replace (logo, ProcessingBadge, avatar, UploadDialog move into sidebar)
- Variant: B — inset floating

## Architecture
- Rewrite `src/components/ap/shell.tsx` only:
  `SidebarProvider > AppSidebar + SidebarInset`
- Props: `side="left"`, `variant="inset"`, `collapsible="icon"`
- No `<header>`. `SidebarInset` holds `{children}` with padding.
- All 8 routes (`index, invoices.$id, vendors, templates, payments, history, exceptions, analytics`) unchanged, still wrap `<Shell>`.
- Reuse existing `src/components/ui/sidebar.tsx`. No `bunx shadcn add sidebar` needed — already installed. Verify `use-mobile.tsx`, `button, sheet, tooltip, separator, skeleton` present (they are).
- Keep `prewarmVisionModel` useEffect in `Shell`.

## Components
- `SidebarHeader`: logo (`CircleDollarSign` + Ledgerflow text) + `SidebarTrigger` collapse button.
- `SidebarContent > SidebarGroup > SidebarMenu > SidebarMenuItem > SidebarMenuButton asChild`:
  Single item, `Link to="/" activeOptions={{exact:true}}`, `Inbox` icon, label Accounts Payable, `isActive` from router active state, tooltip when collapsed.
- `SidebarFooter`: vertical stack — `ProcessingBadge`, `UploadDialog`, avatar `LK` circle.
- `SidebarRail` for resize/collapse affordance.
- `SidebarInset`: floating card container. Top-left floating `SidebarTrigger` for mobile (drawer opener). Content: `<div class="mx-auto max-w-[1400px] p-6">` preserving old max-width, replacing old `px-6 py-8` wrapper.

## Data flow
- Nav active: TanStack Router `Link` active class → `data-active` on `SidebarMenuButton`.
- Open state: `sidebar_state` cookie, `Ctrl/Cmd+B` shortcut built into `SidebarProvider`.
- Responsive: `useIsMobile()` → desktop icon-collapse vs mobile `Sheet` drawer.
- No new store, no new API.

## Error handling
- Mobile `Sheet` provides focus trap + ESC close.
- SSR: `useIsMobile` client-only, defaults desktop then corrects — no hydration crash (existing pattern).
- Build fails fast if sidebar export missing — caught by `tsc` / vite build.
- No routing changes → no new 404 risk.

## Testing
- `bun run build` (vite build) must pass.
- Manual: desktop expand/collapse, icon tooltips, mobile drawer open/close, UploadDialog opens from footer, ProcessingBadge renders, nav active highlight on `/`.
- No unit tests (UI shell change, existing app has none).

## Out of scope
- Full multi-route nav (deferred — add items later by appending `SidebarMenuButton`s).
- Theming changes, auth, avatar menu.
- YAGNI: no search input in sidebar, no submenu.
