import os
from pathlib import Path
from typing import Dict, Any, List
from ..data_access import scan_csv_lazy
from .base import BasePreprocessor
from . import csv_preprocessor_legacy_helpers as helpers

class CSVPreprocessor(BasePreprocessor):
    """
    CSV Preprocessor implementation.
    Streams CSV files out to Parquet without loading entirely into memory.
    """
    
    def __init__(self, csv_path: str, data_folder: str = None):
        self.csv_path = csv_path
        self.data_folder = data_folder or os.path.dirname(csv_path)
        
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"CSV file not found: {csv_path}")
            
        self.filename_stem = Path(csv_path).stem
        
    def process_to_parquet(self, output_dir: str = None) -> List[str]:
        """
        Stream CSV to Parquet using Polars.
        """
        output_dir = output_dir or self.data_folder
        os.makedirs(output_dir, exist_ok=True)
        
        out_file = os.path.join(output_dir, f"{self.filename_stem}.parquet")
        
        # Use Polars to copy directly from CSV to Parquet without memory overhead
        scan_csv_lazy(self.csv_path).sink_parquet(out_file)
        
        return [out_file]
        
    def get_context_metadata(self, num_rows: int = 10) -> Dict[str, Any]:
        """
        Infer metadata from a bounded reservoir sample.
        """
        inference_rows = max(num_rows, 1_000)
        data = helpers.read_csv_rows(self.csv_path, inference_rows)
        column_semantics = helpers._infer_column_semantics(
            data["available_columns"], data["sample_data"]
        )
        
        return {
            "available_columns": data["available_columns"],
            "sample_data": data["sample_data"][:num_rows],
            "column_semantics": column_semantics
        }
