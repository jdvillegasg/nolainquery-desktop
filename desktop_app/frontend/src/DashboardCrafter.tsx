import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import type { LucideIcon } from "lucide-react";
import { Calendar, Fingerprint, Hash, List, MessageSquare, Pin, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmphasisButton } from "@/components/ui/emphasis-button";
import { cn } from "@/lib/utils";
import {
  formatColumnStats,
  loadDashboardTiles,
  persistDashboardTiles,
  tileConfigToArtifact,
  type TileConfig,
} from "./dashboardTiles";
import type { ConversationArtifact } from "./DAGEditor";
import {
  humanizeFieldName,
  rechartsXAxisLabel,
  rechartsYAxisLabel,
} from "./chartPresentation";
import "./DashboardCrafter.css";
import { SIDECAR_API, sidecarFetch } from "./lib/cloudApi";

interface ColumnSemantics {
  null_ratio: number;
  cardinality: number;
  sample_values: any[];
  data_type: string;
  semantic_type: "numeric" | "temporal" | "categorical" | "identifier";
}

interface DataSummary {
  available_columns: string[];
  column_semantics: Record<string, ColumnSemantics>;
  sample_data?: any[];
}

export interface DashboardCrafterProps {
  filePath: string;
  onOpenFile?: () => void;
  onAskAboutColumn?: (column: string, tile?: TileConfig) => void;
  onPinTile?: (artifact: ConversationArtifact) => void;
}

// ── Chart theme constants ──────────────────────────────────────────────────
const CHART_COLORS = {
  primary: "#525252",
  secondary: "#78716c",
} as const;

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  borderColor: "#ebebeb",
  borderRadius: 8,
  color: "#1c1917",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  padding: "6px 10px",
} as const;

const CHART_AXIS_PROPS = {
  stroke: "#d4d4d4",
  tick: { fontSize: 10, fontFamily: "Inter, system-ui, sans-serif", fill: "#78716c" },
} as const;

const CHART_GRID_PROPS = { strokeDasharray: "3 3", stroke: "#ebebeb" } as const;

/** Fixed plot height — zoom is a viewport into the data, not a resize of the tile. */
const CHART_H = 220;

/** Left margin must match pixel→index math in useIndexZoom (Y-axis label area). */
const MARGIN_DIST_BAR = { top: 8, right: 12, left: 52, bottom: 28 } as const;

type ChartMargin = { top: number; right: number; left: number; bottom: number };

function clientXToRelativeIndex(
  clientX: number,
  rect: DOMRect,
  n: number,
  margin: ChartMargin,
): number | undefined {
  if (n <= 0) return undefined;
  const plotW = rect.width - margin.left - margin.right;
  if (plotW <= 0) return undefined;
  const x = clientX - rect.left - margin.left;
  const t = Math.max(0, Math.min(1, x / plotW));
  return Math.min(n - 1, Math.max(0, Math.floor(t * n)));
}

// ── Index-based rectangle zoom (categorical / ordinal X) ────────────────────
/** Pointer-based zoom: Recharts 3 often has no usable activeTooltipIndex on mousedown (tooltip updates on mousemove; index type is string|null). */
function useIndexZoom(fullData: any[], nameKey: string, margin: ChartMargin) {
  const [zoom, setZoom] = useState<{ lo: number; hi: number } | null>(null);
  const [dragAbs, setDragAbs] = useState<{ i0: number; i1: number } | null>(null);
  const dragActive = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const displayLenRef = useRef(0);
  const baseOffsetRef = useRef(0);
  const marginRef = useRef(margin);

  useEffect(() => {
    setZoom(null);
    setDragAbs(null);
  }, [fullData]);

  const baseOffset = zoom?.lo ?? 0;

  const displayData = useMemo(() => {
    if (!zoom) return fullData;
    const lo = Math.min(zoom.lo, zoom.hi);
    const hi = Math.max(zoom.lo, zoom.hi);
    return fullData.slice(lo, hi + 1);
  }, [fullData, zoom]);

  displayLenRef.current = displayData.length;
  baseOffsetRef.current = baseOffset;
  marginRef.current = margin;

  const applyDragEndRef = useRef<() => void>(() => {});
  applyDragEndRef.current = () => {
    dragActive.current = false;
    setDragAbs(d => {
      if (d) {
        const lo = Math.min(d.i0, d.i1);
        const hi = Math.max(d.i0, d.i1);
        if (hi > lo) setZoom({ lo, hi });
      }
      return null;
    });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragActive.current || !wrapRef.current) return;
      const n = displayLenRef.current;
      const rel = clientXToRelativeIndex(
        e.clientX,
        wrapRef.current.getBoundingClientRect(),
        n,
        marginRef.current,
      );
      if (rel == null) return;
      const abs = baseOffsetRef.current + rel;
      setDragAbs(d => (d ? { ...d, i1: abs } : null));
    };
    const onUp = () => {
      if (dragActive.current) applyDragEndRef.current();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onPointerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!wrapRef.current) return;
    const rel = clientXToRelativeIndex(
      e.clientX,
      wrapRef.current.getBoundingClientRect(),
      displayData.length,
      margin,
    );
    if (rel == null) return;
    dragActive.current = true;
    const abs = baseOffset + rel;
    setDragAbs({ i0: abs, i1: abs });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    dragActive.current = false;
    setDragAbs(null);
    setZoom(null);
  };

  const refArea =
    dragAbs && displayData.length > 0 ? (() => {
      const r0 = Math.min(dragAbs.i0, dragAbs.i1) - baseOffset;
      const r1 = Math.max(dragAbs.i0, dragAbs.i1) - baseOffset;
      const i0 = Math.max(0, Math.min(displayData.length - 1, r0));
      const i1 = Math.max(0, Math.min(displayData.length - 1, r1));
      const x1 = displayData[i0]?.[nameKey];
      const x2 = displayData[i1]?.[nameKey];
      if (x1 == null || x2 == null) return null;
      return (
        <ReferenceArea
          x1={x1}
          x2={x2}
          stroke="rgba(28, 25, 23, 0.45)"
          strokeOpacity={1}
          fill="rgba(28, 25, 23, 0.08)"
          fillOpacity={1}
        />
      );
    })() : null;

  return {
    wrapRef,
    displayData,
    onPointerDown,
    onDoubleClick,
    refArea,
    isZoomed: zoom != null,
  };
}

