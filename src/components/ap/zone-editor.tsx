import { useRef, useState, type PointerEvent } from "react";
import { Save } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ZONE_FIELDS,
  ZONE_LABEL,
  type ExtractedField,
  type Invoice,
  type Zone,
  type ZoneMap,
} from "@/lib/ap/types";

/** Default anchor when an invoice/wallet has no zones yet (a 3-column grid). */
function seedZones(): ZoneMap {
  const zones: ZoneMap = {};
  ZONE_FIELDS.forEach((field, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    zones[field] = {
      x: 0.02 + col * 0.32,
      y: 0.08 + row * 0.3,
      w: 0.32,
      h: 0.15,
    };
  });
  return zones;
}
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type DragState = {
  field: ExtractedField;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  rect: Zone;
};

/**
 * Draggable/resizable overlay over an uploaded invoice image. Coordinates are
 * normalized to the displayed image so they apply at any render size.
 */
export function ZoneEditor({
  invoice,
  onSave,
}: {
  invoice: Invoice;
  onSave: (zones: ZoneMap) => void;
}) {
  const [zones, setZones] = useState<ZoneMap>(() => invoice.zones ?? seedZones());
  const drag = useRef<DragState | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);

  const begin =
    (field: ExtractedField, mode: "move" | "resize") => (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = imgWrapRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return;
      drag.current = {
        field,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        rect: zones[field] ?? { x: 0, y: 0, w: 0.1, h: 0.1 },
      };
      imgWrapRef.current?.setPointerCapture(e.pointerId);
    };

  const unset = () => {
    drag.current = null;
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const wrap = imgWrapRef.current?.getBoundingClientRect();
    if (!d || !wrap?.width || !wrap.height) return;
    const dx = (e.clientX - d.startX) / wrap.width;
    const dy = (e.clientY - d.startY) / wrap.height;
    const { rect } = d;
    const next: Zone =
      d.mode === "move"
        ? {
            x: r3(clamp(rect.x + dx, 0.01, 1 - rect.w - 0.01)),
            y: r3(clamp(rect.y + dy, 0.01, 1 - rect.h - 0.01)),
            w: rect.w,
            h: rect.h,
          }
        : {
            x: rect.x,
            y: rect.y,
            w: r3(clamp(rect.w + dx, 0.05, 1 - rect.x - 0.01)),
            h: r3(clamp(rect.h + dy, 0.05, 1 - rect.y - 0.01)),
          };
    setZones((prev) => ({ ...prev, [d.field]: next }));
  };

  return (
    <div>
      <div
        ref={imgWrapRef}
        className="relative"
        onPointerMove={move}
        onPointerUp={unset}
        onPointerCancel={unset}
      >
        <img
          src={invoice.fileUrl}
          alt={invoice.fileName ?? "Invoice"}
          className="pointer-events-none block max-w-full rounded-lg border border-border "
        />
        {ZONE_FIELDS.map((field) => {
          const z = zones[field];
          if (!z) return null;
          return (
            <div
              key={field}
              onPointerDown={begin(field, "move")}
              className="absolute box-border cursor-move touch-none rounded-sm border-2 border-accent bg-accent/15"
              style={{
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.w * 100}%`,
                height: `${z.h * 100}%`,
              }}
            >
              <span className="absolute left-1.5 top-0.5 text-xs font-medium  text-accent-foreground">
                {ZONE_LABEL[field]}
              </span>
              <div
                onPointerDown={begin(field, "resize")}
                className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border border-background bg-accent"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Drag a box onto each field, resize with the corner handle, then save.
        </p>
        <Button
          size="sm"
          onClick={() => {
            onSave(zones);
            toast.success(`We saved the field positions for ${invoice.vendor}`);
          }}
        >
          <Save className="size-3.5" /> Save field positions
        </Button>
      </div>
    </div>
  );
}
