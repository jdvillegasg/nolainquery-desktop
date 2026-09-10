import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PreviewData } from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SIDECAR_API, sidecarFetch } from "@/lib/cloudApi";

const PAGE_SIZE = 200;

interface SpreadsheetPreviewProps {
  filePath: string;
}

export default function SpreadsheetPreview({ filePath }: SpreadsheetPreviewProps) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (p: number) => {
      if (!filePath) return;
      setLoading(true);
      setError(null);
      try {
        const url = `${SIDECAR_API}/preview_data?source_path=${encodeURIComponent(filePath)}&page=${p}&page_size=${PAGE_SIZE}`;
        const res = await sidecarFetch(url);
        const data = await res.json();
        if (data.status !== "success") throw new Error(data.detail || "Failed to load preview");
        setPreviewData(data);
        setPage(p);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load preview");
      } finally {
        setLoading(false);
      }
    },
    [filePath],
  );

  useEffect(() => {
    setPreviewData(null);
    setPage(0);
    if (filePath) void fetchPage(0);
  }, [filePath, fetchPage]);

  if (!filePath) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-card)] px-6 py-10">
        <ol className="space-y-3 text-sm text-[var(--color-muted-foreground)]">
          <li className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-foreground)]">1</span>
            <span><strong className="font-medium text-[var(--color-foreground)]">Open</strong> an Excel, CSV, or Parquet file</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-foreground)]">2</span>
            <span><strong className="font-medium text-[var(--color-foreground)]">Review</strong> quality insights and preview rows</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-foreground)]">3</span>
            <span><strong className="font-medium text-[var(--color-foreground)]">Ask</strong> questions in Ask Queries</span>
          </li>
        </ol>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  const totalPages = previewData ? Math.ceil(previewData.sampled_rows / PAGE_SIZE) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {previewData && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <span>
            {previewData.is_sampled
              ? `Sample of ${previewData.sampled_rows.toLocaleString()} rows (${previewData.total_rows.toLocaleString()} total)`
              : `${previewData.total_rows.toLocaleString()} rows · ${previewData.columns.length} columns`}
          </span>
          {previewData.is_sampled && <Badge variant="outline">Sampled</Badge>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)]">
        {loading && !previewData ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <div className="flex gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0ms]" />
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:150ms]" />
              <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:300ms]" />
            </div>
            <span className="text-xs text-[var(--color-muted-foreground)]">Loading preview…</span>
          </div>
        ) : previewData ? (
          <table className="w-max min-w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-card)]">
                <th className="sticky left-0 top-0 z-[3] w-12 min-w-12 border-r border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-right font-[family-name:var(--font-mono)] text-[11px] font-semibold text-[var(--color-muted-foreground)]">
                  #
                </th>
                {previewData.columns.map((col) => (
                  <th
                    key={col}
                    className="sticky top-0 z-[2] whitespace-nowrap bg-[var(--color-card)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] font-semibold text-[var(--color-foreground)]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewData.rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]/60">
                  <td className="sticky left-0 z-[1] border-r border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-right font-[family-name:var(--font-mono)] text-[11px] font-medium text-[var(--color-muted-foreground)]">
                    {page * PAGE_SIZE + i + 1}
                  </td>
                  {previewData.columns.map((col) => (
                    <td key={col} className="whitespace-nowrap px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-foreground)]">
                      {row[col] === null || row[col] === undefined ? (
                        <span className="italic text-[var(--color-muted-foreground)]/60">—</span>
                      ) : (
                        String(row[col] as string | number | boolean)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {previewData && totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border)] pt-2">
          <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => fetchPage(page - 1)}>
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Page {page + 1} of {totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => fetchPage(page + 1)}>
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