// ── Scatter: pixel rectangle (MATLAB-style) in current view coordinates ────
/** Fallback only when the plot has not been measured yet. */
const SCATTER_MARGIN = { top: 8, right: 12, left: 52, bottom: 28 };

function ScatterZoomChart({
  data,
  xLabel,
  yLabel,
}: {
  data: any[];
  xLabel: string;
  yLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Pixel bounds of the actual Cartesian plot (from .recharts-cartesian-grid), relative to wrapRef. */
  const plotBoxRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const viewRef = useRef({
    xView: [0, 1] as [number, number],
    yView: [0, 1] as [number, number],
    full: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
  });
  const [domain, setDomain] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const [selPx, setSelPx] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragging = useRef(false);

  const bounds = useMemo(() => {
    const xs = data.map(d => d.x);
    const ys = data.map(d => d.y);
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    };
  }, [data]);

  const measurePlotBox = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const grid = wrap.querySelector(".recharts-cartesian-grid");
    if (!grid) return;
    const wr = wrap.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    if (gr.width <= 0 || gr.height <= 0) return;
    plotBoxRef.current = {
      left: gr.left - wr.left,
      top: gr.top - wr.top,
      width: gr.width,
      height: gr.height,
    };
  }, []);

  useLayoutEffect(() => {
    measurePlotBox();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(measurePlotBox);
    });
    ro.observe(wrap);
    const t = window.setTimeout(measurePlotBox, 50);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [data, domain, measurePlotBox]);

  useEffect(() => {
    setDomain(null);
    setSelPx(null);
  }, [data]);

  const xView = domain?.x ?? [bounds.xMin, bounds.xMax];
  const yView = domain?.y ?? [bounds.yMin, bounds.yMax];
  viewRef.current = {
    xView: [xView[0], xView[1]] as [number, number],
    yView: [yView[0], yView[1]] as [number, number],
    full: bounds,
  };

  const pxClientToData = (clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return null;
    const { xView: xv, yView: yv } = viewRef.current;
    const r = el.getBoundingClientRect();
    const box = plotBoxRef.current;
    let insetLeft: number;
    let insetTop: number;
    let plotW: number;
    let plotH: number;
    if (box && box.width > 0 && box.height > 0) {
      insetLeft = box.left;
      insetTop = box.top;
      plotW = box.width;
      plotH = box.height;
    } else {
      insetLeft = SCATTER_MARGIN.left;
      insetTop = SCATTER_MARGIN.top;
      plotW = r.width - SCATTER_MARGIN.left - SCATTER_MARGIN.right;
      plotH = r.height - SCATTER_MARGIN.top - SCATTER_MARGIN.bottom;
    }
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - r.left - insetLeft;
    const py = clientY - r.top - insetTop;
    const nx = Math.max(0, Math.min(1, px / plotW));
    const ny = Math.max(0, Math.min(1, py / plotH));
    const [vx0, vx1] = xv;
    const [vy0, vy1] = yv;
    const x = vx0 + nx * (vx1 - vx0);
    const y = vy1 - ny * (vy1 - vy0);
    return { x, y };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    dragging.current = true;
    setSelPx({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
  };

  const endDragRef = useRef<() => void>(() => {});
  endDragRef.current = () => {
    if (!dragging.current) return;
    dragging.current = false;
    measurePlotBox();
    setSelPx(s => {
      if (s && wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        const c0 = pxClientToData(s.x0 + r.left, s.y0 + r.top);
        const c1 = pxClientToData(s.x1 + r.left, s.y1 + r.top);
        const { full } = viewRef.current;
        if (c0 && c1) {
          const xr = Math.abs(c1.x - c0.x);
          const yr = Math.abs(c1.y - c0.y);
          const xSpan = full.xMax - full.xMin || 1;
          const ySpan = full.yMax - full.yMin || 1;
          if (xr > xSpan * 1e-6 || yr > ySpan * 1e-6) {
            const xa = Math.min(c0.x, c1.x);
            const xb = Math.max(c0.x, c1.x);
            const ya = Math.min(c0.y, c1.y);
            const yb = Math.max(c0.y, c1.y);
            setDomain({ x: [xa, xb], y: [ya, yb] });
          }
        }
      }
      return null;
    });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSelPx(s => (s ? { ...s, x1: e.clientX - r.left, y1: e.clientY - r.top } : null));
    };
    const onUp = () => endDragRef.current();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = false;
    setSelPx(null);
    setDomain(null);
  };

  const selStyle = selPx
    ? {
        left: Math.min(selPx.x0, selPx.x1),
        top: Math.min(selPx.y0, selPx.y1),
        width: Math.abs(selPx.x1 - selPx.x0),
        height: Math.abs(selPx.y1 - selPx.y0),
      }
    : null;

  return (
    <div
      ref={wrapRef}
      className="tile-chart-zoom-wrap"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="presentation"
    >
      <ResponsiveContainer width="100%" height={CHART_H}>
        <ScatterChart margin={SCATTER_MARGIN}>
          <CartesianGrid {...CHART_GRID_PROPS} />
          <XAxis
            dataKey="x"
            name={xLabel}
            type="number"
            domain={[xView[0], xView[1]]}
            allowDataOverflow
            label={rechartsXAxisLabel(xLabel)}
            {...CHART_AXIS_PROPS}
          />
          <YAxis
            dataKey="y"
            name={yLabel}
            type="number"
            domain={[yView[0], yView[1]]}
            allowDataOverflow
            label={rechartsYAxisLabel(yLabel)}
            {...CHART_AXIS_PROPS}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_TOOLTIP_STYLE} />
          <Scatter data={data} fill={CHART_COLORS.secondary} />
        </ScatterChart>
      </ResponsiveContainer>
      {selStyle && selStyle.width > 1 && selStyle.height > 1 && (
        <div className="tile-chart-zoom-rect" style={selStyle} />
      )}
    </div>
  );
}

