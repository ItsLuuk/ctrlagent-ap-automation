/**
 * LineItemsList — clean Apple-style line items with inline editing.
 *
 * Design:
 *  - "+" adds an editable row directly in the list (no overlay)
 *  - Inline fields: description, qty × price = amount
 *  - Tap to edit any field, tab to move between fields
 *  - X button to remove a row (instant, no confirmation)
 *  - Total row auto-computed at the bottom
 *  - Smooth row insertion/removal transitions
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { uid, money, type LineItem, GL_ACCOUNTS, DEPARTMENTS } from "@/lib/ap/types";
import { EmptyState } from "@/components/ap/primitives";
import { parseLineItemDraft, type LineItemDraft } from "@/lib/ap/line-item-edit";

/* ── Shared editable field cells ────────────────────────────────────── */

function RowFields({
  description,
  quantity,
  unitPrice,
  currency,
  onDescriptionChange,
  onQuantityChange,
  onUnitPriceChange,
  autoFocus,
  isLast,
  deleteButton,
}: {
  description: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  onDescriptionChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onUnitPriceChange: (v: string) => void;
  autoFocus?: boolean;
  isLast: boolean;
  deleteButton?: React.ReactNode;
}) {
  const descRef = useRef<HTMLInputElement>(null);
  const qty = Number(quantity.replace(",", ".")) || 0;
  const price = Number(unitPrice.replace(",", ".")) || 0;
  const amount = qty * price;
  const inputClass =
    "h-9 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-ring focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/25";

  useEffect(() => {
    if (!autoFocus) return;
    // Small delay to ensure the row is rendered before focusing
    const timer = setTimeout(() => descRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "group relative grid grid-cols-2 items-center gap-2 px-4 py-3 pr-10 transition-colors hover:bg-secondary/20 sm:grid-cols-[minmax(160px,1fr)_52px_92px_110px] sm:gap-3 sm:py-3",
        !isLast && "border-b border-border/60",
      )}
    >
      <input
        ref={descRef}
        type="text"
        aria-label="Description"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="Description"
        className={cn(inputClass, "col-span-2 w-full min-w-0 font-medium sm:col-span-1")}
      />
      <input
        type="text"
        aria-label="Quantity"
        inputMode="numeric"
        value={quantity}
        onChange={(e) => onQuantityChange(e.target.value)}
        placeholder="1"
        className={cn(inputClass, "w-full text-right font-mono tabular-nums")}
      />
      <input
        type="text"
        aria-label="Unit price"
        inputMode="decimal"
        value={unitPrice}
        onChange={(e) => onUnitPriceChange(e.target.value)}
        placeholder="0.00"
        className={cn(inputClass, "w-full text-right font-mono tabular-nums")}
      />
      <input
        type="text"
        aria-label="Amount"
        readOnly
        value={amount > 0 ? money(amount, currency) : "—"}
        className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/20 px-2.5 text-right font-mono text-sm font-medium tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
      />
      {deleteButton && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">{deleteButton}</div>
      )}
    </div>
  );
}

/* ── Display row (non-editing) ─────────────────────────────────────── */

function DisplayRow({
  item,
  currency,
  editable,
  onDelete,
  isLast,
}: {
  item: LineItem;
  currency: string;
  editable?: boolean | undefined;
  onDelete?: (() => void) | undefined;
  isLast: boolean;
}) {
  const deleteButton =
    editable && onDelete ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={`Remove ${item.description}`}
      >
        <X className="size-3.5" />
      </button>
    ) : undefined;

  return (
    <div
      className={cn(
        "group relative grid grid-cols-2 items-center gap-2 px-4 py-3 pr-10 transition-colors hover:bg-secondary/20 sm:grid-cols-[minmax(160px,1fr)_52px_92px_110px] sm:gap-3 sm:py-3",
        !isLast && "border-b border-border/60",
      )}
    >
      <span className="col-span-2 min-w-0 truncate text-sm font-medium sm:col-span-1">
        {item.description}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-sm tabular-nums text-muted-foreground">
        {item.quantity}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-sm tabular-nums text-muted-foreground">
        {money(item.unitPrice, currency)}
      </span>
      <input
        type="text"
        aria-label="Amount"
        readOnly
        value={money(item.amount, currency)}
        className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/20 px-2.5 text-right font-mono text-sm font-medium tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
      />
      {deleteButton && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">{deleteButton}</div>
      )}
    </div>
  );
}

