/**
 * LineItemsEditor — the design doc's line-item sub-mode: draw the table
 * region, map columns once (never per-cell), and watch the live parsed
 * preview. Saved onto the vendor template as its `line_items` block.
 */
import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Table2, X } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { parseLineItemRows, wordsInRect } from "@/lib/ap/mapping";
import type { Invoice, LineItem, LineItemsSpec, OcrWord, Zone } from "@/lib/ap/types";

/** Fraction of the region width used as a new column band's half-width. */
const COLUMN_BAND_FRACTION = 0.12;
/** Minimum column band width (normalized) so bands never collapse. */
const MIN_BAND_WIDTH = 0.02;
/** Tolerance (normalized) for the sum-vs-total consistency check. */
const SUM_MATCH_TOLERANCE = 0.02;
/** First-click seed: region margins around the clicked row, normalized. */
const SEED_REGION = { x: 0.04, widthFraction: 0.92, height: 0.16, yMargin: 0.06, min: 0.01 };

type ColumnField = LineItemsSpec["columns"][number]["field"];

/** Re-inflates a stored spec region into a displayable zone. */
const specRegionToZone = (spec: LineItemsSpec): Zone => ({
  x: spec.region.x0,
  y: spec.region.y0,
  w: spec.region.x1 - spec.region.x0,
  h: spec.region.y1 - spec.region.y0,
});

/** Converts a display zone back into the persisted spec region shape. */
const zoneToSpecRegion = (zone: Zone): LineItemsSpec["region"] => ({
  x0: zone.x,
  y0: zone.y,
  x1: zone.x + zone.w,
  y1: zone.y + zone.h,
});

const parseRowsForPreview = (
  words: OcrWord[],
  region: Zone,
  columns: LineItemsSpec["columns"],
  excludeTotalRows: boolean,
): LineItem[] =>
  parseLineItemRows(words, {
    region: zoneToSpecRegion(region),
    columns,
    excludeTotalRows,
    mergeMultiLine: false,
  });

