"""
Tile chart computations for the UI.

Each auditable unit lives on ``TileDataComputations`` as a named static method so
you can review or test computations in isolation without routing through HTTP.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel
from src.data_access import bounded_dataframe


class UnsupportedTileDataFormat(ValueError):
    """Raised when the file extension is not handled or parsing fails."""


class TileDataRequest(BaseModel):
    source_path: str
    column: str
    compareColumn: Optional[str] = None
    aggregation: Optional[str] = None
    graphType: Optional[str] = None
    distributionPct: Optional[int] = 100
    compareDistributionPct: Optional[int] = 100


class TileDataComputations:
    """One static method per computation step (audit surface)."""

    @staticmethod
    def load_dataframe(
        source_path: str,
        columns: Optional[List[str]] = None,
        max_rows: Optional[int] = None,
    ) -> pd.DataFrame:
        if max_rows is not None:
            try:
                return bounded_dataframe(source_path, columns, max_rows)
            except ValueError as exc:
                raise UnsupportedTileDataFormat("Unsupported file format") from exc
        if source_path.endswith(".csv"):
            return pd.read_csv(source_path, usecols=columns)
        if source_path.endswith(".parquet"):
            return pd.read_parquet(source_path, columns=columns)
        try:
            return pd.read_excel(source_path, usecols=columns)
        except Exception as exc:
            raise UnsupportedTileDataFormat("Unsupported file format") from exc

    @staticmethod
    def resolve_groupby(
        df: pd.DataFrame, column: str, compare_column: str
    ) -> Any:
        """
        Mirrors prior semantics: numeric compare + non-numeric primary → group by primary.
        """
        col_is_numeric = pd.api.types.is_numeric_dtype(df[column])
        cmp_is_numeric = pd.api.types.is_numeric_dtype(df[compare_column])
        if cmp_is_numeric and not col_is_numeric:
            return df.groupby(column)[compare_column]
        return df.groupby(compare_column)[column]

    @staticmethod
    def apply_aggregation(
        grouped: pd.core.groupby.generic.SeriesGroupBy, aggregation: str
    ) -> pd.Series:
        if aggregation == "sum":
            return grouped.sum()
        if aggregation == "mean":
            return grouped.mean()
        if aggregation == "count":
            return grouped.count()
        if aggregation == "nunique":
            return grouped.nunique()
        if aggregation == "std":
            return grouped.std()
        return grouped.count()

    @staticmethod
    def grouped_aggregation_to_payload(res: pd.Series) -> List[Dict[str, Any]]:
        result_data: List[Dict[str, Any]] = []
        for k, v in res.items():
            val = float(v) if pd.notnull(v) else 0.0
            if not math.isfinite(val):
                val = 0.0
            result_data.append({"compareKey": str(k), "value": val})
        return result_data

    @staticmethod
    def scatter_numeric_subset(
        df: pd.DataFrame, column: str, compare_column: str
    ) -> pd.DataFrame:
        return df[[compare_column, column]].apply(pd.to_numeric, errors="coerce").dropna()

    @staticmethod
    def scatter_trim_by_distribution(
        sub: pd.DataFrame,
        column: str,
        compare_column: str,
        distribution_pct: int,
        compare_distribution_pct: int,
    ) -> pd.DataFrame:
        x_full = sub[compare_column]
        y_full = sub[column]
        dist_x = max(1, min(100, compare_distribution_pct))
        dist_y = max(1, min(100, distribution_pct))
        mask = pd.Series(True, index=sub.index)
        if dist_x < 100:
            trim = (100 - dist_x) / 200.0
            x_lo = float(x_full.quantile(trim))
            x_hi = float(x_full.quantile(1.0 - trim))
            mask &= (x_full >= x_lo) & (x_full <= x_hi)
        if dist_y < 100:
            trim = (100 - dist_y) / 200.0
            y_lo = float(y_full.quantile(trim))
            y_hi = float(y_full.quantile(1.0 - trim))
            mask &= (y_full >= y_lo) & (y_full <= y_hi)
        return sub[mask]

    @staticmethod
    def scatter_sample_step(n_rows: int) -> int:
        if n_rows <= 10_000:
            return 1
        if n_rows <= 25_000:
            return 5
        if n_rows <= 100_000:
            return 20
        if n_rows <= 500_000:
            return 100
        return 500

    @staticmethod
    def scatter_points_payload(
        sampled: pd.DataFrame, column: str, compare_column: str
    ) -> List[Dict[str, float]]:
        x_series = sampled[compare_column]
        y_series = sampled[column]
        x_series = x_series.where(x_series.map(math.isfinite), 0)
        y_series = y_series.where(y_series.map(math.isfinite), 0)
        return [{"x": float(x), "y": float(y)} for x, y in zip(x_series, y_series)]

    @staticmethod
    def single_column_numeric_series(df: pd.DataFrame, column: str) -> pd.Series:
        return pd.to_numeric(df[column], errors="coerce").dropna()

    @staticmethod
    def single_column_categorical_top_payload(
        df: pd.DataFrame, column: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        vc = df[column].astype(str).value_counts()
        return [{"name": str(k), "value": int(v)} for k, v in vc.head(limit).items()]

    @staticmethod
    def trim_numeric_series_by_distribution(
        series: pd.Series, distribution_pct: int
    ) -> pd.Series:
        dist_pct = max(1, min(100, distribution_pct))
        if dist_pct >= 100:
            return series
        trim = (100 - dist_pct) / 200.0
        lo = float(series.quantile(trim))
        hi = float(series.quantile(1.0 - trim))
        return series[(series >= lo) & (series <= hi)]

    @staticmethod
    def single_column_bars_or_histogram_payload(series: pd.Series) -> List[Dict[str, Any]]:
        if series.nunique() <= 50:
            freq = series.value_counts().sort_index()
            return [{"name": str(v), "value": int(c)} for v, c in freq.items()]
        counts, bin_edges = np.histogram(series.to_numpy(), bins=20)
        return [
            {"name": f"{bin_edges[i]:.4g}–{bin_edges[i+1]:.4g}", "value": int(counts[i])}
            for i in range(len(counts))
        ]


def compute_tile_data(req: TileDataRequest) -> Dict[str, Any]:
    """
    Orchestrates tile computations by calling ``TileDataComputations`` methods in order.
    """
    T = TileDataComputations

    if req.aggregation and req.compareColumn and req.compareColumn != "none":
        df = T.load_dataframe(req.source_path, [req.column, req.compareColumn])
        grouped = T.resolve_groupby(df, req.column, req.compareColumn)
        res = T.apply_aggregation(grouped, req.aggregation or "")
        data = T.grouped_aggregation_to_payload(res)
        return {"status": "success", "data": data}

    if req.compareColumn and req.compareColumn != "none":
        # Scatter output is sampled already; bound the input before Pandas materialization.
        df = T.load_dataframe(
            req.source_path, [req.column, req.compareColumn], max_rows=100_000
        )
        sub = T.scatter_numeric_subset(df, req.column, req.compareColumn)
        if len(sub) == 0:
            return {"status": "success", "data": []}
        dist_x = req.compareDistributionPct or 100
        dist_y = req.distributionPct or 100
        sub = T.scatter_trim_by_distribution(
            sub, req.column, req.compareColumn, dist_y, dist_x
        )
        step = T.scatter_sample_step(len(sub))
        sampled = sub.iloc[::step]
        data = T.scatter_points_payload(sampled, req.column, req.compareColumn)
        return {"status": "success", "data": data}

    df = T.load_dataframe(req.source_path, [req.column])
    series = T.single_column_numeric_series(df, req.column)
    if len(series) == 0:
        data = T.single_column_categorical_top_payload(df, req.column)
        return {"status": "success", "data": data}

    series = T.trim_numeric_series_by_distribution(series, req.distributionPct or 100)
    data = T.single_column_bars_or_histogram_payload(series)
    return {"status": "success", "data": data}