/* ── Editable row (committed item) ──────────────────────────────────── */

function EditableRow({
  item,
  currency,
  onCommit,
  onDelete,
  isLast,
}: {
  item: LineItem;
  currency: string;
  onCommit: (next: LineItem) => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  // Local string drafts so in-progress input like "1." or "2," survives
  // re-render; keyed by item.id at the call site (remounts on id change).
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice));

  const commit = useCallback(
    (draft: LineItemDraft) => {
      const parsed = parseLineItemDraft(draft);
      if (!parsed.ok) return; // invalid → local input keeps typed text, no upstream write
      const { ok: _ok, ...valid } = parsed;
      onCommit({ ...item, ...valid });
    },
    [item, onCommit],
  );

  const deleteButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      aria-label={`Remove ${description || item.description}`}
    >
      <X className="size-3.5" />
    </button>
  );

  return (
    <RowFields
      description={description}
      quantity={quantity}
      unitPrice={unitPrice}
      currency={currency}
      onDescriptionChange={(v) => {
        setDescription(v);
        commit({ description: v, quantity, unitPrice });
      }}
      onQuantityChange={(v) => {
        setQuantity(v);
        commit({ description, quantity: v, unitPrice });
      }}
      onUnitPriceChange={(v) => {
        setUnitPrice(v);
        commit({ description, quantity, unitPrice: v });
      }}
      isLast={isLast}
      deleteButton={deleteButton}
    />
  );
}

/* ── Column header ─────────────────────────────────────────────────── */

