import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface LlmModelOption {
  id: string;
  label: string;
  default?: boolean;
}

interface ModelSelectProps {
  models: LlmModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelect({ models, value, onChange, disabled = false }: ModelSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);

  const showTip = () => {
    if (disabled || selectOpen) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({ x: r.left + r.width / 2, y: r.top });
  };

  const hideTip = () => setTipPos(null);

  const handleOpenChange = (open: boolean) => {
    setSelectOpen(open);
    if (open) hideTip();
  };

  return (
    <>
      <div className="inline-flex items-center gap-1.5 shrink-0">
        <span className="text-[11px] font-[family-name:var(--font-nav)] font-[600] text-[var(--color-muted-foreground)]">
          Model
        </span>
        <Select value={value} onValueChange={onChange} disabled={disabled} onOpenChange={handleOpenChange}>
          <SelectTrigger
            ref={triggerRef}
            className="w-[180px]"
            aria-label="Select LLM model"
            aria-describedby={tipPos ? "model-select-tooltip" : undefined}
            onMouseEnter={showTip}
            onMouseLeave={hideTip}
            onFocus={showTip}
            onBlur={hideTip}
            onPointerDown={hideTip}
          >
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent side="top" align="start" sideOffset={4}>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {tipPos && !disabled && !selectOpen && createPortal(
        <div
          id="model-select-tooltip"
          className="dag-computation-graph-tooltip"
          style={{ left: tipPos.x, top: tipPos.y }}
          role="tooltip"
        >
          <p className="dag-computation-graph-tooltip-body dag-computation-graph-tooltip-body--solo">
            GPT-5.6 Luna offers the best balance of token cost and code that runs
            on the first try. DeepSeek V4 Flash uses the fewest tokens per question
            but succeeds less often than Luna. Other models can handle more complex
            questions but tend to consume more tokens.
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
