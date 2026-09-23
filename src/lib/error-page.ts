/**
 * The document served when SSR itself dies — no router, no shell, no React, so
 * it must stand on its own. What it can still carry is the mark: a dead end
 * with no identity reads like the server's fault rather than a screen in the
 * app, and this is the one surface where the app can say who it is with plain
 * HTML. Every color and shape below is taken from `src/styles.css` — the same
 * Action Blue, the same foreground, the same 9999px well around the same
 * FoundryMark ledger glyph (the React component cannot be rendered here).
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #1d1d1f; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      .mark { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 9999px; background: #0071e3; color: #fff; }
      .brand { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: #1d1d1f; margin: 0.75rem 0 1.25rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #6e6e73; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #0071e3; color: #fff; }
      .secondary { background: #fff; color: #1d1d1f; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="mark" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4.5" width="12" height="15" rx="2.5" />
          <path d="M9 9.25h6" />
          <path d="M9 12.25h6" />
          <path d="M9 15.25h3.5" />
        </svg>
      </span>
      <p class="brand">Foundry</p>
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
