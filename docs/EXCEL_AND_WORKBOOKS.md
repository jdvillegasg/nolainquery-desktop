# Excel and workbooks

nolainquery treats **Excel**, **CSV**, and **Parquet** as local inputs. Excel is
a **workbook** — a container that may hold several sheets with different
layouts. CSV and Parquet are treated as workbooks with a single table.

The desktop does not query the raw `.xlsx` file directly. When you open a file,
the local engine **ingests** it, detects which sheets look like tables, and
materializes each importable table to a cached Parquet file on your machine.
Preview, insights, and query execution always run against the **active table**.

This page explains that model, how tabular sheets are detected, and what is
supported today.

## Supported file types

| Format | Extensions | Desktop support |
| --- | --- | --- |
| Excel | `.xlsx`, `.xls` | Full first-class support |
| CSV | `.csv` | Full support (single table) |
| Parquet | `.parquet` | Supported (single table; often used internally after ingest) |

Priority in the product is **Excel first**, then **CSV**. Parquet remains
available for performance and advanced workflows.

## What “table-scoped” means

Today’s analysis capability is **one active table, one `df`**:

- You pick **one importable sheet** (or one CSV/Parquet file) as the active
  dataset.
- The Cloud API receives a sketch of **that table’s columns** only.
- Generated code runs locally against the materialized active table.
- **Cross-sheet joins** and “analyze the whole workbook at once” are **not**
  supported yet.

If your question refers to another sheet in the same workbook, switch the active
table on **Home** or rephrase the question for the table you have loaded.

## Opening a workbook

1. Open **Home** and choose **Choose dataset**.
2. Select `.xlsx`, `.xls`, `.csv`, or `.parquet`.
3. The local engine calls `POST /open_workbook` and returns a **catalog**:
   - importable tables (with row/column counts)
   - skipped sheets (with a reason)
   - the default **active table**
4. For Excel with multiple importable sheets, use **Workbook tables** on Home
   to switch the active table.
5. Preview, insights, and Ask Queries use the active table’s materialized path.

The original file stays where you saved it. Cached tables live under
`~/.cache/nolainquery/workbooks` unless overridden by
`NOLAIN_WORKBOOK_CACHE_DIR`.

## How tabular sheets are detected

Excel workbooks often mix **data sheets** with **cover pages**, **notes**,
**dashboards**, or **sparse layouts**. Before a sheet becomes queryable,
nolainquery runs a deterministic **table-detection** pass on each sheet (hidden
sheets are skipped by default).

Detection does **not** scan every cell of a large sheet. It classifies the
sheet from a **small sample**, then loads the full sheet **at most once** if
that sample already looks like a table.

### Sample first, then one full load

For each visible sheet the engine:

1. Reads only the first **header sample** of rows with no header applied.
   Sample size is

   ```text
   max(header_scan_rows + min_data_rows + header_sample_padding, header_sample_floor)
   ```

   With the defaults in `workbook.yaml` that is `max(20 + 2 + 5, 40)` = **40
   rows**.
2. Runs the checks below on that sample’s **used range**, trimmed to a bounding
   box of non-empty cells.
3. If the sample is **not** a table, the sheet is skipped. The rest of the sheet
   is never loaded.
4. If the sample **is** a table and those sample rows were the whole sheet, that
   sample is the imported table — there is no second read.
5. If the sample is a table and the sheet is larger, the engine reads the full
   sheet **once**, using the detected header row as column names, and
   materializes that grid to Parquet.

Importable sheets still keep **all rows** after that full load. The sample is
only for classification, not a substitute for the cached table.

The checks below run in order on the sample. A sheet is **importable** only if
it passes all of them (unless you choose **Import anyway**).

### 1. Non-empty used range

If the trimmed sheet has no cells, it is skipped as an **empty sheet**.

### 2. Fill density

**Fill density** is the share of non-empty cells inside the bounding box:

```text
fill_density = non_empty_cells / (rows × columns)
```

Sheets below **15%** fill density are treated as **sparse / non-table** (typical
cover pages, title blocks, or KPI callouts with large empty regions).

| Setting | Default |
| --- | --- |
| Minimum fill density | `0.15` (15%) |

### 3. Header row detection

Real tables often start below title rows. The engine scans the first
**`header_scan_rows`** (default **20**) rows of the sample and scores each row
as a candidate **header row**.

**Header confidence** combines:

- **Header score** — share of columns in that row with non-empty, non-numeric
  labels (strings that look like field names).
- **Consistency score** — share of columns that have at least one non-empty value
  in the next **`header_consistency_rows`** (default **5**) data rows below the
  candidate header.

The best-scoring row must meet a minimum confidence of **0.4**. If no row
qualifies, the sheet is skipped as **low header confidence** (unless you force
import).

| Setting | Default (see `workbook.yaml`) |
| --- | --- |
| Header scan depth | `header_scan_rows: 20` |
| Header sample floor | `header_sample_floor: 40` |
| Header consistency rows | `header_consistency_rows: 5` |
| Minimum header confidence | `min_header_confidence: 0.4` |

After a header row is chosen, the engine:

- uses that row as column names (normalizing blanks and duplicates),
- drops fully empty rows below the header,
- drops fully empty columns.

