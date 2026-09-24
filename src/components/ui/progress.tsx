import * as React from "react";

import { cn } from "@/lib/utils";

type ProgressProps = Omit<React.ComponentProps<"div">, "children"> & {
  value?: number;
};

function Progress({ className, value = 0, ...props }: ProgressProps) {
  const normalized = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out-expo"
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}

export { Progress };
