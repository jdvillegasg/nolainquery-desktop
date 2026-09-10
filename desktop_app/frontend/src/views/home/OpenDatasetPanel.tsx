import { Clock, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmphasisButton } from "@/components/ui/emphasis-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface OpenDatasetPanelProps {
  variant: "hero" | "sidebar";
  filePath: string;
  sourcePath: string;
  recentFiles: string[];
  onOpenFile: () => void;
  onSelectRecent: (path: string) => void;
}

export default function OpenDatasetPanel({
  variant,
  filePath,
  sourcePath,
  recentFiles,
  onOpenFile,
  onSelectRecent,
}: OpenDatasetPanelProps) {
  const isHero = variant === "hero";

  if (isHero) {
    return (
      <Card className="shrink-0">
        <CardHeader className="pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Get started
          </p>
          <CardTitle className="text-2xl font-semibold tracking-tight">Open a dataset to begin</CardTitle>
          <CardDescription className="max-w-lg text-[15px] leading-relaxed">
            Preview rows, review data quality, then ask natural-language questions about your file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-2">
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <EmphasisButton size="lg" onClick={onOpenFile}>
              Choose dataset
            </EmphasisButton>
            <span className="text-xs text-[var(--color-muted-foreground)]">Supported: .xlsx, .xls, .csv, .parquet</span>
          </div>
          {recentFiles.length > 0 && (
            <RecentList
              filePath={filePath}
              sourcePath={sourcePath}
              recentFiles={recentFiles.slice(0, 5)}
              onSelectRecent={onSelectRecent}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Switch dataset
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 min-h-0">
        <Button variant="secondary" className="w-full" onClick={onOpenFile}>
          <FolderOpen className="size-4" />
          Open another file
        </Button>
        {recentFiles.length > 0 && (
          <RecentList
            filePath={filePath}
            sourcePath={sourcePath}
            recentFiles={recentFiles.slice(0, 8)}
            onSelectRecent={onSelectRecent}
            compact
          />
        )}
      </CardContent>
    </Card>
  );
}

function RecentList({
  filePath,
  sourcePath,
  recentFiles,
  onSelectRecent,
  compact = false,
}: {
  filePath: string;
  sourcePath: string;
  recentFiles: string[];
  onSelectRecent: (path: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-h-0", compact && "flex flex-1 flex-col")}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        <Clock className="size-3.5" strokeWidth={2} />
        Recent files
      </div>
      <ul className={cn("flex flex-col gap-1.5", compact && "min-h-0 flex-1 overflow-y-auto")}>
        {recentFiles.map((path) => {
          const active = sourcePath === path || filePath === path;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => onSelectRecent(path)}
                title={path}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-all duration-200 ease-out",
                  active
                    ? "border-stone-300 bg-stone-100 active:scale-[0.98]"
                    : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-stone-300 hover:bg-stone-100 hover:-translate-y-px active:scale-[0.98]",
                )}
              >
                <span className="truncate text-sm font-medium text-[var(--color-foreground)]">
                  {path.split("/").pop()}
                </span>
                {!compact && (
                  <span className="truncate text-xs text-[var(--color-muted-foreground)]">{path}</span>
                )}
                {compact && (
                  <span className="truncate text-[10px] text-[var(--color-muted-foreground)]">{path}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
