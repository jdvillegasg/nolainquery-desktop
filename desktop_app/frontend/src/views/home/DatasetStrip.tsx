import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmphasisButton } from "@/components/ui/emphasis-button";
import { Badge } from "@/components/ui/badge";
import type { WorkbookCatalog } from "@/lib/workbook";
import WorkbookTablePicker from "./WorkbookTablePicker";

interface DatasetStripProps {
  filePath: string;
  displayLabel?: string;
  rowCount: number | null;
  columnCount: number | null;
  workbookCatalog?: WorkbookCatalog | null;
  onChangeFile: () => void;
  onAsk: () => void;
  onExplore: () => void;
  onSelectWorkbookTable?: (tableId: string) => void;
  onForceIncludeSheet?: (sheetName: string) => void;
}

export default function DatasetStrip({
  filePath,
  displayLabel,
  rowCount,
  columnCount,
  workbookCatalog,
  onChangeFile,
  onAsk,
  onExplore,
  onSelectWorkbookTable,
  onForceIncludeSheet,
}: DatasetStripProps) {
  const name = displayLabel ?? filePath.split("/").pop() ?? filePath;
  const showWorkbookPicker =
    workbookCatalog?.source_kind === "excel" && onSelectWorkbookTable != null;

  return (
    <header className="flex shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-muted-foreground)]">
            <FileSpreadsheet className="size-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Active dataset
            </p>
            <h2 className="truncate text-lg font-semibold tracking-tight text-[var(--color-foreground)]" title={filePath}>
              {name}
            </h2>
            {(rowCount != null || columnCount != null) && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {rowCount != null && (
                  <Badge variant="outline">{rowCount.toLocaleString()} rows</Badge>
                )}
                {columnCount != null && (
                  <Badge variant="outline">{columnCount} columns</Badge>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <EmphasisButton onClick={onAsk}>Ask about this data</EmphasisButton>
          <Button variant="secondary" onClick={onExplore}>
            Explore columns
          </Button>
          <Button variant="ghost" size="sm" onClick={onChangeFile}>
            <RefreshCw className="size-3.5" />
            Change file
          </Button>
        </div>
      </div>

      {showWorkbookPicker && (
        <WorkbookTablePicker
          embedded
          catalog={workbookCatalog}
          onSelectTable={onSelectWorkbookTable}
          onForceInclude={onForceIncludeSheet}
        />
      )}
    </header>
  );
}
