"""Cache directory management for materialized workbook tables."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from .config import DEFAULT_INGEST_CONFIG, SourceKind, TableRole
from .identifiers import source_fingerprint
from .models import WorkbookCatalog, WorkbookTable


def cache_root() -> Path:
    configured = os.getenv("NOLAIN_WORKBOOK_CACHE_DIR", "").strip()
    if configured:
        root = Path(configured)
    else:
        root = Path.home() / ".cache" / "nolainquery" / "workbooks"
    root.mkdir(parents=True, exist_ok=True)
    return root


def catalog_cache_dir(source_path: str) -> Path:
    directory = cache_root() / source_fingerprint(source_path)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def catalog_manifest_path(source_path: str) -> Path:
    return catalog_cache_dir(source_path) / "catalog.json"


def load_cached_catalog(source_path: str) -> Optional[WorkbookCatalog]:
    manifest = catalog_manifest_path(source_path)
    if not manifest.is_file():
        return None
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("ingest_version") != DEFAULT_INGEST_CONFIG.ingest_version:
        return None
    if payload.get("source_path") != os.path.abspath(source_path):
        return None
    tables = [
        WorkbookTable(
            id=entry["id"],
            sheet_name=entry["sheet_name"],
            role=TableRole(entry["role"]),
            materialized_path=entry.get("materialized_path"),
            row_count=entry.get("row_count"),
            column_count=entry.get("column_count"),
            skip_reason=entry.get("skip_reason"),
            header_row=entry.get("header_row"),
        )
        for entry in payload.get("tables", [])
    ]
    return WorkbookCatalog(
        source_path=payload["source_path"],
        source_kind=SourceKind(payload["source_kind"]),
        source_name=payload["source_name"],
        active_table_id=payload["active_table_id"],
        tables=tables,
        cache_dir=payload.get("cache_dir"),
        ingest_version=payload.get("ingest_version", DEFAULT_INGEST_CONFIG.ingest_version),
    )


def save_catalog(catalog: WorkbookCatalog) -> None:
    manifest = catalog_manifest_path(catalog.source_path)
    manifest.write_text(
        json.dumps(catalog.to_dict(), indent=2),
        encoding="utf-8",
    )


def catalog_is_valid(catalog: WorkbookCatalog) -> bool:
    for table in catalog.importable_tables:
        path = table.materialized_path
        if not path or not os.path.isfile(path):
            return False
    return bool(catalog.importable_tables)
