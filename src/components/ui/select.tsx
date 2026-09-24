"use client";

import * as React from "react";

import { ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";

type SelectContextValue = {
  value: string | undefined;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  registerItem: (value: string, label: React.ReactNode) => () => void;
  getItemLabel: (value: string) => React.ReactNode | undefined;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const context = React.useContext(SelectContext);
  if (!context) throw new Error(`${component} must be used inside <Select>`);
  return context;
}

type SelectProps = {
  children: React.ReactNode;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
};

function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  className,
}: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const items = React.useRef(new Map<string, React.ReactNode>());
  const currentValue = value ?? internalValue;

  const setValue = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternalValue(next);
      onValueChange?.(next);
      setOpen(false);
    },
    [onValueChange, value],
  );

  const registerItem = React.useCallback((itemValue: string, label: React.ReactNode) => {
    items.current.set(itemValue, label);
    return () => items.current.delete(itemValue);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const context = React.useMemo<SelectContextValue>(
    () => ({
      value: currentValue,
      setValue,
      open,
      setOpen,
      disabled,
      registerItem,
      getItemLabel: (itemValue) => items.current.get(itemValue),
    }),
    [currentValue, disabled, open, registerItem, setValue],
  );

  return (
    <SelectContext.Provider value={context}>
      <div ref={rootRef} className={cn("relative inline-block w-full", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { children?: React.ReactNode }
>(({ children, className, disabled, onClick, ...props }, ref) => {
  const select = useSelectContext("SelectTrigger");
  return (
    <button
      ref={ref}
      type="button"
      role="combobox"
      aria-expanded={select.open}
      aria-haspopup="listbox"
      disabled={disabled || select.disabled}
      className={cn(
        "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-secondary px-3 py-2 text-left text-sm text-foreground outline-none transition-colors hover:border-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) select.setOpen(!select.open);
      }}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform",
          select.open && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectValue = ({
  placeholder,
  children,
  className,
}: {
  placeholder?: string;
  children?: React.ReactNode;
  className?: string;
}) => {
  const select = useSelectContext("SelectValue");
  const selected = select.value ? (select.getItemLabel(select.value) ?? select.value) : undefined;
  return (
    <span className={cn(!selected && "text-muted-foreground", className)}>
      {children ?? selected ?? placeholder}
    </span>
  );
};

const SelectContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, children, ...props }, ref) => {
    const select = useSelectContext("SelectContent");
    return (
      <div
        ref={ref}
        role="listbox"
        hidden={!select.open}
        className={cn(
          "absolute left-0 top-[calc(100%+0.375rem)] z-50 max-h-64 min-w-full overflow-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<"button">, "value"> & { value: string }
>(({ value, className, children, disabled, onClick, ...props }, ref) => {
  const select = useSelectContext("SelectItem");
  const selected = select.value === value;
  const label = typeof children === "string" || typeof children === "number" ? children : value;

  React.useEffect(() => select.registerItem(value, label), [label, select, value]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent-soft focus:bg-accent-soft disabled:pointer-events-none disabled:opacity-50",
        selected && "bg-primary-soft text-primary-soft-foreground",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) select.setValue(value);
      }}
      {...props}
    >
      {children}
    </button>
  );
});
SelectItem.displayName = "SelectItem";

const SelectGroup = ({ children, ...props }: React.ComponentProps<"div">) => (
  <div role="group" {...props}>
    {children}
  </div>
);
const SelectLabel = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    className={cn("px-2.5 py-1.5 text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
);
const SelectSeparator = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div role="separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
);

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
