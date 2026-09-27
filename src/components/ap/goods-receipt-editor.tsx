import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PurchaseOrder } from "@/lib/ap/purchase-order";

type GoodsReceiptEditorProps = {
  purchaseOrder: PurchaseOrder;
  onRecord: (
    poId: string,
    poLineId: string,
    quantityReceived: number,
    actor?: string,
  ) => { accepted: boolean; reason?: string | undefined };
};

export function GoodsReceiptEditor({
  purchaseOrder,
  onRecord,
}: GoodsReceiptEditorProps) {
  const [selectedLineId, setSelectedLineId] = useState(purchaseOrder.lines[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");

  useEffect(() => {
    if (!purchaseOrder.lines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(purchaseOrder.lines[0]?.id ?? "");
    }
  }, [purchaseOrder.lines, selectedLineId]);

  const receiptsByLine = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of purchaseOrder.receipts) {
      totals.set(receipt.poLineId, (totals.get(receipt.poLineId) ?? 0) + receipt.quantityReceived);
    }
    return totals;
  }, [purchaseOrder.receipts]);

  const selectedLine = purchaseOrder.lines.find((line) => line.id === selectedLineId);
  const recordReceipt = () => {
    const parsedQuantity = Number(quantity.replace(",", "."));
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Enter a received quantity greater than zero.");
      return;
    }
    const result = onRecord(purchaseOrder.id, selectedLineId, parsedQuantity);
    if (!result.accepted) {
      toast.error(result.reason ?? "The receipt could not be recorded.");
      return;
    }
    setQuantity("");
    toast.success("Goods receipt recorded", {
      description: `${selectedLine?.description ?? "PO line"} · ${parsedQuantity} received.`,
    });
  };

  return (
    <div className="space-y-3 rounded-lg bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Goods receipts</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Record what arrived against each ordered line.
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {purchaseOrder.receipts.length} recorded
        </span>
      </div>

      {purchaseOrder.lines.length > 0 ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
            <Select value={selectedLineId} onValueChange={setSelectedLineId}>
              <SelectTrigger aria-label="Goods receipt PO line" className="h-9">
                <SelectValue placeholder="Choose a PO line" />
              </SelectTrigger>
              <SelectContent>
                {purchaseOrder.lines.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {line.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Quantity received"
              type="number"
              min="0"
              step="any"
              placeholder="Qty"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-9"
            />
            <Button type="button" size="sm" onClick={recordReceipt} className="h-9">
              Record
            </Button>
          </div>

          <div className="space-y-2">
            {purchaseOrder.lines.map((line) => {
              const receipts = purchaseOrder.receipts.filter(
                (receipt) => receipt.poLineId === line.id,
              );
              const received = receiptsByLine.get(line.id) ?? 0;
              return (
                <div key={line.id} className="rounded-md bg-card/70 px-3 py-2 shadow-whisper">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {line.description}
                    </span>
                    <span
                      className={
                        received >= line.quantity ? "text-success-foreground" : "text-muted-foreground"
                      }
                    >
                      {received}/{line.quantity} received
                    </span>
                  </div>
                  {receipts.length > 0 ? (
                    <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                      {receipts.map((receipt, index) => (
                        <div key={`${receipt.poLineId}-${index}`} className="flex justify-between gap-3">
                          <span>
                            {receipt.quantityReceived} · {receipt.source ?? "recorded"}
                          </span>
                          <span>
                            {receipt.recordedBy ?? "Unknown"}
                            {receipt.receivedAt
                              ? ` · ${new Date(receipt.receivedAt).toLocaleDateString()}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">This purchase order has no lines to receive.</p>
      )}
    </div>
  );
}