// ── Smart defaults ─────────────────────────────────────────────────────────
function getSmartDefaults(
  targetType?: string,
  compareType?: string
): { aggregation: string; graphType: string } {
  if (targetType === "categorical" && compareType === "numeric") return { aggregation: "mean", graphType: "bar" };
  if (targetType === "categorical") return { aggregation: "", graphType: "bar" };
  if (targetType === "numeric" && compareType === "categorical") return { aggregation: "mean", graphType: "bar" };
  if (targetType === "numeric" && compareType === "numeric") return { aggregation: "", graphType: "scatter" };
  if (targetType === "numeric") return { aggregation: "", graphType: "distribution" };
  return { aggregation: "", graphType: "bar" };
}

function getAllowedGraphTypes(targetType?: string, compareType?: string): { value: string; label: string }[] {
  if (targetType === "categorical" && compareType === "numeric") return [{ value: "bar", label: "Bar" }];
  if (targetType === "categorical") return [{ value: "distribution", label: "Dist" }, { value: "bar", label: "Bar" }];
  if (targetType === "numeric" && compareType === "categorical") return [{ value: "bar", label: "Bar" }, { value: "distribution", label: "Dist" }];
  if (targetType === "numeric" && compareType === "numeric") return [{ value: "scatter", label: "Scatter" }];
  return [{ value: "distribution", label: "Dist" }, { value: "bar", label: "Bar" }];
}

function getAllowedAggregations(targetType?: string, compareType?: string): { value: string; label: string }[] {
  if (targetType === "numeric" && compareType === "categorical") {
    return [{ value: "mean", label: "Mean" }, { value: "sum", label: "Sum" }, { value: "std", label: "Std" }];
  }
  if (targetType === "categorical" && compareType === "numeric") {
    return [{ value: "mean", label: "Mean" }, { value: "sum", label: "Sum" }, { value: "std", label: "Std" }];
  }
  return [];
}

