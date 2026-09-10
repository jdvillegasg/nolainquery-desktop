import { AlertCircle, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatSkipReason,
  importableTables,
  skippedTables,
  type WorkbookCatalog,
} from "@/lib/workbook";
import { cn } from "@/lib/utils";

interface WorkbookTablePickerProps {
  catalog: WorkbookCatalog;
  onSelectTable: (tableId: string) => void;
  onForceInclude?: (sheetName: string) => void;
  /** Renders inside DatasetStrip without its own card wrapper. */
  embedded?: boolean;
}

export default function WorkbookTablePicker({
  catalog,
  onSelectTable,
  onForceInclude,
  embedded = false,
}: WorkbookTablePickerProps) {
  const tables = importableTables(catalog);
  const skipped = skippedTables(catalog);

  if (catalog.source_kind !== "excel") {
    return null;
  }

  const hasMultipleTables = tables.length > 1;
  const hasSkipped = skipped.length > 0;

  if (!hasMultipleTables && !hasSkipped) {
    return null;
  }

  const content = (
    <>
      {hasMultipleTables && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Workbook sheets">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Sheets
          </span>
          {tables.map((table) => {
            const active = table.id === catalog.active_table_id;
            return (
              <button
                key={table.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectTable(table.id)}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium transition-all duration-200 ease-out",
                  active
                    ? "border-stone-400 bg-stone-900 text-white shadow-sm active:scale-[0.98]"
                    : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:border-stone-300 hover:bg-stone-50 hover:text-[var(--color-foreground)] active:scale-[0.98]",
                )}
              >
                {table.sheet_name}
                {table.row_count != null && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-1.5 py-0 text-[10px] tabular-nums",
                      active
                        ? "border-white/30 bg-white/10 text-white"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
                    )}
                  >
                    {table.row_count.toLocaleString()}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {hasSkipped && (
        <details className="group text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-amber-900 [&::-webkit-details-marker]:hidden">
            <AlertCircle className="size-3.5 shrink-0" />
            <span className="font-medium">
              {skipped.length} skipped sheet{skipped.length === 1 ? "" : "s"}
            </span>
            <span className="text-amber-800/70 group-open:hidden">— show</span>
          </summary>
          <ul className="mt-2 space-y-1.5 rounded-[var(--radius-md)] border border-amber-200/80 bg-amber-50/70 px-3 py-2">
            {skipped.map((table) => (
              <li
                key={table.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950"
              >
                <span>
                  <span className="font-medium">{table.sheet_name}</span>
                  <span className="text-amber-800/80"> — {formatSkipReason(table.skip_reason)}</span>
                </span>
                {onForceInclude && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-amber-950 hover:bg-amber-100"
                    onClick={() => onForceInclude(table.sheet_name)}
                  >
                    Import anyway
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">{content}</div>;
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Table2 className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Workbook tables
        </h2>
      </div>
      {content}
    </section>
  );
}
