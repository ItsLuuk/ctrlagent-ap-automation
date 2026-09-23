import { m as require_jsx_runtime } from "../_libs/@radix-ui/react-checkbox+[...].mjs";
import { P as useAp, m as describeMapping } from "./upload-jobs-9d_I7fi1.mjs";
import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { H as Pencil$1, P as Layers$1, U as Plus$1, Z as Shell, s as Button } from "./shell-CQ-5A7Zp.mjs";
import { t as PageHeader } from "./page-header-dVE9L-pQ.mjs";
import { t as EmptyState } from "./primitives-VCutH4JW.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/templates-DHvsTHrL.js
var import_jsx_runtime = require_jsx_runtime();
function TemplatesPage() {
	const { templates, invoices } = useAp();
	const entries = Object.values(templates).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Shell, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeader, {
		icon: Layers$1,
		title: "Vendor templates",
		subtitle: "Every confirmed draft teaches the system. Known vendors skip the first-pass read and extract in about a second.",
		actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			variant: "outline",
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: "/",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus$1, { className: "size-4" }), " Upload a new invoice to teach"]
			})
		})
	}), entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
		icon: Layers$1,
		title: "No templates yet",
		className: "mt-5",
		children: "Confirm your first draft invoice and its mappings become a reusable template for that vendor — one teaching pass, forever after automated."
	}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-6 grid gap-4 md:grid-cols-2",
		children: entries.map((t) => {
			const fields = Object.keys(t.fields);
			const lastInvoice = invoices.find((i) => i.vendor === t.vendor_key && i.source === "upload");
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-lg border border-border bg-card",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between border-b border-border px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm font-semibold tracking-tight",
						children: t.vendor_key
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-0.5 text-xs text-muted-foreground",
						children: [
							"v",
							t.version,
							" · ",
							fields.length,
							" field",
							fields.length === 1 ? "" : "s",
							t.line_items ? " · line items" : "",
							t.confirmNextCount ? ` · confirm next ${t.confirmNextCount}` : "",
							t.origin ? ` · ${t.origin.replace("-", " ")}` : ""
						]
					})] }), lastInvoice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "outline",
						asChild: true,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: "/invoices/$id",
							params: { id: lastInvoice.id },
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pencil$1, { className: "size-3.5" }), " Update mapping"]
						})
					}) : null]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "space-y-1 p-4 text-xs text-muted-foreground",
					children: [
						fields.slice(0, 4).map((f) => {
							const spec = t.fields[f];
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "truncate",
								children: ["· ", describeMapping(f, spec, void 0)]
							}, f);
						}),
						fields.length > 4 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
							"· and ",
							fields.length - 4,
							" more…"
						] }) : null,
						fields.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "No fields mapped yet." }) : null
					]
				})]
			}, t.vendor_key);
		})
	})] });
}
//#endregion
export { TemplatesPage as component };
