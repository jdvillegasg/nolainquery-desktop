import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Shared hover/active for every button variant — background shift + press. */
const buttonInteraction =
  "transition-all duration-200 ease-out hover:bg-stone-100 active:scale-[0.98]";

const buttonVariants = cva(
  cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] border text-sm font-medium",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]",
    "disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    buttonInteraction,
  ),
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] hover:border-stone-300",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] hover:border-stone-300",
        ghost:
          "border-transparent bg-transparent text-[var(--color-muted-foreground)] hover:border-transparent hover:text-[var(--color-foreground)]",
        outline:
          "border-[var(--color-border)] bg-transparent text-[var(--color-foreground)] hover:border-stone-300",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[var(--radius-sm)] px-3 text-xs",
        lg: "h-10 rounded-[var(--radius-md)] px-5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
