import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Pin, Pencil, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmphasisButton } from "@/components/ui/emphasis-button";
import { cn } from "@/lib/utils";
import type { ConversationArtifact } from "./DAGEditor";
import PinnedDagPreview from "./PinnedDagPreview";
import VisualizationView from "./VisualizationView";
import {
  PINNED_MIN_HEIGHT,
  PINNED_MIN_WIDTH,
  canvasHeightForItems,
  clampPinnedLayout,
  loadPinnedLayoutMode,
  persistPinnedLayoutMode,
  pinnedKindLabel,
  type PinnedArtifactKind,
  type PinnedItem,
  type PinnedLayoutMode,
} from "./pinnedArtifacts";
import "./PinnedCanvas.css";

interface PinnedCanvasProps {
  filePath: string;
  items: PinnedItem[];
  onChange: (items: PinnedItem[]) => void;
  availablePins: Array<{
    id: string;
    threadId: string;
    label: string;
    artifact: ConversationArtifact;
    kinds: PinnedArtifactKind[];
  }>;
  onPin: (kind: PinnedArtifactKind, artifact: ConversationArtifact, options?: {
    threadId?: string;
    messageId?: string;
  }) => void;
  onOpenSource?: (item: PinnedItem) => void;
  onAskQueries?: () => void;
}

type KindFilter = "all" | PinnedArtifactKind;

type DragMode =
  | { type: "move"; itemId: string; startX: number; startY: number; originX: number; originY: number }
  | { type: "resize"; itemId: string; startX: number; startY: number; originW: number; originH: number };

function PinnedCodePreview({ code }: { code: string }) {
  return (
    <div className="pinned-code-preview">
      <SyntaxHighlighter
        language="python"
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "#0f172a",
          fontSize: "0.74rem",
          lineHeight: 1.55,
          minHeight: "100%",
        }}
        showLineNumbers
        lineNumberStyle={{ minWidth: "2em", opacity: 0.45 }}
      >
        {code.trim() || "# No code"}
      </SyntaxHighlighter>
    </div>
  );
}

function dashboardMeta(item: PinnedItem): string | null {
  if (item.kind !== "dashboard") return null;
  const spec = item.artifact.visualizationSpec;
  if (!spec) return null;
  const preview = item.artifact.resultPreview;
  const rowCount = Array.isArray(preview)
    ? preview.filter(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    ).length
    : 0;
  return `${rowCount.toLocaleString()} locally computed data points · ${spec.kind} chart`;
}

function PinnedCardBody({ item }: { item: PinnedItem }) {
  const artifact = item.artifact;
  if (item.kind === "dag") {
    return <PinnedDagPreview dagData={artifact.dagData} />;
  }
  if (item.kind === "code") {
    return <PinnedCodePreview code={artifact.pythonCode ?? ""} />;
  }
  return (
    <VisualizationView
      artifact={artifact}
      embedded
    />
  );
}

