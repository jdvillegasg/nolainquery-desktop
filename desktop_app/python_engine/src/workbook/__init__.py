"""Workbook ingest: Excel/CSV/Parquet → table catalog with materialized Parquet tables."""

from .config import SourceKind, TableRole, WorkbookIngestConfig
from .ingest import WorkbookIngestError, open_workbook
from .models import WorkbookCatalog, WorkbookTable

__all__ = [
    "SourceKind",
    "TableRole",
    "WorkbookCatalog",
    "WorkbookIngestConfig",
    "WorkbookIngestError",
    "WorkbookTable",
    "open_workbook",
]
