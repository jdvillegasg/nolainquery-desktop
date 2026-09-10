# Troubleshoot the desktop workflow

Use the message visible in the desktop or hosted service response to choose a
recovery path. These steps stay on the user side: they restore a normal
workflow without exposing service credentials or operator infrastructure.

## The API key is missing or rejected

**Visible symptom:** Ask Queries says `No API key configured`, Settings says
`No API key set. Queries will be blocked`, or a request reports a missing or
invalid API key.

1. Open **Settings**.
2. Paste an active key from
   [nolainquery.com/account](https://nolainquery.com/account).
3. Choose **Save API Key**.
4. Wait for the status badge to show the tier before retrying.

If the key was revoked, lost, or is still rejected, revoke it in
**Account → API Keys**, create a new key, and save the replacement in the
desktop. The portal shows a full key only at creation time.

## BYOK / OpenRouter key problems

**Visible symptom:** requests fail with authentication or model errors while
**Bring your own key** is enabled.

1. Open **Settings → Model inference**.
2. Confirm **Bring your own key** is selected and the OpenRouter key is saved.
3. Verify the key is active at [openrouter.ai/keys](https://openrouter.ai/keys).
4. Retry the request.

If BYOK is disabled on the server, the Settings panel shows that bring-your-own-key
is unavailable. Switch back to platform inference or contact support.

## The request is unsupported or out of scope

**Visible symptom:** nolainquery says the request cannot be done with the available
capabilities, refuses an unrelated question, or Settings reports that
visualization or transformation requests are disabled.

The current capability performs descriptive analysis of one loaded file. Ask
for historical summaries, comparisons, rankings, distributions, data quality,
cleaning, reshaping, or a chart. Forecasting, statistical inference,
optimization, and anomaly detection are unavailable.

For example, replace:

```text
Forecast next quarter's revenue.
```

with an implemented descriptive request:

```text
Show monthly historical revenue and compare the latest quarter with the previous quarter.
```

If a chart or transformation was blocked locally, open
**Settings → Capabilities & plans**, enable the corresponding feature, save,
and submit the request again. Otherwise keep the feature disabled and rephrase
the request as a table or descriptive analysis.

## Intent classification returns 503

**Visible symptom:** the request returns HTTP 503 with a message such as
`Intent classification failed`, or reports that the language-model service is
unavailable.

The hosted service could not classify the conversation turn, so no analysis job
was accepted. Wait briefly and retry the same request once. If the failure
continues, verify that [nolainquery.com](https://nolainquery.com) is reachable
and [contact support](https://nolainquery.com/contact) with the approximate
time and the visible error text. Do not include your API keys or file contents.

## The desktop cannot reach a service

Three services participate in a normal query: the desktop UI, the local Python
engine that reads and executes the file, and the hosted service that generates
the calculation.

**Tauri build fails: `resource path bin/python-sidecar-... doesn't exist`**

The source dev path requires a one-time sidecar build after setup. From the
repository root:

```bash
./desktop_app/python_engine/build-sidecar.sh
```

On Windows, run `.\desktop_app\python_engine\build-sidecar.ps1` instead. Then
retry `./launch.sh` or `.\launch.ps1`. Re-run the sidecar build when the
Python engine changes in a way that affects the packaged binary.

**Local engine unreachable or connection refused**

Restart the desktop launcher. A source run is ready only after its terminal
prints `Local execution engine is ready.` If port 8001 is already occupied,
stop the other engine process before starting `./launch.sh` again.

**Hosted service unreachable or request failed to fetch**

Confirm that the machine is online. For a source build using the hosted
service, restart it from the repository root with:

```bash
VITE_CLOUD_API_URL=https://nolainquery.com ./launch.sh
```

A plain development launch defaults to a Cloud API on
`http://127.0.0.1:8000`, so it will fail unless you point `VITE_CLOUD_API_URL`
at the hosted service or run a local API yourself.

**Hosted service online, but generation runtime unavailable**

The service is reachable but cannot queue generation work. Retry later and
contact support if it persists.

## The app asks for clarification

**Visible symptom:** the conversation shows **Clarification needed** and offers
interpretations for one or more terms.

This is a request for intent, not an execution failure. Select one meaning for
each term and submit the choices. nolainquery sends those meanings with the resumed
request and uses them when generating the calculation.

If no option matches, choose the rephrase action and rewrite the original
question with an explicit definition. For example, change “top customers” to
“the five customers with the highest total revenue.”

## Local execution fails and repair runs out

**Visible symptom:** progress reaches **Repairing generated code**, then the
answer reports that it could not compute a result, generated code was blocked
for safety, a column was not found, or the generation attempt ceiling was
exhausted.

The desktop reports a local Pandas error to the hosted service, which can
generate a repair. The current configuration limits sandbox, syntax, and
local-runtime repair attempts; it does not retry indefinitely.

Use the narrowest matching action:

1. For an unknown column, return to **Home** and copy the exact column name into
   the question.
2. For a format-loading error, reopen a supported `.xlsx`, `.xls`, `.csv`, or
   `.parquet` file.
3. For a safety block, remove requests for filesystem, network, package, or
   process access and ask only for a calculation over the loaded data.
4. For a complex failure, split the request into a smaller calculation, verify
   that result, then ask a follow-up.
5. If Pandas produced a valid answer but only graph compilation failed, turn
   off **Computation graph** and retry without that optional artifact.

Repeating the identical request many times is less useful than changing the
column name, scope, or optional graph setting.

## The selected file does not appear

The desktop chooser lists `.xlsx`, `.xls`, `.csv`, and `.parquet`. If an Excel
file opens but shows no data, the workbook may have **no importable sheets** —
every sheet failed table detection. See
[Excel and workbooks](./EXCEL_AND_WORKBOOKS.md) for fill-density and header
heuristics, skip reasons, and the **Import anyway** option.

If a sheet you need was skipped as sparse or low-confidence, try **Import
anyway** on Home or move the table to a dedicated sheet with a clear header row
and at least two columns and two data rows.

Once the visible symptom is resolved, return to
[Desktop workflows](./DESKTOP_WORKFLOWS.md).
