import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConversationArtifact, VisualizationSpec } from "./DAGEditor";
import type { ArtifactSlot } from "./canvasManifest";
import { dashboardEmptyMessage } from "./canvasManifest";
import {
  rechartsXAxisLabel,
  rechartsYAxisLabel,
  resolveChartPresentation,
} from "./chartPresentation";
import "./VisualizationView.css";

const COLORS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#dc2626"];
const GRID = { strokeDasharray: "3 3", stroke: "rgba(0,0,0,0.09)" };
const CARTESIAN_MARGIN = { top: 16, right: 20, left: 52, bottom: 28 };
const EVIDENCE_CHART_HEIGHT = 420;

function toRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> =>
        row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }
  return [];
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function orderedRows(rows: Record<string, unknown>[], spec: VisualizationSpec) {
  if (!spec.sort_by) return rows;
  return [...rows].sort((a, b) => {
    const left = a[spec.sort_by!] ?? "";
    const right = b[spec.sort_by!] ?? "";
    const comparison = String(left).localeCompare(String(right), undefined, { numeric: true });
    return spec.sort_direction === "desc" ? -comparison : comparison;
  });
}

function useObservedSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function SeriesChart({
  spec,
  rows,
  chartHeight = 420,
  chartWidth,
  margin = CARTESIAN_MARGIN,
  showYAxisLabel = true,
}: {
  spec: VisualizationSpec;
  rows: Record<string, unknown>[];
  chartHeight?: number;
  chartWidth?: number;
  margin?: { top: number; right: number; left: number; bottom: number };
  showYAxisLabel?: boolean;
}) {
  const presentation = resolveChartPresentation(spec);
  const yFields = spec.y;
  const data = orderedRows(rows, spec);
  const yAxisLabelProps = showYAxisLabel
    ? { label: rechartsYAxisLabel(presentation.yAxisLabel) }
    : {};

  if (spec.kind === "pie") {
    const y = yFields[0];
    const outerRadius = chartWidth
      ? Math.max(Math.min(chartWidth, chartHeight) * 0.38, 48)
      : 145;
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <PieChart>
          <Tooltip />
          <Legend
            formatter={(value) => String(value)}
          />
          <Pie
            data={data}
            dataKey={y}
            nameKey={spec.x}
            outerRadius={outerRadius}
            fill={COLORS[0]}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (spec.kind === "scatter") {
    const y = yFields[0];
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ScatterChart margin={margin}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey={spec.x}
            name={presentation.xAxisLabel}
            label={rechartsXAxisLabel(presentation.xAxisLabel)}
          />
          <YAxis
            dataKey={y}
            name={presentation.yAxisLabel}
            width={56}
            {...yAxisLabelProps}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={COLORS[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  const Chart = spec.kind === "line" ? LineChart : spec.kind === "bar" ? BarChart : AreaChart;
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <Chart data={data} margin={margin}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey={spec.x}
          name={presentation.xAxisLabel}
          label={rechartsXAxisLabel(presentation.xAxisLabel)}
          minTickGap={24}
        />
        <YAxis width={56} {...yAxisLabelProps} />
        <Tooltip />
        {yFields.length > 1 && <Legend />}
        {yFields.map((field, index) =>
          spec.kind === "line" ? (
            <Line key={field} type="monotone" dataKey={field} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} />
          ) : spec.kind === "bar" ? (
            <Bar key={field} dataKey={field} fill={COLORS[index % COLORS.length]} radius={[3, 3, 0, 0]} />
          ) : (
            <Area key={field} type="monotone" dataKey={field} stroke={COLORS[index % COLORS.length]} fill={COLORS[index % COLORS.length]} fillOpacity={0.16} strokeWidth={2} />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

function EmbeddedVisualizationChart({
  spec,
  rows,
}: {
  spec: VisualizationSpec;
  rows: Record<string, unknown>[];
}) {
  const { ref, size } = useObservedSize<HTMLDivElement>();
  const chartHeight = Math.max(size.height - 36, 80);
  const presentation = resolveChartPresentation(spec);

  return (
    <section className="visualization-view visualization-view--embedded">
      <div ref={ref} className="visualization-chart-card">
        <div className="visualization-embedded-title">{presentation.title}</div>
        {spec.kind === "pie" && (
          <p className="visualization-embedded-meta">
            {presentation.xAxisLabel} · {presentation.yAxisLabel}
          </p>
        )}
        {size.height > 0 && (
          <SeriesChart
            spec={spec}
            rows={rows}
            chartHeight={chartHeight}
            chartWidth={size.width}
          />
        )}
      </div>
    </section>
  );
}

export default function VisualizationView({
  artifact,
  embedded = false,
  dashboardSlot,
  includeVisualizationRequested = false,
}: {
  artifact: ConversationArtifact | null;
  embedded?: boolean;
  dashboardSlot?: ArtifactSlot | null;
  includeVisualizationRequested?: boolean;
}) {
  const spec = artifact?.visualizationSpec;
  const rows = toRecords(artifact?.resultPreview);

  if (!spec) {
    const message = dashboardEmptyMessage(
      dashboardSlot
        ? { requestedArtifactKinds: [], slots: [dashboardSlot] }
        : null,
      includeVisualizationRequested,
    );
    return (
      <section className="visualization-empty">
        <span className="section-label">Dashboard</span>
        <h2>No dashboard yet</h2>
        <p>{message}</p>
      </section>
    );
  }

  const presentation = resolveChartPresentation(spec);
  const missing = [spec.x, ...spec.y].filter(
    (field) => !rows.some((row) => field in row),
  );
  const numericRows = rows.filter((row) => spec.y.some((field) => isFiniteNumber(row[field])));
  if (missing.length || !numericRows.length) {
    return (
      <section className="visualization-empty">
        <span className="section-label">Visualization artifact</span>
        <h2>{presentation.title}</h2>
        <p>
          The chart data does not contain the fields required by its visualization contract:
          {" "}{missing.length ? missing.join(", ") : spec.y.join(", ")}.
        </p>
      </section>
    );
  }

  if (embedded) {
    return <EmbeddedVisualizationChart spec={spec} rows={numericRows} />;
  }

  return (
    <EvidenceVisualizationChart spec={spec} rows={numericRows} presentation={presentation} />
  );
}

function EvidenceVisualizationChart({
  spec,
  rows,
  presentation,
}: {
  spec: VisualizationSpec;
  rows: Record<string, unknown>[];
  presentation: ReturnType<typeof resolveChartPresentation>;
}) {
  const showYAxisLabelOverlay = spec.kind !== "pie";

  return (
    <section className="visualization-view">
      <div className="visualization-view-header">
        <div>
          <span className="section-label">Visualization artifact</span>
          <h2>{presentation.title}</h2>
          <p>{rows.length.toLocaleString()} locally computed data points · {spec.kind} chart</p>
        </div>
      </div>
      <div className="visualization-chart-card">
        <div className="visualization-chart-stage">
          {showYAxisLabelOverlay && (
            <span className="visualization-y-axis-label">{presentation.yAxisLabel}</span>
          )}
          <div className="visualization-chart-plot">
            <SeriesChart
              spec={spec}
              rows={rows}
              chartHeight={EVIDENCE_CHART_HEIGHT}
              margin={CARTESIAN_MARGIN}
              showYAxisLabel={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