function ColumnHeader() {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground sm:hidden">
        <span>Item</span>
        <span>Amounts</span>
      </div>
      <div className="hidden grid-cols-[minmax(160px,1fr)_52px_92px_110px] gap-3 border-b border-border bg-muted/30 px-4 py-2.5 pr-10 text-[11px] font-medium text-muted-foreground sm:grid">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Amount</span>
      </div>
    </>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export function LineItemsList({
  items,
  currency,
  editable,
  onChange,
  subtotal,
  tax,
  invoiceTotal,
  showTotals = true,
}: {
  items: LineItem[];
  currency: string;
  editable?: boolean;
  onChange?: ((items: LineItem[]) => void) | undefined;
  subtotal?: number | undefined;
  tax?: number | undefined;
  invoiceTotal?: number | undefined;
  /** The receipt provides its own totals block when false. */
  showTotals?: boolean;
}) {
  /** When non-null, a new row is being added inline. */
  const [adding, setAdding] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newPrice, setNewPrice] = useState("");

  const total = items.reduce((sum, li) => sum + li.amount, 0);

  const commitNewRow = useCallback(() => {
    if (!onChange) return;
    const qty = Number(newQty.replace(",", ".")) || 0;
    const price = Number(newPrice.replace(",", ".")) || 0;
    const amount = qty * price;
    if (!newDesc.trim() || amount <= 0) {
      // Empty row — just close without adding
      setAdding(false);
      setNewDesc("");
      setNewQty("1");
      setNewPrice("");
      return;
    }
    const newItem: LineItem = {
      id: uid(),
      description: newDesc.trim(),
      quantity: qty || 1,
      unitPrice: price,
      amount,
      glAccount: GL_ACCOUNTS[0]!,
      department: DEPARTMENTS[0]!,
    };
    onChange([...items, newItem]);
    setAdding(false);
    setNewDesc("");
    setNewQty("1");
    setNewPrice("");
  }, [newDesc, newQty, newPrice, items, onChange]);

  const cancelNewRow = useCallback(() => {
    setAdding(false);
    setNewDesc("");
    setNewQty("1");
    setNewPrice("");
  }, []);

  const handleAdd = useCallback(() => {
    setAdding(true);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      if (!onChange) return;
      onChange(items.filter((li) => li.id !== id));
    },
    [items, onChange],
  );

  const handleCommitRow = useCallback(
    (id: string, next: LineItem) => {
      if (!onChange) return;
      onChange(items.map((li) => (li.id === id ? { ...li, ...next } : li)));
    },
    [items, onChange],
  );

  const isEmpty = items.length === 0 && !adding;

  return (
    <div className="overflow-hidden">
      {/* Column headers (desktop only) */}
      {(items.length > 0 || adding) && <ColumnHeader />}

      {/* Rows */}
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title={editable ? "No line items yet" : "No line items were detected on this document."}
          action={
            editable ? (
              <button
                type="button"
                onClick={handleAdd}
                className="inline-flex items-center gap-1.5 rounded-full border border-input bg-transparent px-5 py-2 text-xs font-medium text-foreground transition-[background-color,color,transform] duration-200 ease-out-expo hover:bg-secondary active:scale-95"
              >
                <Plus className="size-3.5" /> Add first item
              </button>
            ) : undefined
          }
        >
          {editable ? "Add items manually or they will appear after extraction" : undefined}
        </EmptyState>
      ) : (
        <>
          {items.map((item, index) =>
            editable && onChange ? (
              <EditableRow
                key={item.id}
                item={item}
                currency={currency}
                onCommit={(next) => handleCommitRow(item.id, next)}
                onDelete={() => handleDelete(item.id)}
                isLast={!adding && index === items.length - 1}
              />
            ) : (
              <DisplayRow
                key={item.id}
                item={item}
                currency={currency}
                editable={editable}
                onDelete={() => handleDelete(item.id)}
                isLast={!adding && index === items.length - 1}
              />
            ),
          )}

          {/* New row being added */}
          {adding && (
            <RowFields
              description={newDesc}
              quantity={newQty}
              unitPrice={newPrice}
              currency={currency}
              onDescriptionChange={setNewDesc}
              onQuantityChange={setNewQty}
              onUnitPriceChange={setNewPrice}
              autoFocus
              isLast
            />
          )}

          {/* Reconciliation footer — lines vs subtotal / tax / total */}
          {showTotals && (
            <div className="border-t border-border bg-secondary/50 px-4 py-2.5">
              {(() => {
                const linesMatch =
                  subtotal !== undefined && subtotal > 0
                    ? Math.abs(total - subtotal) <= 0.02
                    : invoiceTotal !== undefined
                      ? Math.abs(total - invoiceTotal) <= 0.02
                      : true;
                const totalsMatch =
                  subtotal !== undefined &&
                  tax !== undefined &&
                  invoiceTotal !== undefined &&
                  (subtotal > 0 || tax > 0)
                    ? Math.abs(subtotal + tax - invoiceTotal) <= 0.02
                    : true;
                const row =
                  "grid w-full grid-cols-[minmax(0,1fr)_minmax(7rem,45%)] items-center gap-3 py-1";
                const label = "text-xs text-muted-foreground";
                const val =
                  "flex h-8 w-full min-w-0 items-center justify-end rounded-md border border-border bg-background px-2.5 text-right font-mono text-xs font-medium tabular-nums";
                return (
                  <div>
                    <div className={row}>
                      <span className="text-xs font-semibold  text-muted-foreground">
                        Lines total
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                        {money(total, currency)}
                        <span
                          className={linesMatch ? "text-foreground" : "text-warning-foreground"}
                          aria-label={linesMatch ? "lines match" : "lines differ"}
                        >
                          {linesMatch ? "✓" : "!"}
                        </span>
                      </span>
                    </div>
                    {subtotal !== undefined &&
                      tax !== undefined &&
                      invoiceTotal !== undefined &&
                      (subtotal > 0 || tax > 0) && (
                        <div className="mt-1 space-y-0.5 border-t border-border/60 pt-1.5">
                          <div className={row}>
                            <span className={label}>Subtotal</span>
                            <span className={val}>{money(subtotal, currency)}</span>
                          </div>
                          <div className={row}>
                            <span className={label}>Tax</span>
                            <span className={val}>{money(tax, currency)}</span>
                          </div>
                          <div className={row}>
                            <span className={label}>Total</span>
                            <span className={`${val} flex items-center gap-1.5`}>
                              {money(invoiceTotal, currency)}
                              <span
                                className={totalsMatch ? "text-foreground" : "text-warning-foreground"}
                                aria-label={totalsMatch ? "totals match" : "totals differ"}
                              >
                                {totalsMatch ? "✓" : "!"}
                              </span>
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* Add button — only when items exist and not currently adding */}
      {editable && !adding && (
        <button
          type="button"
          onClick={handleAdd}
          className="flex w-full items-center justify-start gap-2 border-t border-border/60 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Plus className="size-3.5" />
          Add line item
        </button>
      )}

      {/* Inline actions when adding */}
      {adding && (
        <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-4 py-2">
          <button
            type="button"
            onClick={cancelNewRow}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commitNewRow}
            className="rounded-full border border-input bg-transparent px-4 py-1.5 text-xs font-medium text-foreground transition-[background-color,color,transform] duration-200 ease-out-expo hover:bg-secondary active:scale-95"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
