import os
from pathlib import Path
from typing import Dict, Any, List
import pandas as pd
from .base import BasePreprocessor
from . import csv_preprocessor_legacy_helpers


class ExcelPreprocessor(BasePreprocessor):
    """
    Excel Preprocessor implementation.
    Sketch metadata comes from the workbook ingest catalog's active table.
    """

    def __init__(self, excel_path: str, data_folder: str = None):
        self.excel_path = excel_path
        self.data_folder = data_folder or os.path.dirname(excel_path)

        if not os.path.exists(excel_path):
            raise FileNotFoundError(f"Excel file not found: {excel_path}")

        self.filename_stem = Path(excel_path).stem
        self.excel_file = pd.ExcelFile(excel_path)
        self.sheet_names = self.excel_file.sheet_names

    def process_to_parquet(self, output_dir: str = None) -> List[str]:
        """
        Process Excel to Parquet by using duckdb spatial extension to stream excel.
        """
        output_dir = output_dir or self.data_folder

        if len(self.sheet_names) > 1:
            output_dir = os.path.join(output_dir, self.filename_stem)

        os.makedirs(output_dir, exist_ok=True)

        out_files = []

        for sheet in self.sheet_names:
            out_file = os.path.join(output_dir, f"{sheet}.parquet" if len(self.sheet_names) > 1 else f"{self.filename_stem}.parquet")
            df = pd.read_excel(self.excel_path, sheet_name=sheet)
            df.to_parquet(out_file, index=False)
            out_files.append(out_file)

        return out_files

    def get_context_metadata(self, num_rows: int = 10) -> Dict[str, Any]:
        """Sketch the active ingested table (same path as Ask Queries)."""
        from src.workbook.config import get_ingest_config
        from src.workbook.ingest import open_workbook

        config = get_ingest_config()
        catalog = open_workbook(self.excel_path, config=config)
        active = catalog.active_table()
        path = catalog.active_materialized_path()
        inference_rows = max(num_rows, 1_000)
        df = pd.read_parquet(path)
        infer_df = df.head(inference_rows)
        sample_df = infer_df.head(num_rows)
        import math
        sample_data = []
        for row in sample_df.to_dict(orient="records"):
            clean_row = {}
            for k, v in row.items():
                if isinstance(v, float) and not math.isfinite(v):
                    clean_row[k] = None
                else:
                    clean_row[k] = v
            sample_data.append(clean_row)
        columns = list(sample_df.columns)
        column_semantics = csv_preprocessor_legacy_helpers._infer_column_semantics_from_df(
            columns,
            infer_df,
            identifier_cardinality_max=config.identifier_cardinality_max,
        )
        payload: Dict[str, Any] = {
            "available_columns": columns,
            "sample_data": sample_data,
            "column_semantics": column_semantics,
            "total_rows": int(active.row_count or len(df)),
        }
        workbook = catalog.cloud_workbook_metadata()
        if workbook:
            payload["workbook"] = workbook
            payload["workbook"]["active_table_rows"] = int(active.row_count or len(df))
        return payload
