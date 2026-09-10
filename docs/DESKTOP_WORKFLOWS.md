# Desktop workflows

Once a file and API keys are ready, the desktop provides several task-focused
views. **Home** opens and previews data, **Know Your Data** builds exploratory
charts, **Ask Queries** generates calculations, **Pinned** collects useful
evidence, and **Settings** controls generation and shows local usage history.

## Open, preview, and switch datasets

Open **Home** and choose **Choose dataset**. The file chooser supports
`.xlsx`, `.xls`, `.csv`, and `.parquet`. Excel workbooks are ingested locally:
each importable sheet becomes a cached table, and you choose the **active
table** before querying. See [Excel and workbooks](./EXCEL_AND_WORKBOOKS.md) for
how tabular vs non-table sheets are detected.

After the local engine prepares the active table, Home shows:

- the active dataset name (workbook name and sheet for Excel)
- available row and column counts
- for Excel, a **Workbook tables** picker and any skipped sheets
- data-quality cards for properties such as completeness and duplicates
- a paginated row preview
- recently opened source files for quick switching

Choose a data-quality card to read its explanation. Use **Change file**, a
recent-file entry, or the workbook table picker to switch the active dataset.
The app keeps the source file path in recents; query threads are keyed to the
active materialized table. The full source file remains on the device.

From the active-dataset strip, **Ask about this data** opens Ask Queries with a
starter question, while **Explore columns** opens Know Your Data.

## Explore columns without writing a query

**Know Your Data** reads a local summary and groups columns by inferred semantic
type. Search the column list, then select a column to add a chart tile. The app
chooses an initial chart and aggregation from the column type.

Each tile can change its chart, aggregation, distribution coverage, or
comparison column where those controls apply. Drag across a chart to zoom and
double-click it to reset. **Ask** carries the selected column into Ask Queries,
and **Pin** sends a completed tile to the Pinned view. Tile choices are saved
locally for that file; **Clear all** removes the open exploration tiles.

This view performs deterministic local exploration. It does not require the
hosted service to invent a query, although the local Python engine must be
running.

## Ask a question and follow the answer

Open **Ask Queries**, enter a concrete request, and choose **Ask** or press
`Ctrl+Enter` (`Command+Enter` on macOS). For example:

```text
Compare total revenue by country and show the five largest values.
```

The conversation panel preserves recent chats locally. Use **New** for a fresh
thread, or select an earlier thread to return to its messages and artifacts.
A thread can save up to ten analysis artifacts; after that, create a new
conversation.

For an analysis request, the desktop sends the question and compact file
metadata to the hosted service, receives generated Pandas code and optional
artifacts, then executes the calculation through the local engine. The answer
card presents the result and can expose recipe steps that lead to the relevant
code cell or graph node. Full result export is available as CSV; transformation
artifacts preserve the active source format when supported by the export path.

If nolainquery asks what a term means, select an interpretation for each term and
submit it. The chosen meanings accompany the resumed request. Choose the
rephrase option when none of the choices matches your intent.

## Inspect code and run notebook cells

Every successful generated analysis can expose **Code** as calculation
evidence. The code view divides generated Python into notebook-style cells at
top-level section comments. Each cell has its own run button and displays its
result, variables, execution time, or a user-facing error.

Cells share a persistent local session, so later cells can use variables
created by earlier ones. The initial answer execution runs the generated cells
from top to bottom in a fresh session. A later manual cell run does not
automatically run its prerequisites, so rerun dependent cells in order when
needed. The current code view has no separate **Run all cells** control.

The notebook is an inspection and execution surface for generated code, not a
general-purpose hosted notebook. Code runs in the local engine’s restricted
Pandas executor, and safety-blocked operations do not run.

## Add and inspect a computation graph

Before asking, enable **Computation graph** in the query composer. The hosted
service then attempts to compile an additional directed acyclic graph (DAG): a
visual sequence of calculation operations and dependencies.

When compilation succeeds, **Graph** appears beside **Code**. You can inspect
nodes, auto-layout the graph, execute it locally, enter **Edit graph** mode,
add operations, and save the graph as DAG JSON. Graph compilation is optional
and can fail while the Pandas result succeeds.

When an answer includes a visualization specification, a **Dashboard** evidence
tab renders the resulting chart. This generated dashboard is distinct from the
deterministic chart tiles in Know Your Data.

## Collect evidence on the Pinned canvas

Use the pin control on a chart, generated graph, or generated code artifact to
add it to **Pinned**. The Pinned view is a local canvas for arranging evidence
from the active dataset and returning to its source answer. Pinning does not
publish or upload the artifact.

Only completed artifact types supported by the current pinning controls can be
added. An unavailable pin control means that view has no pinnable artifact yet.

## Configure implemented generation features

Open **Settings → Capabilities & plans** to control locally stored generation
preferences:

- **Execution plan**: Automatic selects the default implemented Pandas plan.
  Ibis is a placeholder and is not selectable as a working engine.
- **Allow visualization requests**: when disabled, chart or plot requests are
  blocked locally with guidance to enable the setting or ask for a table.
- **Allow transformation requests**: when disabled, cleaning, reshaping, and
  export-copy requests are blocked before generation.

The **Computation graph** switch remains in Ask Queries because a graph is an
optional artifact, not a separate execution plan.

## Read local usage history

**Settings → Query usage** combines usage attached to saved conversations with
locally persisted generation records. It shows:

- input and output tokens for the last query and selected period
- cumulative token charts for the last day, seven days, or 30 days
- last-query time, recent and period averages, and query counts

When the hosted service reports model time, the app uses it; otherwise it falls
back to elapsed wall-clock time from question to answer. Older turns may show
no token counts. These metrics stay in desktop local storage and are not a
billing ledger.

Keep [Troubleshooting](./TROUBLESHOOTING.md) nearby for visible recovery steps.