function DistributionTileChart({
  data,
  xLabel,
  yLabel,
}: {
  data: any[];
  xLabel: string;
  yLabel: string;
}) {
  const z = useIndexZoom(data, "name", MARGIN_DIST_BAR);
  const valueKey = "value";
  const nameKey = "name";
  return (
    <div
      ref={z.wrapRef}
      className="tile-chart-zoom-wrap"
      onMouseDown={z.onPointerDown}
      onDoubleClick={z.onDoubleClick}
    >
      <ResponsiveContainer width="100%" height={CHART_H}>
        <AreaChart
          data={z.displayData}
          margin={MARGIN_DIST_BAR}
        >
          <CartesianGrid {...CHART_GRID_PROPS} />
          <XAxis
            dataKey={nameKey}
            label={rechartsXAxisLabel(xLabel)}
            {...CHART_AXIS_PROPS}
          />
          <YAxis label={rechartsYAxisLabel(yLabel)} {...CHART_AXIS_PROPS} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Area type="monotone" dataKey={valueKey} stroke={CHART_COLORS.primary} fill={CHART_COLORS.primary} fillOpacity={0.12} strokeWidth={2} />
          {z.refArea}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarTileChart({
  data,
  nameKey,
  xLabel,
  yLabel,
}: {
  data: any[];
  nameKey: string;
  xLabel: string;
  yLabel: string;
}) {
  const z = useIndexZoom(data, nameKey, MARGIN_DIST_BAR);
  const valueKey = "value";
  return (
    <div
      ref={z.wrapRef}
      className="tile-chart-zoom-wrap"
      onMouseDown={z.onPointerDown}
      onDoubleClick={z.onDoubleClick}
    >
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={z.displayData}
          margin={MARGIN_DIST_BAR}
        >
          <CartesianGrid {...CHART_GRID_PROPS} />
          <XAxis
            dataKey={nameKey}
            label={rechartsXAxisLabel(xLabel)}
            {...CHART_AXIS_PROPS}
          />
          <YAxis label={rechartsYAxisLabel(yLabel)} {...CHART_AXIS_PROPS} />
          <Tooltip cursor={{ fill: "rgba(28, 25, 23, 0.04)" }} contentStyle={CHART_TOOLTIP_STYLE} />
          <Bar dataKey={valueKey} fill={CHART_COLORS.primary} />
          {z.refArea}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart renderer ─────────────────────────────────────────────────────────
function renderGraph(tile: TileConfig, data?: any[]) {
  if (!tile.graphType || !data?.length) {
    return <div className="tile-placeholder">No data available</div>;
  }

  const nameKey = tile.aggregation ? "compareKey" : "name";
  const categorySource = tile.aggregation ? (tile.compareColumn || tile.column) : tile.column;
  const xLabel = humanizeFieldName(categorySource);
  const yLabel = tile.graphType === "scatter"
    ? humanizeFieldName(tile.column)
    : tile.aggregation && tile.compareColumn
      ? humanizeFieldName(tile.compareColumn)
      : "Value";

  if (tile.graphType === "bar") {
    return <BarTileChart data={data} nameKey={nameKey} xLabel={xLabel} yLabel={yLabel} />;
  }

  if (tile.graphType === "scatter") {
    return (
      <ScatterZoomChart
        data={data}
        xLabel={humanizeFieldName(tile.compareColumn || "x")}
        yLabel={humanizeFieldName(tile.column)}
      />
    );
  }

  return <DistributionTileChart data={data} xLabel={xLabel} yLabel={yLabel === "Value" ? "Frequency" : yLabel} />;
}

// ── Type meta ──────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: LucideIcon; label: string }> = {
  numeric: { icon: Hash, label: "Numeric" },
  categorical: { icon: List, label: "Categorical" },
  temporal: { icon: Calendar, label: "Temporal" },
  identifier: { icon: Fingerprint, label: "Identifier" },
};
const TYPE_ORDER = ["numeric", "categorical", "temporal", "identifier"];

function TypeGlyph({ type, className }: { type?: string; className?: string }) {
  const meta = TYPE_META[type ?? ""];
  if (!meta) return null;
  const Icon = meta.icon;
  return <Icon className={cn("size-3.5 shrink-0 text-[var(--color-muted-foreground)]", className)} strokeWidth={1.75} />;
}

function LoadingDots({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5">
          <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0ms]" />
          <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:150ms]" />
          <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:300ms]" />
        </div>
        <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      </div>
    </div>
  );
}

// ── TileCard ───────────────────────────────────────────────────────────────
interface TileCardProps {
  tile: TileConfig;
  data?: any[];
  loading: boolean;
  error?: string;
  summary: DataSummary;
  onRemove: () => void;
  onRetry: () => void;
  onUpdate: (updates: Partial<TileConfig>) => void;
  onAsk?: () => void;
  onPin?: () => void;
  canPin?: boolean;
  tileRef?: (el: HTMLDivElement | null) => void;
}

