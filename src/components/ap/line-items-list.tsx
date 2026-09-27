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
import { colorClasses } from "@/lib/colors";
import { EmptyState } from "@/components/ap/primitives";

/* ── Inline editable row ───────────────────────────────────────────── */

function InlineEditRow({
  description,
  quantity,
  unitPrice,
  currency,
  onDescriptionChange,
  onQuantityChange,
  onUnitPriceChange,
  autoFocus,
  isLast,
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
}) {
  const descRef = useRef<HTMLInputElement>(null);
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice.replace(",", ".")) || 0;
  const amount = qty * price;

  useEffect(() => {
    if (!autoFocus) return;
    // Small delay to ensure the row is rendered before focusing
    const timer = setTimeout(() => descRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_70px_100px_90px_32px]",
        !isLast && "border-b border-border/60",
      )}
    >
      {/* Description */}
      <input
        ref={descRef}
        type="text"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="Description"
        className="min-w-0 truncate rounded-sm bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Quantity */}
      <input
        type="text"
        inputMode="numeric"
        value={quantity}
        onChange={(e) => onQuantityChange(e.target.value)}
        placeholder="1"
        className="w-full rounded-sm bg-transparent font-mono text-sm text-right outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Unit price */}
      <input
        type="text"
        inputMode="decimal"
        value={unitPrice}
        onChange={(e) => onUnitPriceChange(e.target.value)}
        placeholder="0.00"
        className="w-full rounded-sm bg-transparent font-mono text-sm text-right outline-none placeholder:text-muted-foreground/50 focus-visible:bg-accent/60"
      />

      {/* Amount (computed, read-only) */}
      <span className="font-mono text-sm text-right text-foreground">
        {amount > 0 ? money(amount, currency) : ""}
      </span>

      {/* Spacer for delete button column */}
      <span />
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
  return (
    <div
      className={cn(
        "group grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_70px_100px_90px_32px]",
        !isLast && "border-b border-border/60",
      )}
    >
      {/* Description */}
      <span className="truncate text-sm font-medium">{item.description}</span>

      {/* Quantity */}
      <span className="font-mono text-sm text-right text-muted-foreground">{item.quantity}</span>

      {/* Unit price */}
      <span className="font-mono text-sm text-right text-muted-foreground">
        {money(item.unitPrice, currency)}
      </span>

      {/* Amount */}
      <span className="font-mono text-sm text-right font-medium">
        {money(item.amount, currency)}
      </span>

      {/* Delete */}
      {editable && onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="justify-self-end rounded-sm p-1 text-muted-foreground/0 transition-colors ease-out-expo hover:bg-destructive/10 hover:text-destructive group-hover:text-muted-foreground"
          aria-label={`Remove ${item.description}`}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

/* ── Column header ─────────────────────────────────────────────────── */

function ColumnHeader() {
  return (
    <div className="hidden grid-cols-[1fr_70px_100px_90px_32px] gap-2 border-b border-border bg-secondary/50 px-4 py-2 text-[11px] font-medium  text-muted-foreground sm:grid">
      <span>Description</span>
      <span className="text-right">Qty</span>
      <span className="text-right">Unit price</span>
      <span className="text-right">Amount</span>
      <span />
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────── */

export function LineItemsList({
  items,
  currency,
  editable,
  isDraft = editable,
  onChange,
  subtotal,
  tax,
  invoiceTotal,
}: {
  items: LineItem[];
  currency: string;
  editable?: boolean;
  /** The record may still change: line items are facts once it leaves draft.
   *  Defaults to `editable` so a caller without a status keeps today's reach. */
  isDraft?: boolean | undefined;
  onChange?: ((items: LineItem[]) => void) | undefined;
  subtotal?: number | undefined;
  tax?: number | undefined;
  invoiceTotal?: number | undefined;
}) {
  /** When non-null, a new row is being added inline. */
  const [adding, setAdding] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newPrice, setNewPrice] = useState("");

  const total = items.reduce((sum, li) => sum + li.amount, 0);

  const commitNewRow = useCallback(() => {
    if (!onChange) return;
    const qty = Number(newQty) || 0;
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

  const isEmpty = items.length === 0 && !adding;

  return (
    <div className="overflow-hidden">
      {/* Column headers (desktop only) */}
      {items.length > 0 && <ColumnHeader />}

      {/* Rows */}
      {isEmpty ? (
        <EmptyState
          variant="inline"
          title={editable && isDraft ? "No line items yet" : "No line items were detected on this document."}
          action={
            editable && isDraft ? (
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
          {editable && isDraft ? "Add items manually or they will appear after extraction" : undefined}
        </EmptyState>
      ) : (
        <>
          {items.map((item, index) => (
            <DisplayRow
              key={item.id}
              item={item}
              currency={currency}
              editable={editable && isDraft}
              onDelete={() => handleDelete(item.id)}
              isLast={!adding && index === items.length - 1}
            />
          ))}

          {/* New row being added */}
          {adding && (
            <InlineEditRow
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
              const row = "flex items-center justify-between py-0.5";
              const label = "text-xs text-muted-foreground";
              const val = "font-mono text-xs font-medium";
              return (
                <div>
                  <div className={row}>
                    <span className="text-xs font-semibold  text-muted-foreground">
                      Lines total
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                      {money(total, currency)}
                      <span
                        className={linesMatch ? "text-foreground" : "text-foundry-orange"}
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
                              className={totalsMatch ? "text-foreground" : "text-foundry-orange"}
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
        </>
      )}

      {/* Add button — only when items exist, not currently adding, and the
            record is still a draft (line items are facts once the record leaves
            draft; the amounts block already shows what is there). */}
      {editable && isDraft && !adding && (
        <button
          type="button"
          onClick={handleAdd}
          className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground active:bg-secondary"
        >
          <Plus className="size-3.5" />
          Add item
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
