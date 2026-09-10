# Security policy

## Supported versions

Security fixes are applied to the latest release on the default branch of this
repository.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Instead, use [GitHub Security Advisories](https://github.com/jdvillegasg/nolainquery-desktop/security/advisories/new)
for this repository, or email the maintainer through the contact form at
[https://nolainquery.com/contact](https://nolainquery.com/contact).

Include:

- a short description of the issue
- steps to reproduce
- affected version or commit, if known
- impact assessment, if known

Please do **not** include API keys, OpenRouter keys, customer data, or full
local files in the report.

## Scope

This repository contains the **desktop client** and the **local Python execution
engine** only. Vulnerabilities in the hosted Cloud API, portal, billing, or
operator infrastructure should be reported through the same private channel and
will be routed to the appropriate team.

## Secrets in bug reports

Never paste:

- your nolainquery API key
- your OpenRouter API key
- `.env` contents
- screenshots that show saved keys in Settings

Redact keys before sharing logs or HAR files.
