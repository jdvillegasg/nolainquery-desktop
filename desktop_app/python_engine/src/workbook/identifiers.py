"""Stable identifiers for workbook tables and cache entries."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path


def slugify(value: str, fallback: str = "table") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def unique_table_id(sheet_name: str, used: set[str]) -> str:
    base = slugify(sheet_name, fallback="sheet")
    candidate = base
    index = 2
    while candidate in used:
        candidate = f"{base}-{index}"
        index += 1
    used.add(candidate)
    return candidate


def source_fingerprint(source_path: str) -> str:
    normalized = os.path.abspath(source_path)
    stat = os.stat(normalized)
    digest = hashlib.sha256(
        f"{normalized}:{stat.st_mtime_ns}:{stat.st_size}".encode("utf-8")
    ).hexdigest()
    return digest[:32]


def materialized_filename(table_id: str, extension: str) -> str:
    ext = extension if extension.startswith(".") else f".{extension}"
    return f"{slugify(table_id, fallback='table')}{ext}"
