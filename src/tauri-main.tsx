import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";
import "./lib/ap/pdfjs-polyfill";
import { getTauriRouter } from "./tauri/router";

/** The static splash is outside #root, so React can replace the app without
 *  ever exposing an empty window while the bundle parses. */
const splash = document.getElementById("boot-splash");
let splashRemoved = false;
function removeSplash() {
  if (splashRemoved || !splash) return;
  splashRemoved = true;
  splash.style.opacity = "0";
  window.setTimeout(() => splash.remove(), 240);
}
function showBootError(message: string) {
  if (!splash || !splash.isConnected) return;
  splash.dataset["state"] = "error";
  const status = splash.querySelector(".boot-status");
  if (status) status.textContent = message;
}
/** Two frames, so the first React commit is on screen before the splash
 *  fades — otherwise the fade reveals the empty window it was covering. */
function removeSplashAfterPaint() {
  window.requestAnimationFrame(() => window.requestAnimationFrame(removeSplash));
}

try {
  const router = getTauriRouter();
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing in tauri.html");

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );

  // The splash animation should end when the workspace is actually there, not
  // when the bundle finishes parsing: a route's loaders and the store's own
  // start-up run after that commit, and a splash that leaves early just hands
  // the wait to a blank canvas. onResolved is that signal.
  router.subscribe("onResolved", removeSplashAfterPaint);
  // The cap is the fallback for a router that never resolves — a splash is not
  // allowed to become the only thing on screen if a load fails, and the error
  // screen has to stay reachable behind it.
  window.setTimeout(removeSplash, 4000);
} catch (error) {
  console.error("[boot] Foundry failed to start", error);
  showBootError("Foundry could not start. Try opening it again.");
}
