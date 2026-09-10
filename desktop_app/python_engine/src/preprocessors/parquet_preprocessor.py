import os
from pathlib import Path
from typing import Dict, Any, List
from .base import BasePreprocessor
from src.data_access import collect_lazy, lazy_frame, lazy_row_count, polars_to_pandas

class ParquetPreprocessor(BasePreprocessor):
    """
    Parquet Preprocessor implementation.
    Handles existing Parquet files.
    """
    
    def __init__(self, parquet_path: str, data_folder: str = None):
        self.parquet_path = parquet_path
        self.data_folder = data_folder or os.path.dirname(parquet_path)
        
        if not os.path.exists(parquet_path):
            raise FileNotFoundError(f"Parquet file not found: {parquet_path}")
            
        self.filename_stem = Path(parquet_path).stem
        
    def process_to_parquet(self, output_dir: str = None) -> List[str]:
        """
        No-op for Parquet files, just returns the existing path.
        """
        return [self.parquet_path]
        
    def get_context_metadata(self, num_rows: int = 10) -> Dict[str, Any]:
        """
        Infer schema and semantics from a bounded Parquet sample.
        """
        inference_rows = max(num_rows, 1_000)
        sample_df = collect_lazy(
            lazy_frame(self.parquet_path).head(inference_rows)
        )
        available_columns = sample_df.columns
        # Sanitize for JSON compliance (handle NaN and Inf)
        import math
        sample_data = []
        for row in sample_df.head(num_rows).to_dicts():
            clean_row = {}
            for k, v in row.items():
                if isinstance(v, float) and not math.isfinite(v):
                    clean_row[k] = None
                else:
                    clean_row[k] = v
            sample_data.append(clean_row)
        
        # Reuse the existing semantic classifier on the bounded sample only.
        from .csv_preprocessor_legacy_helpers import _infer_column_semantics_from_df
        column_semantics = _infer_column_semantics_from_df(
            available_columns, polars_to_pandas(sample_df)
        )
        
        return {
            "available_columns": available_columns,
            "sample_data": sample_data,
            "column_semantics": column_semantics,
            "total_rows": lazy_row_count(self.parquet_path),
        }