function PinnedCard({
  item,
  layoutMode,
  onLayoutChange,
  onRemove,
  onRename,
  onOpenSource,
}: {
  item: PinnedItem;
  layoutMode: PinnedLayoutMode;
  onLayoutChange: (id: string, layout: PinnedItem["layout"]) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSource?: (item: PinnedItem) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(item.title);

  useEffect(() => {
    if (!renaming) setRenameDraft(item.title);
  }, [item.title, renaming]);

  useEffect(() => {
    if (layoutMode !== "freeform") return;

    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.type === "move") {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        onLayoutChange(item.id, clampPinnedLayout({
          ...item.layout,
          x: drag.originX + dx,
          y: drag.originY + dy,
        }));
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      onLayoutChange(item.id, clampPinnedLayout({
        ...item.layout,
        width: drag.originW + dx,
        height: drag.originH + dy,
      }));
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [item.id, item.layout, layoutMode, onLayoutChange]);

  const startMove = (event: React.MouseEvent) => {
    if (layoutMode !== "freeform" || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      type: "move",
      itemId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.layout.x,
      originY: item.layout.y,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const startResize = (event: React.MouseEvent) => {
    if (layoutMode !== "freeform" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      type: "resize",
      itemId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      originW: item.layout.width,
      originH: item.layout.height,
    };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };

  const commitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== item.title) {
      onRename(item.id, trimmed);
    }
    setRenaming(false);
  };

  const dashboardSummary = dashboardMeta(item);
  const canOpenSource = Boolean(onOpenSource && (item.threadId || item.query));

  return (
    <article
      ref={cardRef}
      className={cn("pinned-card", layoutMode === "grid" && "pinned-card--grid")}
      style={layoutMode === "freeform" ? {
        left: item.layout.x,
        top: item.layout.y,
        width: item.layout.width,
        height: item.layout.height,
        minWidth: PINNED_MIN_WIDTH,
        minHeight: PINNED_MIN_HEIGHT,
      } : undefined}
    >
      <header
        className={cn("pinned-card-header", layoutMode === "freeform" && "pinned-card-header--draggable")}
        onMouseDown={startMove}
      >
        <div className="pinned-card-header-copy">
          <Badge variant="outline">{pinnedKindLabel(item.kind)}</Badge>
          {renaming ? (
            <input
              className="pinned-card-rename-input"
              value={renameDraft}
              autoFocus
              aria-label="Rename pinned view"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                  setRenameDraft(item.title);
                }
              }}
              onBlur={commitRename}
              onMouseDown={(event) => event.stopPropagation()}
            />
          ) : (
            <h3 className="pinned-card-title" title={item.title}>{item.title}</h3>
          )}
          {item.query && (
            <p className="pinned-card-query" title={item.query}>{item.query}</p>
          )}
          {dashboardSummary && (
            <p className="pinned-card-meta">{dashboardSummary}</p>
          )}
        </div>
        <div className="pinned-card-header-actions">
          {canOpenSource && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Open source for ${item.title}`}
              title="Open in Ask Queries"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onOpenSource?.(item)}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`Rename ${item.title}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setRenaming(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`Remove pinned ${item.title}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onRemove(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>
      <div className="pinned-card-body">
        <PinnedCardBody item={item} />
      </div>
      {layoutMode === "freeform" && (
        <div
          className="pinned-card-resize-handle"
          onMouseDown={startResize}
          aria-hidden="true"
        />
      )}
    </article>
  );
}

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "dag", label: "Graph" },
  { id: "code", label: "Code" },
  { id: "dashboard", label: "Dashboard" },
];

export default function PinnedCanvas({
  filePath,
  items,
  onChange,
  availablePins,
  onPin,
  onOpenSource,
  onAskQueries,
}: PinnedCanvasProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<PinnedLayoutMode>(() => loadPinnedLayoutMode());
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    persistPinnedLayoutMode(layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    if (!addOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!addWrapRef.current?.contains(event.target as Node)) {
        setAddOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || layoutMode !== "freeform") return;

    const updateSize = () => setViewportHeight(element.clientHeight);
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [filePath, items.length, layoutMode]);

  const filteredItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.pinnedAt - b.pinnedAt);
    if (kindFilter === "all") return sorted;
    return sorted.filter((item) => item.kind === kindFilter);
  }, [items, kindFilter]);

  const canvasHeight = useMemo(
    () => canvasHeightForItems(filteredItems, Math.max(viewportHeight - 8, 600)),
    [filteredItems, viewportHeight],
  );

  const updateLayout = useCallback((id: string, layout: PinnedItem["layout"]) => {
    onChange(items.map((item) => (item.id === id ? { ...item, layout } : item)));
  }, [items, onChange]);

  const removeItem = useCallback((id: string) => {
    onChange(items.filter((item) => item.id !== id));
  }, [items, onChange]);

  const renameItem = useCallback((id: string, title: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, title } : item)));
  }, [items, onChange]);

  const toggleLayoutMode = () => {
    setLayoutMode((mode) => (mode === "grid" ? "freeform" : "grid"));
  };

  return (
    <div className="pinned-workspace font-[family-name:var(--font-nav)] text-[var(--color-foreground)]">
      <header className="pinned-toolbar">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Saved artifacts
          </p>
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {!filePath
              ? "Pin views from Ask Queries"
              : items.length === 0
                ? "Nothing pinned yet"
                : `${items.length} pinned ${items.length === 1 ? "view" : "views"}`}
          </h2>
        </div>
        <div className="pinned-toolbar-actions">
          {items.length > 0 && (
            <div className="pinned-filter-row" role="tablist" aria-label="Filter pinned views">
              {KIND_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === filter.id}
                  className={cn("pinned-filter-pill", kindFilter === filter.id && "active")}
                  onClick={() => setKindFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleLayoutMode}>
              {layoutMode === "grid" ? "Freeform layout" : "Grid layout"}
            </Button>
          )}
          <div className="pinned-add-wrap" ref={addWrapRef}>
            <Button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              disabled={availablePins.length === 0}
              aria-expanded={addOpen}
              title={availablePins.length === 0 ? "Run a query first, then pin Graph, Code, or Dashboard views" : "Pin an artifact from a recent query"}
            >
              <Pin className="size-3.5" />
              Pin artifact
            </Button>
            {addOpen && availablePins.length > 0 && (
              <div className="pinned-add-menu" role="menu">
                {availablePins.map((entry) => (
                  <div key={entry.id} className="pinned-add-group">
                    <span className="pinned-add-group-label">{entry.label}</span>
                    <div className="pinned-add-group-actions">
                      {entry.kinds.map((kind) => (
                        <Button
                          key={`${entry.id}-${kind}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          role="menuitem"
                          onClick={() => {
                            onPin(kind, entry.artifact, {
                              threadId: entry.threadId,
                              messageId: entry.id,
                            });
                            setAddOpen(false);
                          }}
                        >
                          {pinnedKindLabel(kind)}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {!filePath ? (
        <div className="pinned-canvas-scroll" ref={scrollRef}>
          <div className="pinned-empty">
            <p className="text-[15px] font-medium tracking-tight">No dataset open</p>
            <p className="mt-1 max-w-sm text-center text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              Open a file on Home, then pin Graph, Code, or Dashboard views from Ask Queries.
            </p>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="pinned-canvas-scroll" ref={scrollRef}>
          <div className="pinned-empty">
            <p className="text-[15px] font-medium tracking-tight">Pin something worth keeping</p>
            <p className="mt-1 max-w-sm text-center text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              In Ask Queries, pin a Graph, Code, or Dashboard view. You can also pin charts from Know Your Data.
            </p>
            {onAskQueries && (
              <EmphasisButton className="mt-4" onClick={onAskQueries}>
                Ask a question
              </EmphasisButton>
            )}
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="pinned-canvas-scroll" ref={scrollRef}>
          <div className="pinned-empty">
            <p className="text-[15px] font-medium tracking-tight">No {kindFilter === "all" ? "matching" : pinnedKindLabel(kindFilter)} views</p>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Try another filter.</p>
            <Button className="mt-4" variant="outline" onClick={() => setKindFilter("all")}>
              Show all
            </Button>
          </div>
        </div>
      ) : (
        <div className="pinned-canvas-scroll" ref={scrollRef}>
          <div
            className={cn(
              layoutMode === "grid" ? "pinned-grid" : "pinned-canvas-surface",
            )}
            style={layoutMode === "freeform" ? { minHeight: canvasHeight } : undefined}
          >
            {filteredItems.map((item) => (
              <PinnedCard
                key={item.id}
                item={item}
                layoutMode={layoutMode}
                onLayoutChange={updateLayout}
                onRemove={removeItem}
                onRename={renameItem}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
