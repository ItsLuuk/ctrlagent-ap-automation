import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-20 w-full resize-y rounded-lg border border-input bg-secondary px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground hover:border-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