### 4. Minimum table size

The extracted grid must look like a real table:

| Check | Default threshold |
| --- | --- |
| Minimum data rows (below header) | 2 |
| Minimum columns | 2 |

Sheets that fail are skipped as **too few rows** or **too few columns**.

### 5. Unnamed column ratio

When pandas reads Excel without a clear header, it produces columns like
`Unnamed: 0`. If more than **60%** of column names are unnamed or blank after
extraction, the sheet is treated as **low header confidence** and skipped.

| Setting | Default |
| --- | --- |
| Maximum unnamed column ratio | `0.6` (60%) |

### 6. Hidden sheets

For `.xlsx` files, sheets marked **hidden** or **very hidden** in Excel are
skipped unless you explicitly force-import them.

## Skip reasons you may see in the app

| Reason | Meaning |
| --- | --- |
| `sparse_non_table` | Fill density below 15% |
| `low_header_confidence` | No reliable header row, or too many unnamed columns |
| `too_few_rows` | Fewer than 2 data rows after extraction |
| `too_few_columns` | Fewer than 2 columns after extraction |
| `empty_sheet` | No non-empty cells |
| `hidden_sheet` | Sheet is hidden in Excel |
| `read_error` | The engine could not read the sheet |

Skipped sheets are listed on **Home**. Use **Import anyway** to bypass
detection for a specific sheet when you know it contains usable data.

## Default active table

When a workbook has several importable sheets, the desktop selects the default
active table from `default_active_table` in `workbook.yaml`:

| Value | Meaning |
| --- | --- |
| `largest` (default) | Most rows, then most columns, then sheet name |
| `first_visible` | First importable sheet in file order |

Cover or notes tabs that appear first in Excel are therefore less likely to
become the active dataset when `largest` is set.

The Cloud API sketch for Excel is built from that **active table’s
materialized Parquet** (the same `open_workbook` ingest as Home), not from
the first sheet or a random sample.

## What the Cloud API sees

For Excel, the desktop sends the usual sketch fields for the **active table**
(`available_columns`, `column_semantics`, row counts) plus a compact
**workbook** block:

- workbook file name
- active table name
- names of other importable tables (not their columns)
- skipped sheets and reasons

The cloud uses this to answer meta questions (“What sheets do I have?”) and to
refuse cross-table join requests with a clear message. It does **not** receive
the full workbook or paths to cached files.

## Current limits

- One active table per session; switch tables on Home to analyze another sheet.
- No cross-sheet joins or multi-table codegen in v1.
- Detection assumes **one rectangular table per sheet** (largest dense region
  in the sample); multiple unrelated tables on the same sheet are not split
  automatically.
- Tables whose header sits **below the sample** (beyond
  `header_sample_floor`, default 40 rows) are not found unless you raise
  `header_sample_floor` (or `NOLAIN_WORKBOOK_HEADER_SAMPLE_FLOOR`) or
  **Import anyway**.
- Very large **importable** sheets are still fully loaded into memory once
  during ingest (same class of limit as other local Excel reads). Cover pages
  and other skipped sheets avoid that full load.
- Formulas are read as **cached values** shown in Excel, not re-evaluated.

## Workbook ingest configuration (`workbook.yaml`)

Thresholds live in
`desktop_app/python_engine/src/workbook/workbook.yaml`. Override the whole
file with `NOLAIN_WORKBOOK_CONFIG=/path/to/workbook.yaml`, or a single key
with `NOLAIN_WORKBOOK_<FIELD>` (uppercase). The cache directory remains
`NOLAIN_WORKBOOK_CACHE_DIR`.

Checked-in defaults:

```yaml
min_data_rows: 2
min_columns: 2
min_fill_density: 0.15
max_unnamed_column_ratio: 0.6
min_header_confidence: 0.4
header_scan_rows: 20
header_sample_padding: 5
header_sample_floor: 40
header_consistency_rows: 5
include_hidden_sheets: false
materialized_format: parquet
ingest_version: "4"
default_active_table: largest      # or first_visible
preview_row_cap: 100000
identifier_cardinality_max: 20     # integer columns below this cardinality → categorical
```

### Example: headers start on row 45

The default sample floor of 40 misses that header. Raise the floor:

```yaml
header_sample_floor: 80
```

or:

```bash
export NOLAIN_WORKBOOK_HEADER_SAMPLE_FLOOR=80
```

### Example: keep the first visible sheet as active

```yaml
default_active_table: first_visible
```

### Example: treat more integer id-like columns as categorical

```yaml
identifier_cardinality_max: 50
```

`preview_row_cap` caps local preview/insights reads (default 100_000 rows),
not ingest itself.

---

## If a sheet you need was skipped

1. Read the skip reason on **Home**.
2. Try **Import anyway** if the layout is valid but detection was too strict.
3. If the sheet is a cover or notes page, move the data to a dedicated tabular
   sheet or export that sheet to CSV.
4. Ensure the header row is readable: clear column names in one row, at least two
   columns, and at least two data rows below the header.

For broader file and workflow help, see
[Desktop workflows](./DESKTOP_WORKFLOWS.md) and
[Troubleshooting](./TROUBLESHOOTING.md).
