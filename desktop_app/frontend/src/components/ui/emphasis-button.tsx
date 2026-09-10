import * as React from "react";
import { ChevronRight, Sparkles } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmphasisButtonProps extends ButtonProps {
  /** Hide decorative side icons (e.g. when space is tight). */
  hideAccents?: boolean;
}

const EmphasisButton = React.forwardRef<HTMLButtonElement, EmphasisButtonProps>(
  ({ className, children, hideAccents = false, variant = "secondary", ...props }, ref) => (
    <Button ref={ref} variant={variant} className={cn("gap-2", className)} {...props}>
      {!hideAccents && (
        <Sparkles className="size-3 shrink-0 text-[var(--color-muted-foreground)]" strokeWidth={2} aria-hidden="true" />
      )}
      <span>{children}</span>
      {!hideAccents && (
        <ChevronRight className="size-3 shrink-0 text-[var(--color-muted-foreground)]" strokeWidth={2} aria-hidden="true" />
      )}
    </Button>
  ),
);
EmphasisButton.displayName = "EmphasisButton";

export { EmphasisButton };
