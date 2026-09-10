"""Central configuration for workbook ingest and table detection."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict


class SourceKind(str, Enum):
    CSV = "csv"
    PARQUET = "parquet"
    EXCEL = "excel"


class TableRole(str, Enum):
    TABLE = "table"
    SKIPPED = "skipped"
    UNSTRUCTURED = "unstructured"


class SkipReason(str, Enum):
    SPARSE_NON_TABLE = "sparse_non_table"
    TOO_FEW_ROWS = "too_few_rows"
    TOO_FEW_COLUMNS = "too_few_columns"
    LOW_HEADER_CONFIDENCE = "low_header_confidence"
    EMPTY_SHEET = "empty_sheet"
    HIDDEN_SHEET = "hidden_sheet"
    READ_ERROR = "read_error"
    FORCED_EXCLUDE = "forced_exclude"


_CONFIG_PATH = Path(__file__).with_name("workbook.yaml")


@dataclass(frozen=True)
class WorkbookIngestConfig:
    """Thresholds and limits for workbook ingest.

    Defaults load from ``workbook.yaml``. Override the file with
    ``NOLAIN_WORKBOOK_CONFIG`` or individual keys with
    ``NOLAIN_WORKBOOK_<FIELD>`` (for example ``NOLAIN_WORKBOOK_HEADER_SAMPLE_FLOOR=80``).
    Cache directory is ``NOLAIN_WORKBOOK_CACHE_DIR``.
    """

    min_data_rows: int = 2
    min_columns: int = 2
    min_fill_density: float = 0.15
    max_unnamed_column_ratio: float = 0.6
    min_header_confidence: float = 0.4
    header_scan_rows: int = 20
    header_sample_padding: int = 5
    header_sample_floor: int = 40
    header_consistency_rows: int = 5
    include_hidden_sheets: bool = False
    materialized_format: str = "parquet"
    ingest_version: str = "4"
    default_active_table: str = "largest"
    preview_row_cap: int = 100_000
    identifier_cardinality_max: int = 20

    def header_sample_rows(self) -> int:
        return max(
            self.header_scan_rows + self.min_data_rows + self.header_sample_padding,
            self.header_sample_floor,
        )


def _coerce(field: str, value: Any) -> Any:
    sample = getattr(WorkbookIngestConfig(), field)
    if isinstance(sample, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(sample, int) and not isinstance(sample, bool):
        return int(value)
    if isinstance(sample, float):
        return float(value)
    return str(value)


def _load_yaml(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        import yaml
    except ImportError:
        raw: Dict[str, Any] = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or ":" not in stripped:
                continue
            key, rest = stripped.split(":", 1)
            raw[key.strip()] = rest.strip().strip('"').strip("'")
        return raw
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"{path}: root must be a mapping")
    return loaded


def _load_workbook_config() -> WorkbookIngestConfig:
    path = Path(os.environ.get("NOLAIN_WORKBOOK_CONFIG") or _CONFIG_PATH)
    raw = _load_yaml(path)
    values: Dict[str, Any] = {}
    for field in WorkbookIngestConfig.__dataclass_fields__:
        env_key = f"NOLAIN_WORKBOOK_{field.upper()}"
        if env_key in os.environ:
            values[field] = _coerce(field, os.environ[env_key])
        elif field in raw:
            values[field] = _coerce(field, raw[field])
    config = WorkbookIngestConfig(**values)
    if config.default_active_table not in {"largest", "first_visible"}:
        raise ValueError("default_active_table must be 'largest' or 'first_visible'")
    if config.header_sample_floor < 1 or config.header_consistency_rows < 1:
        raise ValueError("header_sample_floor and header_consistency_rows must be >= 1")
    if config.preview_row_cap < 1 or config.identifier_cardinality_max < 1:
        raise ValueError("preview_row_cap and identifier_cardinality_max must be >= 1")
    return config


@lru_cache(maxsize=1)
def get_ingest_config() -> WorkbookIngestConfig:
    return _load_workbook_config()


DEFAULT_INGEST_CONFIG = get_ingest_config()

SUPPORTED_SOURCE_EXTENSIONS = {
    SourceKind.CSV: {".csv"},
    SourceKind.PARQUET: {".parquet"},
    SourceKind.EXCEL: {".xlsx", ".xls"},
}

ALL_SOURCE_EXTENSIONS = frozenset(
    ext for extensions in SUPPORTED_SOURCE_EXTENSIONS.values() for ext in extensions
)
