import { X } from "@/components/icons";
import { TAG_TONES } from "@/lib/ap/types";
import { cn } from "@/lib/utils";

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  if (tag === "Recurring") return null;
  const tone = (TAG_TONES as Record<string, { border: string; accent: string }>)[tag] ?? {
    border: "border-border",
    accent: "text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium",
        tone.accent,
      )}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}
