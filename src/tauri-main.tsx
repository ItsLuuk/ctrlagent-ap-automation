import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";
import "./lib/ap/pdfjs-polyfill";
import { getTauriRouter } from "./tauri/router";

const router = getTauriRouter();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element missing in tauri.html");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
