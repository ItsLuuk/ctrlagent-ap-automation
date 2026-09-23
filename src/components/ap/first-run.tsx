/**
 * First run — the empty inbox.
 *
 * One screen, one intent: get the first document in. A new operator has no queue
 * to read, so every element here either performs the upload or states what this
 * product is for. The promise is that statement, and this is the one place it is
 * said — the three-step explainer that used to sit beneath it told the same two
 * halves again in longer words, while the upload dialog and the draft screen
 * teach the flow at the moment it happens.
 *
 * The demo set is offered, not applied: a quiet line at the bottom, with no
 * explanation — Settings is where demo data is described in full.
 */
import { InvoiceStack } from "@/components/icons";
import { UploadDialog } from "@/components/ap/upload-dialog";
import { useAp } from "@/lib/ap/store";

export function FirstRun() {
  const { loadSampleData } = useAp();

  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <InvoiceStack className="mx-auto size-6 text-muted-foreground" />

      <h2 className="mt-4 text-nav-title font-semibold">No invoices yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The system handles the routine. You handle the judgment.
      </p>

      <div className="mt-7 flex flex-col items-center gap-2.5">
        <UploadDialog size="lg" />
        <p className="text-xs text-muted-foreground">…or drop a PDF anywhere in this window.</p>
      </div>

      <div className="mx-auto mt-10 max-w-2xl border-t border-border/50 pt-4">
        <button
          type="button"
          onClick={loadSampleData}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Look around with sample data
        </button>
      </div>
    </div>
  );
}
