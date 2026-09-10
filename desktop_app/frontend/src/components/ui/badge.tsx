import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]",
        outline: "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
        success: "border-emerald-200 bg-emerald-50 text-emerald-800",
        warning: "border-amber-200 bg-amber-50 text-amber-800",
        danger: "border-rose-200 bg-rose-50 text-rose-800",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
