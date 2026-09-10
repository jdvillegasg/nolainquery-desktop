import { useEffect, useState } from "react";
import { INSIGHT_DEFS } from "./insightDefs";
import type { InsightColor, InsightsData } from "./types";
import { cn } from "@/lib/utils";

interface InsightsPanelProps {
  insights: InsightsData;
}

/** Neutral background intensity encodes quality (good → light, concern → darker). */
const statusBg: Record<InsightColor, string> = {
  green: "bg-[#fafafa]",
  amber: "bg-[#f2f2f2]",
  red: "bg-[#e8e8e8]",
};

const detailBg: Record<InsightColor, string> = {
  green: "bg-[#fafafa]",
  amber: "bg-[#f4f4f4]",
  red: "bg-[#efefef]",
};

export default function InsightsPanel({ insights }: InsightsPanelProps) {
  const [selectedId, setSelectedId] = useState(INSIGHT_DEFS[0].id);

  useEffect(() => {
    setSelectedId(INSIGHT_DEFS[0].id);
  }, [insights]);

  const selected = INSIGHT_DEFS.find((d) => d.id === selectedId) ?? INSIGHT_DEFS[0];
  const selectedColor = selected.getColor(insights);

  return (
    <section className="flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Data quality
        </h2>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {insights.total_cols} columns · {formatRows(insights.total_rows)} rows
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 max-[1100px]:grid-cols-3 max-[900px]:grid-cols-2" role="tablist" aria-label="Dataset quality metrics">
        {INSIGHT_DEFS.map((def) => {
          const cardColor = def.getColor(insights);
          const isActive = def.id === selectedId;
          return (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedId(def.id)}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-all duration-200 ease-out",
                isActive
                  ? "border-stone-300 bg-stone-100 active:scale-[0.98]"
                  : cn(
                      statusBg[cardColor],
                      "border-[var(--color-border)] hover:border-stone-300 hover:bg-stone-100 hover:-translate-y-px active:scale-[0.98]",
                    ),
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                {def.label}
              </span>
              <span className="font-[family-name:var(--font-mono)] text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
                {def.getValue(insights)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-3 transition-colors duration-200",
          detailBg[selectedColor],
        )}
      >
        <p className="text-[15px] font-medium leading-snug tracking-tight text-[var(--color-foreground)]">
          {selected.getHeadline(insights)}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {selected.getPhrase(insights)}
        </p>
      </div>
    </section>
  );
}

function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
