# Getting started

nolainquery combines this desktop application with a hosted reasoning service.
The desktop reads a file on your computer, sends the service a compact
description of that file, and runs the returned analysis locally.

This guide covers account setup, API keys, and the free **bring-your-own-key
(BYOK)** inference mode.

## Before you begin

You need:

- the desktop app running — follow [Try locally](./TRY_LOCALLY.md) or use a
  packaged AppImage
- a Google account for portal sign-in at
  [nolainquery.com/login](https://nolainquery.com/login)
- one local data file: `.xlsx`, `.xls`, `.csv`, or `.parquet`

For BYOK inference you also need an [OpenRouter](https://openrouter.ai/keys) API
key. Model charges go to your OpenRouter account instead of nolainquery credits.

## Create a nolainquery account and API key

The portal is where you sign in and manage API keys. A nolainquery API key
authorizes the desktop to use the hosted service. Treat it like a password.

1. Open [nolainquery.com/login](https://nolainquery.com/login).
2. Choose **Continue with Google** and complete sign-in.
3. In **Account → API Keys**, optionally enter a label such as `Laptop`, then
   choose **Create key**.
4. Copy the new key immediately. The full value is shown only once; store it in
   a password manager.

The portal supports up to five active keys. If a key is lost, revoke it in
**Account → API Keys** and create a replacement.

## Connect the desktop

1. Open **Settings** in the desktop sidebar.
2. Paste the nolainquery key into **API Key**.
3. Choose **Save API Key**.

The desktop validates the key against the hosted service. Success is visible as
a status badge showing your account tier. The key is stored on this device and
sent only to authenticate requests.

## Enable BYOK (OpenRouter)

1. In **Settings**, open **Model inference**.
2. Choose **Bring your own key**.
3. Paste your OpenRouter API key.
4. Choose **Save inference settings**.

Your OpenRouter key is stored locally and sent as `X-LLM-Credential` on model
calls. It is never written to this repository or committed to git.

You still need the nolainquery API key. BYOK changes who pays for model
inference, not who may use the hosted generation service.

## Open a file and ask

1. Open **Home** and choose **Choose dataset**.
2. Select an Excel, CSV, or Parquet file. For Excel, pick the active table if
   several sheets were imported.
3. Open **Ask Queries**.
4. Enter a concrete question that uses columns in the file, for example:

   ```text
   What is the total revenue by country?
   ```

5. Choose **Ask**, or press `Ctrl+Enter` on Linux and Windows
   (`Command+Enter` on macOS).

During the request, the desktop reports stages such as **Analyzing data**,
**Thinking**, and **Executing**. A successful turn ends with an answer card and
calculation evidence in the adjacent workspace. Generated Pandas code is
available in **Code**.

The full file is not uploaded. The hosted service receives your question and a
compact file description containing schema and summary metadata; that description
can include sample values. Generated code returns to the desktop, which
computes the answer against the local file.

## Current product boundary

The implemented capability covers descriptive analysis of **one active table**
(from a CSV, Parquet file, or one sheet of an Excel workbook), including
aggregations, comparisons, rankings, historical trends, quality checks,
transformations, and optional charts. Cross-sheet joins within a workbook are
not supported yet. Forecasting, statistical inference, optimization, and
anomaly detection are currently unavailable.

Some schema-only questions, such as “What columns do I have?”, can be answered
from the file description without generating code. An unrelated question gets
a short refusal.

## If the first request does not complete

- Key rejected: see [API key recovery](./TROUBLESHOOTING.md#the-api-key-is-missing-or-rejected).
- Request refused: see [unsupported and out-of-scope requests](./TROUBLESHOOTING.md#the-request-is-unsupported-or-out-of-scope).
- Service or execution failure: see [service and runtime recovery](./TROUBLESHOOTING.md#the-desktop-cannot-reach-a-service).

Continue with [Desktop workflows](./DESKTOP_WORKFLOWS.md) and
[Excel and workbooks](./EXCEL_AND_WORKBOOKS.md).
