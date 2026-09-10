import type { ConversationArtifact, VisualizationKind } from "./DAGEditor";
import { humanizeFieldName } from "./chartPresentation";
import { snapshotConversationArtifact } from "./queryThreads";

export interface TileConfig {
  id: string;
  column: string;
  compareColumn?: string;
  aggregation?: string;
  graphType?: string;
  distributionPct?: number;
  compareDistributionPct?: number;
}

const DASHBOARD_TILES_KEY = "nolain_dashboard_tiles";

function storageKey(filePath: string): string {
  return `${DASHBOARD_TILES_KEY}:${filePath || "__no_file__"}`;
}

export function loadDashboardTiles(filePath: string): TileConfig[] {
  if (!filePath) return [];
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    if (!raw) return [];
    return JSON.parse(raw) as TileConfig[];
  } catch {
    return [];
  }
}

export function persistDashboardTiles(filePath: string, tiles: TileConfig[]): void {
  if (!filePath) return;
  localStorage.setItem(storageKey(filePath), JSON.stringify(tiles));
}

export function tileConfigToArtifact(
  tile: TileConfig,
  data: unknown[] | undefined,
): ConversationArtifact | null {
  if (!data?.length || !tile.graphType) return null;

  const title = tile.compareColumn
    ? `${humanizeFieldName(tile.column)} vs ${humanizeFieldName(tile.compareColumn)}`
    : humanizeFieldName(tile.column);

  const query = tile.compareColumn
    ? `Explore ${tile.column} compared to ${tile.compareColumn}`
    : `Explore column: ${tile.column}`;

  if (tile.graphType === "scatter") {
    return snapshotConversationArtifact({
      dagData: null,
      dagName: null,
      pythonCode: null,
      query,
      kind: "visualization",
      resultPreview: data,
      visualizationSpec: {
        version: 1,
        kind: "scatter",
        title,
        x: "x",
        y: ["y"],
        sort_direction: "asc",
        x_label: humanizeFieldName(tile.compareColumn || "x"),
        y_label: humanizeFieldName(tile.column),
      },
    });
  }

  const nameKey = tile.aggregation ? "compareKey" : "name";
  const vizKind: VisualizationKind = tile.graphType === "distribution" ? "area" : "bar";
  const categorySource = tile.aggregation ? (tile.compareColumn || tile.column) : tile.column;
  const yLabel =
    tile.aggregation && tile.compareColumn
      ? humanizeFieldName(tile.compareColumn)
      : tile.graphType === "distribution"
        ? "Frequency"
        : "Value";

  return snapshotConversationArtifact({
    dagData: null,
    dagName: null,
    pythonCode: null,
    query,
    kind: "visualization",
    resultPreview: data,
    visualizationSpec: {
      version: 1,
      kind: vizKind,
      title,
      x: nameKey,
      y: ["value"],
      sort_direction: "asc",
      x_label: humanizeFieldName(categorySource),
      y_label: yLabel,
    },
  });
}

export function formatColumnStats(
  semantics: { null_ratio?: number; cardinality?: number } | undefined,
): string | null {
  if (!semantics) return null;
  const parts: string[] = [];
  if (typeof semantics.null_ratio === "number") {
    parts.push(`${Math.round(semantics.null_ratio * 100)}% null`);
  }
  if (typeof semantics.cardinality === "number") {
    parts.push(`${semantics.cardinality.toLocaleString()} distinct`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