function TileCard({
  tile,
  data,
  loading,
  error,
  summary,
  onRemove,
  onRetry,
  onUpdate,
  onAsk,
  onPin,
  canPin = false,
  tileRef,
}: TileCardProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareSearch, setCompareSearch] = useState("");
  const compareRef = useRef<HTMLDivElement>(null);
  const [localDistPct, setLocalDistPct] = useState(tile.distributionPct ?? 100);
  const [localCompareDistPct, setLocalCompareDistPct] = useState(tile.compareDistributionPct ?? 100);
  const distPctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compareDistPctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalDistPct(tile.distributionPct ?? 100);
    setLocalCompareDistPct(tile.compareDistributionPct ?? 100);
  }, [tile.id, tile.distributionPct, tile.compareDistributionPct]);

  useEffect(() => {
    if (!compareOpen) return;
    const handler = (e: MouseEvent) => {
      if (compareRef.current && !compareRef.current.contains(e.target as Node)) {
        setCompareOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [compareOpen]);

  const targetType = summary.column_semantics[tile.column]?.semantic_type;
  const compareType = tile.compareColumn
    ? summary.column_semantics[tile.compareColumn]?.semantic_type
    : undefined;

  const allowedGraphTypes = getAllowedGraphTypes(targetType, compareType);
  const allowedAggregations = getAllowedAggregations(targetType, compareType);

  const showDistSlider =
    targetType === "numeric" &&
    !tile.compareColumn &&
    !tile.aggregation &&
    (tile.graphType === "distribution" || tile.graphType === "bar");

  const showScatterDistSliders =
    targetType === "numeric" &&
    compareType === "numeric" &&
    !!tile.compareColumn &&
    tile.graphType === "scatter";

  const handleCompareSelect = (col: string) => {
    const newCompareType = col ? summary.column_semantics[col]?.semantic_type : undefined;
    const defaults = getSmartDefaults(targetType, newCompareType);
    onUpdate({ compareColumn: col || undefined, ...defaults });
    setCompareOpen(false);
    setCompareSearch("");
  };

  const handleDistPctChange = (val: number) => {
    setLocalDistPct(val);
    if (distPctTimer.current) clearTimeout(distPctTimer.current);
    distPctTimer.current = setTimeout(() => {
      onUpdate({ distributionPct: val });
    }, 300);
  };

  const handleCompareDistPctChange = (val: number) => {
    setLocalCompareDistPct(val);
    if (compareDistPctTimer.current) clearTimeout(compareDistPctTimer.current);
    compareDistPctTimer.current = setTimeout(() => {
      onUpdate({ compareDistributionPct: val });
    }, 300);
  };

  return (
    <div className="tile-card" ref={tileRef} id={`tile-${tile.id}`}>
      {/* Header */}
      <div className="tile-card-header">
        <div className="tile-card-title">
          <TypeGlyph type={targetType} />
          <span className="tile-column-name">{humanizeFieldName(tile.column)}</span>
          {targetType === "identifier" && (
            <Badge variant="warning">ID column</Badge>
          )}
          {tile.compareColumn && (
            <span className="tile-compare-chip">
              vs {humanizeFieldName(tile.compareColumn)}
              <button type="button" className="compare-chip-remove" onClick={() => handleCompareSelect("")} aria-label="Remove comparison">
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${tile.column} chart`} onClick={onRemove}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Chart area */}
      <div
        className="tile-chart-area"
        title="Drag on the chart to zoom to a region. Double-click to reset."
      >
        {loading ? (
          <div className="tile-loading" style={{ height: CHART_H }}>
            <LoadingDots label="Loading chart…" />
          </div>
        ) : error ? (
          <div className="tile-error" style={{ height: CHART_H }}>
            <span>{error}</span>
            <Button size="sm" onClick={onRetry}>Retry</Button>
          </div>
        ) : (
          renderGraph(tile, data)
        )}
      </div>

      {/* Distribution coverage slider(s) */}
      {showDistSlider && (
        <div className="tile-dist-slider">
          <div className="tile-dist-slider-header">
            <span className="tile-dist-label">Coverage</span>
            <span className="tile-dist-value">{localDistPct}%</span>
          </div>
          <p className="tile-dist-hint">Shows the densest {localDistPct}% of values in this column.</p>
          <input
            type="range"
            className="tile-dist-range"
            min={50}
            max={100}
            step={5}
            value={localDistPct}
            onChange={e => handleDistPctChange(Number(e.target.value))}
          />
        </div>
      )}
      {showScatterDistSliders && (
        <>
          <div className="tile-dist-slider">
            <div className="tile-dist-slider-header">
              <span className="tile-dist-label" title={tile.column}>Coverage ({tile.column})</span>
              <span className="tile-dist-value">{localDistPct}%</span>
            </div>
            <input
              type="range"
              className="tile-dist-range"
              min={50}
              max={100}
              step={5}
              value={localDistPct}
              onChange={e => handleDistPctChange(Number(e.target.value))}
            />
          </div>
          <div className="tile-dist-slider">
            <div className="tile-dist-slider-header">
              <span className="tile-dist-label" title={tile.compareColumn}>Coverage ({tile.compareColumn})</span>
              <span className="tile-dist-value">{localCompareDistPct}%</span>
            </div>
            <input
              type="range"
              className="tile-dist-range"
              min={50}
              max={100}
              step={5}
              value={localCompareDistPct}
              onChange={e => handleCompareDistPctChange(Number(e.target.value))}
            />
          </div>
        </>
      )}

      {/* Inline controls footer */}
      <div className="tile-controls">
        <div className="tile-pills-row">
          {allowedGraphTypes.map(gt => (
            <button
              type="button"
              key={gt.value}
              className={`graph-pill ${tile.graphType === gt.value ? "active" : ""}`}
              onClick={() => tile.graphType !== gt.value && onUpdate({ graphType: gt.value })}
            >
              {gt.label}
            </button>
          ))}
          {allowedAggregations.length > 0 && (
            <>
              <div className="pill-divider" />
              {allowedAggregations.map(agg => (
                <button
                  type="button"
                  key={agg.value}
                  className={`graph-pill ${tile.aggregation === agg.value ? "active" : ""}`}
                  onClick={() => tile.aggregation !== agg.value && onUpdate({ aggregation: agg.value })}
                >
                  {agg.label}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="tile-actions-row">
          {onAsk && (
            <Button variant="outline" size="sm" onClick={onAsk}>
              <MessageSquare className="size-3.5" />
              Ask
            </Button>
          )}
          {onPin && (
            <Button variant="outline" size="sm" onClick={onPin} disabled={!canPin}>
              <Pin className="size-3.5" />
              Pin
            </Button>
          )}
        </div>

        <div className="compare-trigger-wrap" ref={compareRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCompareOpen(o => !o)}
          >
            {tile.compareColumn ? "Change vs" : "Compare"}
          </Button>
          {compareOpen && (
            <div className="compare-picker">
              <input
                type="text"
                placeholder="Search column…"
                value={compareSearch}
                onChange={e => setCompareSearch(e.target.value)}
                className="compare-picker-search"
                autoFocus
              />
              <div className="compare-picker-list">
                {tile.compareColumn && (
                  <button type="button" className="compare-picker-item" onClick={() => handleCompareSelect("")}>
                    None
                  </button>
                )}
                {summary.available_columns
                  .filter(c =>
                    c !== tile.column &&
                    c.toLowerCase().includes(compareSearch.toLowerCase())
                  )
                  .map(c => (
                    <button
                      type="button"
                      key={c}
                      className={`compare-picker-item ${tile.compareColumn === c ? "selected" : ""}`}
                      onClick={() => handleCompareSelect(c)}
                    >
                      <TypeGlyph type={summary.column_semantics[c]?.semantic_type} />
                      {humanizeFieldName(c)}
                    </button>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DashboardCrafter ───────────────────────────────────────────────────────
export default function DashboardCrafter({
  filePath,
  onOpenFile,
  onAskAboutColumn,
  onPinTile,
}: DashboardCrafterProps) {
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [colSearch, setColSearch] = useState("");
  const [tiles, setTiles] = useState<TileConfig[]>(() => loadDashboardTiles(filePath));
  const [tileDataMap, setTileDataMap] = useState<Record<string, any[]>>({});
  const [tileLoadingMap, setTileLoadingMap] = useState<Record<string, boolean>>({});
  const [tileErrorMap, setTileErrorMap] = useState<Record<string, string>>({});
  const summaryControllerRef = useRef<AbortController | null>(null);
  const summaryRequestIdRef = useRef(0);
  const tileControllersRef = useRef<Map<string, AbortController>>(new Map());
  const tileRequestIdsRef = useRef<Map<string, number>>(new Map());
  const tileRequestSequenceRef = useRef(0);
  const currentFilePathRef = useRef(filePath);
  const tileScrollRef = useRef<HTMLDivElement>(null);
  const tileElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const shouldHydrateTilesRef = useRef(false);

  currentFilePathRef.current = filePath;

  const getResponseError = (payload: any, fallback: string) => {
    if (typeof payload?.message === "string") return payload.message;
    if (typeof payload?.error === "string") return payload.error;
    if (typeof payload?.detail === "string") return payload.detail;
    return fallback;
  };

  const fetchSummary = useCallback(async () => {
    if (!filePath) return;

    summaryControllerRef.current?.abort();
    const controller = new AbortController();
    summaryControllerRef.current = controller;
    const requestId = ++summaryRequestIdRef.current;
    setLoading(true);
    setSummaryError(null);

    try {
      const res = await fetch(
        `${SIDECAR_API}/data_summary?source_path=${encodeURIComponent(filePath)}`,
        { signal: controller.signal },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(getResponseError(data, `Unable to load data summary (${res.status})`));
      }
      if (data?.status !== "success" || !data.summary) {
        throw new Error(getResponseError(data, "Unable to load data summary"));
      }
      if (
        !controller.signal.aborted &&
        requestId === summaryRequestIdRef.current &&
        currentFilePathRef.current === filePath
      ) {
        setSummary(data.summary);
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        requestId === summaryRequestIdRef.current &&
        currentFilePathRef.current === filePath
      ) {
        setSummary(null);
        setSummaryError(error instanceof Error ? error.message : "Unable to load data summary");
      }
    } finally {
      if (
        !controller.signal.aborted &&
        requestId === summaryRequestIdRef.current &&
        currentFilePathRef.current === filePath
      ) {
        setLoading(false);
      }
    }
  }, [filePath]);

  useEffect(() => {
    summaryControllerRef.current?.abort();
    summaryRequestIdRef.current += 1;
    tileControllersRef.current.forEach(controller => controller.abort());
    tileControllersRef.current.clear();
    tileRequestIdsRef.current.clear();

    setSummary(null);
    setLoading(false);
    setSummaryError(null);
    setColSearch("");
    const savedTiles = loadDashboardTiles(filePath);
    shouldHydrateTilesRef.current = savedTiles.length > 0;
    setTiles(savedTiles);
    setTileDataMap({});
    setTileLoadingMap({});
    setTileErrorMap({});
    tileElementRefs.current.clear();

    if (filePath) void fetchSummary();

    return () => {
      summaryControllerRef.current?.abort();
      tileControllersRef.current.forEach(controller => controller.abort());
    };
  }, [filePath, fetchSummary]);

  useEffect(() => {
    if (!filePath) return;
    persistDashboardTiles(filePath, tiles);
  }, [filePath, tiles]);

  const fetchTileData = useCallback(async (tileId: string, config: TileConfig) => {
    if (!config.column || !config.graphType) return;

    tileControllersRef.current.get(tileId)?.abort();
    const controller = new AbortController();
    const requestId = ++tileRequestSequenceRef.current;
    tileControllersRef.current.set(tileId, controller);
    tileRequestIdsRef.current.set(tileId, requestId);
    setTileDataMap(prev => {
      const next = { ...prev };
      delete next[tileId];
      return next;
    });
    setTileErrorMap(prev => {
      const next = { ...prev };
      delete next[tileId];
      return next;
    });
    setTileLoadingMap(prev => ({ ...prev, [tileId]: true }));

    try {
      const res = await sidecarFetch(`${SIDECAR_API}/tile_data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          source_path: filePath,
          column: config.column,
          compareColumn: config.compareColumn || "none",
          aggregation: config.aggregation || "",
          graphType: config.graphType,
          distributionPct: config.distributionPct ?? 100,
          compareDistributionPct: config.compareDistributionPct ?? 100,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(getResponseError(data, `Unable to load tile data (${res.status})`));
      }
      if (data?.status !== "success" || !Array.isArray(data.data)) {
        throw new Error(getResponseError(data, "Unable to load tile data"));
      }
      if (
        !controller.signal.aborted &&
        tileRequestIdsRef.current.get(tileId) === requestId &&
        tileControllersRef.current.get(tileId) === controller &&
        currentFilePathRef.current === filePath
      ) {
        setTileDataMap(prev => ({ ...prev, [tileId]: data.data }));
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        tileRequestIdsRef.current.get(tileId) === requestId &&
        tileControllersRef.current.get(tileId) === controller &&
        currentFilePathRef.current === filePath
      ) {
        setTileErrorMap(prev => ({
          ...prev,
          [tileId]: error instanceof Error ? error.message : "Unable to load tile data",
        }));
      }
    } finally {
      if (
        !controller.signal.aborted &&
        tileRequestIdsRef.current.get(tileId) === requestId &&
        tileControllersRef.current.get(tileId) === controller &&
        currentFilePathRef.current === filePath
      ) {
        setTileLoadingMap(prev => ({ ...prev, [tileId]: false }));
        tileControllersRef.current.delete(tileId);
      }
    }
  }, [filePath]);

  useEffect(() => {
    if (!summary || !shouldHydrateTilesRef.current || tiles.length === 0) return;
    shouldHydrateTilesRef.current = false;
    tiles.forEach((tile) => {
      void fetchTileData(tile.id, tile);
    });
  }, [summary, tiles, fetchTileData]);

  const handleColumnClick = (colName: string, event?: React.MouseEvent) => {
    if (!summary) return;
    const existing = tiles.find((t) => t.column === colName);
    if (existing && !event?.altKey) {
      const el = tileElementRefs.current.get(existing.id);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const targetType = summary.column_semantics[colName]?.semantic_type;
    const defaults = getSmartDefaults(targetType);
    const newId = Date.now().toString();
    const newTile: TileConfig = { id: newId, column: colName, ...defaults };
    setTiles(prev => [...prev, newTile]);
    void fetchTileData(newId, newTile);
  };

  const clearAllTiles = () => {
    tileControllersRef.current.forEach(controller => controller.abort());
    tileControllersRef.current.clear();
    tileRequestIdsRef.current.clear();
    setTiles([]);
    setTileDataMap({});
    setTileLoadingMap({});
    setTileErrorMap({});
    tileElementRefs.current.clear();
  };

  const handleTileUpdate = (tileId: string, updates: Partial<TileConfig>) => {
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) return;
    const newTile = { ...tile, ...updates };
    setTiles(prev => prev.map(t => t.id === tileId ? newTile : t));
    void fetchTileData(tileId, newTile);
  };

  const removeTile = (id: string) => {
    tileControllersRef.current.get(id)?.abort();
    tileControllersRef.current.delete(id);
    tileRequestIdsRef.current.delete(id);
    setTiles(prev => prev.filter(t => t.id !== id));
    setTileDataMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTileLoadingMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTileErrorMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const activeColumns = useMemo(() => new Set(tiles.map(t => t.column)), [tiles]);

  if (loading) return <LoadingDots label="Analyzing columns…" />;

  if (!summary) return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Know your data
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {summaryError ? "Couldn’t load column summary" : "Open a dataset to explore columns"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {summaryError ?? "Open a .csv or .parquet file, then click a column to chart it."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {onOpenFile && !summaryError && (
            <EmphasisButton onClick={onOpenFile}>Choose dataset</EmphasisButton>
          )}
          {summaryError && (
            <Button onClick={() => void fetchSummary()}>Retry</Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="dashboard-crafter font-[family-name:var(--font-nav)] text-[var(--color-foreground)]">
      <aside className="col-browser">
        <div className="col-browser-header">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Columns
          </h2>
          <Badge variant="outline">{summary.available_columns.length}</Badge>
        </div>
        <div className="col-browser-search-wrap">
          <Search className="col-browser-search-icon" strokeWidth={1.75} />
          <input
            type="search"
            placeholder="Search columns"
            value={colSearch}
            onChange={e => setColSearch(e.target.value)}
            className="col-browser-search"
          />
        </div>
        <div className="col-browser-list">
          {TYPE_ORDER.map(type => {
            const cols = summary.available_columns.filter(c =>
              summary.column_semantics[c]?.semantic_type === type &&
              c.toLowerCase().includes(colSearch.toLowerCase())
            );
            if (!cols.length) return null;
            return (
              <div key={type} className="col-type-group">
                <div className="col-type-heading">
                  <TypeGlyph type={type} className="size-3" />
                  {TYPE_META[type].label}
                </div>
                {cols.map(c => {
                  const isOpen = activeColumns.has(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      className={cn("col-browser-item", isOpen && "is-open")}
                      onClick={(event) => handleColumnClick(c, event)}
                      title={isOpen ? `${c} — click to focus (Alt+click for another chart)` : `Add chart for ${c}`}
                    >
                      <TypeGlyph type={type} />
                      <div className="col-browser-item-info">
                        <span className="col-browser-item-name">{humanizeFieldName(c)}</span>
                        {formatColumnStats(summary.column_semantics[c]) && (
                          <span className="col-browser-item-stats">
                            {formatColumnStats(summary.column_semantics[c])}
                          </span>
                        )}
                        {summary.column_semantics[c]?.sample_values?.length > 0 && (
                          <span className="col-browser-item-sample">
                            {summary.column_semantics[c].sample_values.slice(0, 2).map(String).join(" · ")}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="tile-canvas">
        <div className="tile-canvas-header">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Charts
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {tiles.length === 0 ? "None open" : `${tiles.length} open`}
            </span>
            {tiles.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllTiles}>
                Clear all
              </Button>
            )}
          </div>
        </div>
        <div className="tile-canvas-scroll" ref={tileScrollRef}>
          {tiles.length === 0 ? (
            <div className="canvas-empty">
              <p className="text-[15px] font-medium tracking-tight text-[var(--color-foreground)]">
                Select a column to explore
              </p>
              <p className="mt-1 max-w-sm text-center text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                Click any column on the left to add a chart. Drag on a chart to zoom; double-click to reset.
              </p>
            </div>
          ) : (
            <div className="tiles-grid">
              {tiles.map(t => {
                const pinArtifact = tileConfigToArtifact(t, tileDataMap[t.id]);
                return (
                  <TileCard
                    key={t.id}
                    tile={t}
                    data={tileDataMap[t.id]}
                    loading={tileLoadingMap[t.id] ?? false}
                    error={tileErrorMap[t.id]}
                    summary={summary}
                    onRemove={() => removeTile(t.id)}
                    onRetry={() => void fetchTileData(t.id, t)}
                    onUpdate={updates => handleTileUpdate(t.id, updates)}
                    tileRef={(el) => {
                      if (el) tileElementRefs.current.set(t.id, el);
                      else tileElementRefs.current.delete(t.id);
                    }}
                    onAsk={onAskAboutColumn ? () => onAskAboutColumn(t.column, t) : undefined}
                    onPin={onPinTile && pinArtifact ? () => onPinTile(pinArtifact) : undefined}
                    canPin={!!pinArtifact}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
