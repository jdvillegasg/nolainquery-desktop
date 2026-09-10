import { SIDECAR_API, sidecarFetch } from "./cloudApi";

export type TableRole = "table" | "skipped" | "unstructured";

export interface WorkbookTable {
  id: string;
  sheet_name: string;
  role: TableRole;
  materialized_path?: string;
  row_count?: number;
  column_count?: number;
  skip_reason?: string;
  header_row?: number;
}

export interface WorkbookCatalog {
  source_path: string;
  source_kind: "csv" | "parquet" | "excel";
  source_name: string;
  active_table_id: string;
  tables: WorkbookTable[];
  cache_dir?: string;
  ingest_version?: string;
}

export interface CloudWorkbookMetadata {
  name: string;
  table_count: number;
  active_table: string;
  active_table_rows?: number;
  active_table_columns?: number;
  other_tables: string[];
  skipped_sheets: Array<{ name: string; reason: string }>;
}

export function importableTables(catalog: WorkbookCatalog): WorkbookTable[] {
  return catalog.tables.filter((table) => table.role === "table");
}

export function skippedTables(catalog: WorkbookCatalog): WorkbookTable[] {
  return catalog.tables.filter((table) => table.role !== "table");
}

export function activeTable(catalog: WorkbookCatalog): WorkbookTable | undefined {
  return catalog.tables.find((table) => table.id === catalog.active_table_id);
}

export function activeMaterializedPath(catalog: WorkbookCatalog): string {
  const table = activeTable(catalog);
  if (!table?.materialized_path) {
    throw new Error(`Active table ${catalog.active_table_id} is not materialized`);
  }
  return table.materialized_path;
}

export function buildCloudWorkbookMetadata(
  catalog: WorkbookCatalog | null,
): CloudWorkbookMetadata | undefined {
  if (!catalog || catalog.source_kind !== "excel") return undefined;
  const current = activeTable(catalog);
  if (!current) return undefined;
  return {
    name: catalog.source_name,
    table_count: importableTables(catalog).length,
    active_table: current.sheet_name,
    ...(typeof current.row_count === "number"
      ? { active_table_rows: current.row_count }
      : {}),
    ...(typeof current.column_count === "number"
      ? { active_table_columns: current.column_count }
      : {}),
    other_tables: importableTables(catalog)
      .filter((table) => table.id !== catalog.active_table_id)
      .map((table) => table.sheet_name),
    skipped_sheets: skippedTables(catalog).map((table) => ({
      name: table.sheet_name,
      reason: table.skip_reason ?? "skipped",
    })),
  };
}

export function datasetDisplayLabel(
  catalog: WorkbookCatalog | null,
  filePath: string,
): string {
  if (!catalog) {
    return filePath.split("/").pop() ?? filePath;
  }
  const table = activeTable(catalog);
  if (catalog.source_kind === "excel" && table) {
    return `${catalog.source_name} · ${table.sheet_name}`;
  }
  return catalog.source_name;
}

export async function openWorkbook(
  sourcePath: string,
  options?: {
    activeTableId?: string;
    activeSheetName?: string;
    forceIncludeSheets?: string[];
  },
): Promise<WorkbookCatalog> {
  const response = await sidecarFetch(`${SIDECAR_API}/open_workbook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_path: sourcePath,
      active_table_id: options?.activeTableId,
      active_sheet_name: options?.activeSheetName,
      force_include_sheets: options?.forceIncludeSheets,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.status !== "success" || !data.catalog) {
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item: { msg?: string } | string) =>
                typeof item === "string" ? item : item?.msg ?? "",
              )
              .filter(Boolean)
              .join("; ")
          : "";
    throw new Error(message || "Could not open workbook");
  }
  return data.catalog as WorkbookCatalog;
}

export function formatSkipReason(reason?: string): string {
  switch (reason) {
    case "sparse_non_table":
      return "Sparse or non-tabular layout";
    case "too_few_rows":
      return "Too few data rows";
    case "too_few_columns":
      return "Too few columns";
    case "low_header_confidence":
      return "Could not detect a header row";
    case "empty_sheet":
      return "Empty sheet";
    case "hidden_sheet":
      return "Hidden sheet";
    case "read_error":
      return "Could not read sheet";
    default:
      return reason ? reason.replace(/_/g, " ") : "Skipped";
  }
}