/** Click point in document coordinates (0..1), or null when outside. */
function clickPointIn(rect: DOMRect, clientX: number, clientY: number) {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

export function LineItemsEditor({
  invoice,
  words,
  imgSrc,
  existingSpec,
  onSave,
}: {
  invoice: Invoice;
  words: OcrWord[] | undefined;
  /** Blob URL of the rasterized page — images or rendered PDF page 1. */
  imgSrc: string | undefined;
  existingSpec: LineItemsSpec | undefined;
  onSave: (spec: LineItemsSpec) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [region, setRegion] = useState<Zone | undefined>(
    existingSpec ? specRegionToZone(existingSpec) : undefined,
  );
  const [columns, setColumns] = useState<LineItemsSpec["columns"]>(existingSpec?.columns ?? []);
  const [excludeTotalRows, setExcludeTotalRows] = useState(existingSpec?.excludeTotalRows ?? true);
  const [pendingClick, setPendingClick] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const parsedRows = useMemo(() => {
    if (!region || !words || columns.length === 0) return [];
    return parseRowsForPreview(words, region, columns, excludeTotalRows);
  }, [region, words, columns, excludeTotalRows]);

  const parsedSum = parsedRows.reduce((sum, item) => sum + item.amount, 0);
  const parsedSumMatchesTotal =
    parsedRows.length > 0 && Math.abs(parsedSum - invoice.total) <= SUM_MATCH_TOLERANCE;

  const handleImageClick = (event: React.MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image) return;
    const point = clickPointIn(image.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    setPendingClick(point);
    if (!region) {
      setRegion({
        x: SEED_REGION.x,
        y: Math.max(SEED_REGION.min, point.y - SEED_REGION.yMargin),
        w: SEED_REGION.widthFraction,
        h: SEED_REGION.height,
      });
      toast.info("Table region started", { description: "Adjust the column bands below." });
    }
  };

  const addColumn = (column: LineItemsSpec["columns"][number]) => {
    setColumns((previous) => [
      ...previous.filter((existing) => existing.field !== column.field),
      column,
    ]);
  };

  const removeColumnAtIndex = (index: number) =>
    setColumns((previous) => previous.filter((_, i) => i !== index));

  const save = () => {
    if (!region) return;
    onSave({
      region: zoneToSpecRegion(region),
      columns,
      excludeTotalRows,
      mergeMultiLine: false,
    });
    toast.success("We saved the line-item mapping to this vendor's template");
    setIsOpen(false);
  };

  return (
    <section className="rounded-lg bg-card shadow-whisper">
      <button
        type="button"
        className="flex w-full items-center justify-between border-b border-border px-4 py-2.5"
        onClick={() => setIsOpen((open) => !open)}
      >
        <p className="flex items-center gap-1.5 text-xs font-medium  text-muted-foreground">
          <Table2 className="size-3.5" /> Line items
        </p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {invoice.lineItems.length} detected
          <ChevronDown className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen && (
        <div className="space-y-3 p-4">
          {!words ? (
            <p className="text-xs text-muted-foreground">
              Line-item mapping needs the reading positions we kept for this invoice — new vendors
              only.
            </p>
          ) : (
            <>
              <div className="relative w-fit">
                {imgSrc ? (
                  <img
                    ref={imageRef}
                    src={imgSrc}
                    alt="Invoice"
                    onClick={handleImageClick}
                    className="block max-w-full cursor-crosshair rounded-lg border border-border"
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border bg-secondary/40 p-4 text-xs text-muted-foreground">
                    Image preview unavailable — set the region by clicking, then adjust the bands.
                  </p>
                )}
                {region && (
                  <div
                    className="pointer-events-none absolute border-2 border-accent bg-accent/10"
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.w * 100}%`,
                      height: `${region.h * 100}%`,
                    }}
                  >
                    {columns.map((column, index) => (
                      <div
                        key={index}
                        className="absolute border-l-2 border-dashed border-accent/60"
                        style={{
                          left: `${column.band.x0 * 100}%`,
                          top: 0,
                          height: "100%",
                          width: `${(column.band.x1 - column.band.x0) * 100}%`,
                        }}
                        title={column.anchor}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {region
                    ? `Region set — contains ~${wordsInRect(words, region).length} words`
                    : "Click the table on the document to place the region"}
                </span>
                {region && (
                  <div className="flex items-center gap-2">
                    <NewColumnForm region={region} pendingClick={pendingClick} onAdd={addColumn} />
                    <Button size="sm" variant="ghost" onClick={() => setColumns([])}>
                      Clear columns
                    </Button>
                  </div>
                )}
              </div>

              {columns.length > 0 && (
                <div className="space-y-1">
                  {columns.map((column, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-sm bg-card px-4 py-2 text-xs shadow-whisper"
                    >
                      <span className="font-medium">{column.field}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        anchor “{column.anchor}”
                        <button type="button" onClick={() => removeColumnAtIndex(index)}>
                          <X className="size-3" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={excludeTotalRows}
                  onCheckedChange={(checked) => setExcludeTotalRows(checked === true)}
                />
                Exclude Subtotal/Tax/Total rows
              </label>

              {parsedRows.length > 0 && (
                <div className="overflow-hidden rounded-lg shadow-whisper">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50 text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.map((item) => (
                        <tr key={item.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-1.5">{item.description}</td>
                          <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {item.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p
                className={`text-xs ${parsedSumMatchesTotal ? "text-muted-foreground" : "font-medium text-warning-foreground"}`}
              >
                {parsedRows.length > 0
                  ? `${parsedRows.length} rows parsed · sum ${parsedSum.toFixed(2)} vs total ${invoice.total.toFixed(2)} ${parsedSumMatchesTotal ? "✓" : "— mismatch"}`
                  : "Parsed preview appears here once the region and columns are set."}
              </p>

              <Button size="sm" disabled={!region || columns.length === 0} onClick={save}>
                <Check className="size-3.5" /> Save line-item mapping
              </Button>
              {!region ? (
                <p className="text-xs text-muted-foreground">
                  Draw a region first — the band is where the line-item columns live.
                </p>
              ) : columns.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add at least one column before saving — a band without columns maps nothing.
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Column field picker + optional header anchor, creating a band on add. */
function NewColumnForm({
  region,
  pendingClick,
  onAdd,
}: {
  region: Zone;
  pendingClick: { x: number; y: number } | null;
  onAdd: (column: LineItemsSpec["columns"][number]) => void;
}) {
  const [field, setField] = useState<Exclude<ColumnField, "ignore">>("amount");
  const [headerAnchor, setHeaderAnchor] = useState("");

  const addColumn = () => {
    // Band: full region height, centered on the last clicked point (or the
    // region center when nothing has been clicked yet).
    const centerX = pendingClick?.x ?? region.x + region.w / 2;
    const bandLeft = Math.max(
      region.x,
      Math.min(region.x + region.w, centerX - region.w * COLUMN_BAND_FRACTION),
    );
    const bandRight = Math.max(
      bandLeft + MIN_BAND_WIDTH,
      Math.min(region.x + region.w, centerX + region.w * COLUMN_BAND_FRACTION),
    );
    onAdd({
      anchor: headerAnchor || field,
      field,
      band: {
        x0: (bandLeft - region.x) / region.w,
        y0: 0,
        x1: (bandRight - region.x) / region.w,
        y1: 1,
      },
    });
    setHeaderAnchor("");
  };

  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs text-muted-foreground">Column</Label>
      <select
        className="h-10 rounded-sm border border-input bg-transparent px-3 text-xs"
        value={field}
        onChange={(event) => setField(event.target.value as typeof field)}
      >
        <option value="description">description</option>
        <option value="quantity">qty</option>
        <option value="unitPrice">unit price</option>
        <option value="amount">amount</option>
      </select>
      <Input
        className="h-10 w-28 text-xs"
        placeholder="header text"
        value={headerAnchor}
        onChange={(event) => setHeaderAnchor(event.target.value)}
      />
      <Button size="sm" variant="outline" className="h-10 px-3 text-xs" onClick={addColumn}>
        Add
      </Button>
    </div>
  );
}
