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
 * The promise is one sentence: from PDF to bookkeeping-ready, without sending
 * invoice data to the cloud. The supporting line keeps the boundary explicit:
 * Foundry prepares the record for review; the human approves, and no payment
 * is sent.
 */
import { InvoiceStack } from "@/components/icons";
import { UploadDialog } from "@/components/ap/upload-dialog";
import { useAp } from "@/lib/ap/store";

export function FirstRun() {
  const { loadSampleData } = useAp();

  return (
    <div className="mx-auto max-w-4xl rounded-lg border border-border bg-card px-6 py-16 text-center shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_80px_rgba(0,0,0,0.12)] sm:px-12">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-foreground text-background shadow-sm">
        <InvoiceStack className="size-6" />
      </span>

      <h2 className="mt-6 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
        No invoices yet
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-xl leading-relaxed text-foreground">
        Automate AP from PDF to bookkeeping-ready—without sending invoice data to the cloud.
      </p>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Foundry extracts and prepares each invoice for review. You approve the record; Foundry never
        sends a payment.
      </p>

      <div className="mt-8 flex flex-col items-center gap-2">
        <UploadDialog size="lg" />
        <p className="text-xs text-muted-foreground">…or drop a PDF anywhere in this window.</p>
      </div>

      <div className="mx-auto mt-10 max-w-lg border-t border-border/50 pt-4">
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
