"""Structured workbook catalog models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .config import SourceKind, TableRole


@dataclass(frozen=True)
class WorkbookTable:
    id: str
    sheet_name: str
    role: TableRole
    materialized_path: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    skip_reason: Optional[str] = None
    header_row: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "sheet_name": self.sheet_name,
            "role": self.role.value,
        }
        if self.materialized_path is not None:
            payload["materialized_path"] = self.materialized_path
        if self.row_count is not None:
            payload["row_count"] = self.row_count
        if self.column_count is not None:
            payload["column_count"] = self.column_count
        if self.skip_reason is not None:
            payload["skip_reason"] = self.skip_reason
        if self.header_row is not None:
            payload["header_row"] = self.header_row
        return payload


@dataclass
class WorkbookCatalog:
    source_path: str
    source_kind: SourceKind
    source_name: str
    active_table_id: str
    tables: List[WorkbookTable] = field(default_factory=list)
    cache_dir: Optional[str] = None
    ingest_version: str = "1"

    @property
    def importable_tables(self) -> List[WorkbookTable]:
        return [table for table in self.tables if table.role == TableRole.TABLE]

    @property
    def skipped_tables(self) -> List[WorkbookTable]:
        return [table for table in self.tables if table.role != TableRole.TABLE]

    def active_table(self) -> WorkbookTable:
        for table in self.tables:
            if table.id == self.active_table_id:
                return table
        raise KeyError(f"Active table not found: {self.active_table_id}")

    def active_materialized_path(self) -> str:
        table = self.active_table()
        if not table.materialized_path:
            raise ValueError(f"Active table {table.id} has no materialized path")
        return table.materialized_path

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_path": self.source_path,
            "source_kind": self.source_kind.value,
            "source_name": self.source_name,
            "active_table_id": self.active_table_id,
            "tables": [table.to_dict() for table in self.tables],
            "cache_dir": self.cache_dir,
            "ingest_version": self.ingest_version,
        }

    def cloud_workbook_metadata(self) -> Optional[Dict[str, Any]]:
        """Compact workbook context for Cloud API metadata (table-scoped v1)."""
        if self.source_kind != SourceKind.EXCEL:
            return None
        active = self.active_table()
        other_tables = [
            table.sheet_name
            for table in self.importable_tables
            if table.id != self.active_table_id
        ]
        skipped_sheets = [
            {"name": table.sheet_name, "reason": table.skip_reason or "skipped"}
            for table in self.skipped_tables
        ]
        return {
            "name": self.source_name,
            "table_count": len(self.importable_tables),
            "active_table": active.sheet_name,
            "other_tables": other_tables,
            "skipped_sheets": skipped_sheets,
        }
