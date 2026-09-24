import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out-expo outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
        outline:
          "border border-input bg-card text-foreground hover:border-ring/50 hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost:
          "bg-transparent text-foreground hover:bg-accent-soft hover:text-accent-soft-foreground",
        link: "h-auto rounded-md bg-transparent p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      loading = false,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
