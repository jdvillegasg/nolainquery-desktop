"""
Executive KPI / insights computations for the dashboard.

Each auditable unit lives on ``InsightsDataComputations`` as a named static method
so you can review or test computations in isolation without routing through HTTP.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from src.data_access import bounded_dataframe
from src.workbook.config import get_ingest_config


class UnsupportedInsightsDataFormat(ValueError):
    """Raised when the file extension is not handled or parsing fails."""


class InsightsDataComputations:
    """One static method per computation step (audit surface)."""

    @staticmethod
    def load_dataframe(source_path: str) -> pd.DataFrame:
        try:
            return bounded_dataframe(source_path, max_rows=get_ingest_config().preview_row_cap)
        except Exception as exc:
            raise UnsupportedInsightsDataFormat("Unsupported file format") from exc

    @staticmethod
    def total_rows(df: pd.DataFrame) -> int:
        return int(len(df))

    @staticmethod
    def total_columns(df: pd.DataFrame) -> int:
        return int(len(df.columns))

    @staticmethod
    def missing_cells_count(df: pd.DataFrame) -> int:
        return int(df.isnull().sum().sum())

    @staticmethod
    def completeness_pct(total_rows: int, total_cols: int, missing_cells: int) -> float:
        total_cells = total_rows * total_cols
        if total_cells <= 0:
            return 100.0
        return round((1 - missing_cells / total_cells) * 100, 1)

    @staticmethod
    def duplicate_rows_count(df: pd.DataFrame) -> int:
        return int(df.duplicated().sum())

    @staticmethod
    def duplicate_pct(total_rows: int, duplicate_rows: int) -> float:
        if total_rows <= 0:
            return 0.0
        return round(duplicate_rows / total_rows * 100, 1)

    @staticmethod
    def numeric_and_categorical_column_names(df: pd.DataFrame) -> Tuple[List[str], List[str]]:
        num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        cat_cols = [c for c in df.columns if c not in num_cols]
        return num_cols, cat_cols

    @staticmethod
    def avg_cardinality_ratio_pct(
        df: pd.DataFrame, cat_cols: List[str], total_rows: int
    ) -> float:
        if not cat_cols or total_rows <= 0:
            return 0.0
        ratios = [df[c].nunique() / total_rows for c in cat_cols]
        return round(float(np.mean(ratios)) * 100, 1)

    @staticmethod
    def avg_abs_skew_numeric(df: pd.DataFrame, num_cols: List[str]) -> float:
        if not num_cols:
            return 0.0
        skews: List[float] = []
        for c in num_cols:
            try:
                s = float(df[c].dropna().skew())
                if math.isfinite(s):
                    skews.append(abs(s))
            except Exception:
                pass
        return round(float(np.mean(skews)), 2) if skews else 0.0

    @staticmethod
    def high_missing_column_count(df: pd.DataFrame, threshold: float = 0.2) -> int:
        return int((df.isnull().mean() > threshold).sum())

    @staticmethod
    def numeric_column_ratio_pct(num_numeric: int, total_cols: int) -> float:
        if total_cols <= 0:
            return 0.0
        return round(num_numeric / total_cols * 100, 1)


def compute_insights_data(source_path: str) -> Dict[str, Any]:
    """
    Orchestrates insights by calling ``InsightsDataComputations`` methods in order.
    """
    I = InsightsDataComputations
    df = I.load_dataframe(source_path)

    sample_rows = I.total_rows(df)
    total_rows = int(df.attrs.get("source_total_rows", sample_rows))
    total_cols = I.total_columns(df)
    sample_missing_cells = I.missing_cells_count(df)
    missing_cells = (
        round(sample_missing_cells * total_rows / sample_rows)
        if sample_rows and sample_rows != total_rows
        else sample_missing_cells
    )
    completeness_pct = I.completeness_pct(total_rows, total_cols, missing_cells)

    sample_duplicate_rows = I.duplicate_rows_count(df)
    duplicate_rows = (
        round(sample_duplicate_rows * total_rows / sample_rows)
        if sample_rows and sample_rows != total_rows
        else sample_duplicate_rows
    )
    duplicate_pct = I.duplicate_pct(total_rows, duplicate_rows)

    num_cols, cat_cols = I.numeric_and_categorical_column_names(df)
    avg_cardinality_ratio = I.avg_cardinality_ratio_pct(df, cat_cols, sample_rows)
    avg_skew = I.avg_abs_skew_numeric(df, num_cols)
    high_missing_cols = I.high_missing_column_count(df)
    numeric_ratio = I.numeric_column_ratio_pct(len(num_cols), total_cols)

    return {
        "status": "success",
        "insights": {
            "total_rows": total_rows,
            "total_cols": total_cols,
            "completeness_pct": completeness_pct,
            "missing_cells": missing_cells,
            "duplicate_rows": duplicate_rows,
            "duplicate_pct": duplicate_pct,
            "num_numeric_cols": len(num_cols),
            "num_categorical_cols": len(cat_cols),
            "avg_cardinality_ratio": avg_cardinality_ratio,
            "avg_skew": avg_skew,
            "high_missing_cols": high_missing_cols,
            "numeric_ratio": numeric_ratio,
        },
    }
