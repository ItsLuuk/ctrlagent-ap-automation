import * as React from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "onChange" | "size"> & {
  onCheckedChange?: (checked: boolean) => void;
  size?: string | number;
};

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, size: _size, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 shrink-0 cursor-pointer appearance-none rounded border border-input bg-secondary outline-none transition-colors checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
