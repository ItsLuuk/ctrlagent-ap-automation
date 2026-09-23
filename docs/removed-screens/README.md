# Removed screens

`/payments` and `/templates` were removed from the app: neither had an inbound
link anywhere in the UI, so together with five other unlinked routes they were
invisible to users while the sidebar advertised two destinations. Analytics kept
a home in the sidebar; these two were cut.

This repo is not under version control, so the sources are gone. What is here is
the **compiled SSR output** from the last build that contained them
(`.output/server/_ssr/payments-bzVLraIV.mjs`, `templates-DHvsTHrL.mjs`, produced
by the TanStack Start / nitro SSR build before the removal). The output is not
minified — component names, props and copy survive intact — so either screen can
be reconstructed from these files if it is ever wanted back.

To restore one: rebuild the route in `src/routes/<name>.tsx`, register it in
`src/tauri/router.tsx`, and give it an inbound link — an unlinked screen is the
reason it was cut.
