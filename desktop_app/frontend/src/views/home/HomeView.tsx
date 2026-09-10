import { Table2 } from "lucide-react";
import DatasetStrip from "./DatasetStrip";
import InsightsPanel from "./InsightsPanel";
import OpenDatasetPanel from "./OpenDatasetPanel";
import SpreadsheetPreview from "./SpreadsheetPreview";
import type { InsightsData } from "./types";

import type { WorkbookCatalog } from "@/lib/workbook";

export interface HomeViewProps {
  filePath: string;
  displayLabel?: string;
  workbookCatalog: WorkbookCatalog | null;
  recentFiles: string[];
  insights: InsightsData | null;
  insightsLoading: boolean;
  insightsError: string | null;
  datasetRowCount: number | null;
  onFileSelect: () => void;
  onSelectRecentFile: (path: string) => void;
  onSelectWorkbookTable: (tableId: string) => void;
  onForceIncludeSheet: (sheetName: string) => void;
  onAskAboutData: () => void;
  onExploreData: () => void;
}

export default function HomeView({
  filePath,
  displayLabel,
  workbookCatalog,
  recentFiles,
  insights,
  insightsLoading,
  insightsError,
  datasetRowCount,
  onFileSelect,
  onSelectRecentFile,
  onSelectWorkbookTable,
  onForceIncludeSheet,
  onAskAboutData,
  onExploreData,
}: HomeViewProps) {
  const hasFile = Boolean(filePath);

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col gap-4 font-[family-name:var(--font-nav)] text-[var(--color-foreground)]">
      {hasFile && (
        <DatasetStrip
          filePath={filePath}
          displayLabel={displayLabel}
          rowCount={datasetRowCount ?? insights?.total_rows ?? null}
          columnCount={insights?.total_cols ?? null}
          workbookCatalog={workbookCatalog}
          onChangeFile={onFileSelect}
          onAsk={onAskAboutData}
          onExplore={onExploreData}
          onSelectWorkbookTable={onSelectWorkbookTable}
          onForceIncludeSheet={onForceIncludeSheet}
        />
      )}

      {!hasFile && insightsLoading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0ms]" />
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:150ms]" />
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:300ms]" />
            </div>
            <span className="text-xs text-[var(--color-muted-foreground)]">Opening workbook…</span>
          </div>
        </div>
      ) : !hasFile ? (
        <>
          {insightsError && (
            <div className="rounded-[var(--radius-lg)] border border-rose-200 bg-rose-50/50 px-4 py-3 text-sm text-rose-700">
              {insightsError}
            </div>
          )}
          <OpenDatasetPanel
            variant="hero"
            filePath={filePath}
            sourcePath={workbookCatalog?.source_path ?? filePath}
            recentFiles={recentFiles}
            onOpenFile={onFileSelect}
            onSelectRecent={onSelectRecentFile}
          />
        </>
      ) : (
        <div className="flex max-h-[min(280px,30vh)] min-h-[180px] shrink-0 gap-4">
          <aside className="w-[220px] shrink-0 min-h-0">
            <OpenDatasetPanel
              variant="sidebar"
              filePath={filePath}
              sourcePath={workbookCatalog?.source_path ?? filePath}
              recentFiles={recentFiles}
              onOpenFile={onFileSelect}
              onSelectRecent={onSelectRecentFile}
            />
          </aside>
          <div className="min-w-0 flex-1 min-h-0">
            {insightsLoading && (
              <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0ms]" />
                    <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:150ms]" />
                    <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:300ms]" />
                  </div>
                  <span className="text-xs text-[var(--color-muted-foreground)]">Analyzing dataset…</span>
                </div>
              </div>
            )}
            {!insightsLoading && insightsError && (
              <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border border-rose-200 bg-rose-50/50 p-6">
                <p className="text-center text-sm text-rose-700">{insightsError}</p>
              </div>
            )}
            {!insightsLoading && insights && !insightsError && <InsightsPanel insights={insights} />}
          </div>
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="mb-3 flex items-center gap-2">
          <Table2 className="size-4 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Data preview
          </h2>
        </div>
        <SpreadsheetPreview filePath={filePath} />
      </section>
    </div>
  );
}

export type { InsightsData } from "./types";
