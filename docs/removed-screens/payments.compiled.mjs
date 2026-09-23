import { o as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { m as require_jsx_runtime, n as CheckboxIndicator, t as Checkbox$1 } from "../_libs/@radix-ui/react-checkbox+[...].mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { D as shortDate, P as useAp, l as TRANSITION_LABEL, y as money } from "./upload-jobs-9d_I7fi1.mjs";
import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { N as Landmark$1, Z as Shell, at as cn, d as ChevronDown$1, l as Check$1, s as Button, t as AlertTriangle$1 } from "./shell-CQ-5A7Zp.mjs";
import { t as PageHeader } from "./page-header-dVE9L-pQ.mjs";
import { t as EmptyState } from "./primitives-VCutH4JW.mjs";
import { n as StatusBadge } from "./status-DaDhS3Xg.mjs";
import { o as VendorLogo } from "./vendor-profile-BM57FzW7.mjs";
import { t as countOf } from "./vocabulary-D8mYsDAu.mjs";
import { r as latestSyncByInvoice } from "./erp-sync-CWk5S3CZ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/payments-bzVLraIV.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Checkbox = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox$1, {
	ref,
	className: cn("grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary  cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground", className),
	...props,
	children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckboxIndicator, {
		className: cn("grid place-content-center text-current"),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check$1, { className: "h-4 w-4" })
	})
}));
Checkbox.displayName = Checkbox$1.displayName;
/**
* Scores one scheduled invoice. Pure — the UI acknowledges, the state
* machine blocks release until every flag is acknowledged.
*/
function scorePaymentRisk(input) {
	const { invoice, scheduled, history } = input;
	const flags = [];
	if (input.bankDetailsChangedDaysAgo !== void 0 && input.bankDetailsChangedDaysAgo <= 14) flags.push({
		kind: "bank_details_changed",
		explanation: `Bank details changed ${input.bankDetailsChangedDaysAgo} day${input.bankDetailsChangedDaysAgo === 1 ? "" : "s"} ago.`,
		acknowledgePrompt: "I've verified the new bank details by phone."
	});
	const paidForVendor = history.filter((h) => h.vendor.toLowerCase() === invoice.vendor.toLowerCase());
	if (paidForVendor.length === 0) flags.push({
		kind: "first_payment",
		explanation: "This would be the first payment to this vendor.",
		acknowledgePrompt: "I've confirmed this vendor is legitimate and expected."
	});
	if (paidForVendor.length > 0) {
		const avg = paidForVendor.reduce((s, h) => s + h.total, 0) / paidForVendor.length;
		const factor = input.aboveAverageFactor ?? 1.5;
		if (avg > 0 && invoice.total > avg * factor) flags.push({
			kind: "amount_above_average",
			explanation: `Amount is ${(invoice.total / avg).toFixed(1)}× the vendor's average (${paidForVendor.length} past payments).`,
			acknowledgePrompt: "I've confirmed the amount is expected for this vendor."
		});
	}
	const duplicate = scheduled.find((other) => other.id !== invoice.id && other.vendor.toLowerCase() === invoice.vendor.toLowerCase() && (other.invoiceNumber === invoice.invoiceNumber || Math.abs(other.total - invoice.total) < .01));
	if (duplicate) flags.push({
		kind: "duplicate_warning",
		explanation: `${duplicate.invoiceNumber || "Another invoice"} for the same vendor/amount is also scheduled.`,
		acknowledgePrompt: "I've confirmed these are not duplicate invoices."
	});
	return flags;
}
/** Release gate: every flagged row must have all its flags acknowledged. */
function releaseIsBlocked(flags, acknowledged) {
	return flags.some((f) => !acknowledged.has(f.kind));
}
/**
* Payment handoff list (deferred surface).
*
* Kept as a secondary demo route while real payment rails are deferred. It
* shows approved invoices and risk checks, but does not move real money.
*/
var TREASURY = {
	name: "Payments",
	roles: ["treasury"]
};
function PaymentRun() {
	const { invoices, history, applyTransition } = useAp();
	const scheduled = invoices.filter((i) => i.status === "scheduled");
	const syncMap = (0, import_react.useMemo)(() => latestSyncByInvoice(), []);
	const [selected, setSelected] = (0, import_react.useState)(/* @__PURE__ */ new Set());
	const [acknowledged, setAcknowledged] = (0, import_react.useState)({});
	const [expandedRow, setExpandedRow] = (0, import_react.useState)(void 0);
	const [holdReason, setHoldReason] = (0, import_react.useState)("");
	const paidHistory = (0, import_react.useMemo)(() => history.map((h) => ({
		vendor: h.vendor,
		total: h.total,
		paidAt: h.createdAt
	})), [history]);
	const rows = (0, import_react.useMemo)(() => scheduled.map((inv) => ({
		invoice: inv,
		flags: scorePaymentRisk({
			invoice: inv,
			scheduled,
			history: paidHistory,
			bankDetailsChangedDaysAgo: inv.memo.includes("bank-changed") ? 2 : void 0
		})
	})), [scheduled, paidHistory]);
	const readyRows = rows.filter((r) => !releaseIsBlocked(r.flags, acknowledged[r.invoice.id] ?? /* @__PURE__ */ new Set()));
	const selectedTotal = rows.filter((r) => selected.has(r.invoice.id)).reduce((s, r) => s + r.invoice.total, 0);
	const batchTotal = scheduled.reduce((s, r) => s + r.total, 0);
	const vendors = new Set(scheduled.map((i) => i.vendor));
	const toggle = (id) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const selectReady = () => {
		setSelected(new Set(readyRows.map((r) => r.invoice.id)));
	};
	const acknowledge = (invoiceId, kind) => {
		setAcknowledged((prev) => {
			const next = {
				...prev,
				[invoiceId]: new Set(prev[invoiceId] ?? [])
			};
			next[invoiceId].add(kind);
			return next;
		});
	};
	const releaseSelected = () => {
		const blocked = rows.filter((r) => selected.has(r.invoice.id) && releaseIsBlocked(r.flags, acknowledged[r.invoice.id] ?? /* @__PURE__ */ new Set()));
		if (blocked.length > 0) {
			toast.error(`${countOf(blocked.length, "invoice")} still have unacknowledged risk flags — expand the flagged rows first.`);
			return;
		}
		let released = 0;
		let firstReason;
		for (const id of selected) {
			const result = applyTransition(id, {
				transition: "release",
				actor: TREASURY,
				note: "Marked ready for external handoff"
			});
			if (result.accepted) released += 1;
			else firstReason ??= result.reason;
		}
		if (released > 0) {
			toast.success(`${countOf(released, "invoice")} marked ready for external handoff — no payment was sent`);
			setSelected(/* @__PURE__ */ new Set());
		} else if (firstReason) toast.error("Could not release.", { description: firstReason });
	};
	const holdSelected = () => {
		if (!holdReason.trim()) {
			toast.error("Add a hold reason first — the vendor will see it.");
			return;
		}
		let held = 0;
		let firstReason;
		for (const id of selected) {
			const result = applyTransition(id, {
				transition: "hold",
				actor: TREASURY,
				note: holdReason.trim()
			});
			if (result.accepted) held += 1;
			else firstReason ??= result.reason;
		}
		if (held > 0) toast.success(`We held ${countOf(held, "invoice")}`);
		else if (firstReason) toast.error("Could not hold.", { description: firstReason });
		setHoldReason("");
	};
	if (scheduled.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
		icon: Landmark$1,
		title: "No approved invoices ready for handoff.",
		action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/",
			className: "text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground",
			children: "Back to invoice inbox"
		}),
		children: "Approved invoices appear here for the deferred payment handoff."
	}) });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Shell, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeader, {
		icon: Landmark$1,
		title: "Payment handoff",
		subtitle: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium  text-warning-foreground",
				children: "Demo only · no payment rail connected"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
				countOf(scheduled.length, "invoice"),
				" ·",
				" "
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-mono tabular-nums",
				children: money(batchTotal)
			}),
			" across",
			" ",
			countOf(vendors.size, "vendor")
		] })
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-5 overflow-hidden rounded-lg border border-border bg-card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-[auto_2fr_1fr_1fr_auto] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium  text-muted-foreground",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Vendor / invoice" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-right",
						children: "Amount"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Due" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Status" })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "divide-y divide-border",
				children: rows.map(({ invoice, flags }) => {
					const acks = acknowledged[invoice.id] ?? /* @__PURE__ */ new Set();
					const blocked = flags.some((f) => !acks.has(f.kind));
					const syncEvent = syncMap[invoice.id];
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaymentRow, {
						invoice,
						flags,
						syncStatus: !syncEvent ? "Not synced" : syncEvent.status === "failed" ? `Sync failed (retry)` : syncEvent.mode === "real" ? `ERP synced ${syncEvent.erpRef} ✓` : "Local simulation — ERP not connected",
						syncFailed: syncEvent?.status === "failed",
						acknowledged: acks,
						expanded: expandedRow === invoice.id,
						onToggleExpand: () => setExpandedRow((cur) => cur === invoice.id ? void 0 : invoice.id),
						onAcknowledge: (kind) => acknowledge(invoice.id, kind),
						onSelect: () => toggle(invoice.id),
						selected: selected.has(invoice.id),
						blocked
					}, invoice.id);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-4 py-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "outline",
						onClick: selectReady,
						children: "Select all ready"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						size: "sm",
						onClick: releaseSelected,
						disabled: selected.size === 0,
						className: "gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Landmark$1, { className: "size-4" }),
							" Mark ready for handoff",
							" ",
							selected.size > 0 ? money(selectedTotal) : ""
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: holdReason,
							onChange: (e) => setHoldReason(e.target.value),
							placeholder: "Hold reason…",
							className: "h-10 w-44 rounded-md border border-border bg-background px-4 text-xs"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "outline",
							onClick: holdSelected,
							disabled: selected.size === 0,
							children: "Hold"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "ml-auto text-xs text-muted-foreground",
						children: [
							readyRows.length,
							" of ",
							rows.length,
							" ready · simulation requires treasury role"
						]
					})
				]
			})
		]
	})] });
}
function PaymentRow({ invoice, flags, acknowledged, expanded, blocked, selected, syncStatus, syncFailed, onToggleExpand, onAcknowledge, onSelect }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid grid-cols-[auto_2fr_1fr_1fr_auto] items-center gap-3 px-4 py-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, {
				checked: selected,
				onCheckedChange: onSelect,
				"aria-label": `Select ${invoice.vendor}`
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: onToggleExpand,
				className: "flex min-w-0 items-center gap-2 text-left text-sm font-medium tracking-tight hover:underline",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(VendorLogo, {
						vendor: invoice.vendor,
						className: "size-8 text-xs"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "truncate",
						children: [invoice.vendor, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ml-2 font-mono text-xs text-muted-foreground",
							children: invoice.invoiceNumber || "—"
						})]
					}),
					flags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: `ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-middle text-xs font-medium ${blocked ? "bg-destructive text-white" : "bg-success text-white"}`,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AlertTriangle$1, { className: "size-3" }), blocked ? countOf(flags.length, "flag") : "flags cleared"]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-right font-mono text-sm tabular-nums",
				children: money(invoice.total, invoice.currency)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: shortDate(invoice.dueDate)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: `text-xs font-medium ${syncFailed ? "text-destructive" : syncStatus === "Not synced" ? "text-muted-foreground" : "text-success-foreground"}`,
						children: syncStatus
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, { status: invoice.status }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronDown$1, { className: `size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}` })
				]
			})
		]
	}), expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "border-t border-border bg-muted/20 px-4 py-3 sm:ps-10",
		children: [
			flags.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "No risk flags — vendor known, amount within normal range."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "space-y-2",
				children: flags.map((flag) => {
					const acked = acknowledged.has(flag.kind);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex flex-wrap items-center gap-2 text-xs",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AlertTriangle$1, { className: `size-3.5 ${acked ? "text-success-foreground" : "text-warning-foreground"}` }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: flag.explanation }),
							acked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "rounded bg-success px-1.5 py-0.5 text-xs font-medium text-white",
								children: "acknowledged"
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "outline",
								className: "h-6 px-3 text-xs",
								onClick: () => onAcknowledge(flag.kind),
								children: flag.acknowledgePrompt
							})
						]
					}, flag.kind);
				})
			}),
			" ",
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 text-xs text-muted-foreground",
				children: [
					"Approved by",
					" ",
					invoice.audit.find((a) => a.action === TRANSITION_LABEL.approve)?.actor ?? "—",
					" ·",
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/invoices/$id",
						params: { id: invoice.id },
						className: "underline underline-offset-2",
						children: "open invoice"
					}),
					" · ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-muted-foreground",
						children: "External payment integration is not connected"
					})
				]
			})
		]
	})] });
}
//#endregion
export { PaymentRun as component };
