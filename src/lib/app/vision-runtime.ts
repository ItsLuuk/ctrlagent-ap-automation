/**
 * Composition-root wiring for the vision port.
 *
 * The domain declares what a vision engine must do (`@/lib/ap/vision`); this
 * is where the app hands it one. Keeping the call in the outer layer is what
 * lets `ocr.ts` and the adapter point inwards only — before the port existed,
 * the two imported each other and the cycle had no seam to cut.
 */
import { gemmaVisionEngine } from "@/lib/ai/gemma";
import { setVisionEngine } from "@/lib/ap/vision";

let registered = false;

/**
 * Idempotent: both roots call it, and a hot reload can re-run the module.
 * Safe to call before any provider mounts — an upload cannot start sooner.
 */
export function registerVisionEngine(): void {
  if (registered) return;
  registered = true;
  setVisionEngine(gemmaVisionEngine);
}
