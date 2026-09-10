import csv
import os
import random
import pandas as pd
from typing import Dict, Any, List

def read_csv_rows(csv_path: str, num_rows: int = 200, encoding: str = 'utf-8') -> Dict[str, Any]:
    available_columns = []
    sample_data = []
    total_rows = 0
    with open(csv_path, 'r', encoding=encoding) as f:
        reader = csv.DictReader(f)
        available_columns = reader.fieldnames or []
        for i, row in enumerate(reader):
            total_rows = i + 1
            if i < num_rows:
                sample_data.append(row)
            else:
                j = random.randint(0, i)
                if j < num_rows:
                    sample_data[j] = row
                    
    converted_sample_data = []
    for row in sample_data:
        converted_sample_data.append({k: _convert_value(v) for k, v in row.items()})
        
    return {"available_columns": list(available_columns), "sample_data": converted_sample_data, "total_rows_read": total_rows}

def _convert_value(value: str) -> Any:
    import math
    if not value or str(value).lower() in ["nan", "null", "none", "na", "", "n/a"]: return None
    try: return int(value)
    except: pass
    try: 
        val = float(value)
        if not math.isfinite(val):
            return None
        return val
    except: return value

def _infer_column_semantics(columns: List[str], sample_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not sample_data: return {col: {"data_type": "unknown", "semantic_type": "categorical"} for col in columns}
    df = pd.DataFrame(sample_data)
    for col in columns:
        if col not in df.columns: df[col] = None
    return _infer_column_semantics_from_df(columns, df)

def _infer_column_semantics_from_df(
    columns: List[str],
    df: pd.DataFrame,
    identifier_cardinality_max: int | None = None,
) -> Dict[str, Any]:
    import math
    if identifier_cardinality_max is None:
        try:
            from src.workbook.config import get_ingest_config

            identifier_cardinality_max = get_ingest_config().identifier_cardinality_max
        except Exception:
            identifier_cardinality_max = 20
    for col in columns:
        if col not in df.columns: df[col] = None
    semantics = {}
    for col in columns:
        series = df[col]
        col_info = {}
        
        # Ensure null_ratio is a valid float
        n_total = len(series)
        n_null = int(series.isna().sum())
        ratio = float(n_null / n_total) if n_total > 0 else 0.0
        col_info["null_ratio"] = ratio if math.isfinite(ratio) else 0.0
        
        non_null = series.dropna()
        col_info["cardinality"] = int(non_null.nunique())
        
        # Sanitize sample values
        vals = []
        for v in non_null.unique()[:5]:
            # Convert numpy types to python types
            val = v.item() if hasattr(v, 'item') else v
            # Ensure it's JSON compliant if it's a float
            if isinstance(val, (float, complex)):
                if not math.isfinite(val.real):
                    val = None
            vals.append(val)
        col_info["sample_values"] = vals
        
        raw_dtype = series.dtype
        inferred_type = "string"
        if pd.api.types.is_numeric_dtype(raw_dtype):
            inferred_type = "int" if pd.api.types.is_integer_dtype(raw_dtype) else "float"
        elif pd.api.types.is_datetime64_any_dtype(raw_dtype): inferred_type = "date"
        col_info["data_type"] = inferred_type
        
        # Determine semantic_type
        semantic_type = "categorical"
        if inferred_type in ["int", "float"]:
            semantic_type = "numeric"
        
        if inferred_type == "date" or "date" in str(raw_dtype).lower() or "time" in str(raw_dtype).lower():
            semantic_type = "temporal"
            
        if col_info["cardinality"] == len(non_null) and len(non_null) > 0 and inferred_type in ["int", "string"]: # Almost all unique
            # if almost all unique, it might be an identifier
            semantic_type = "identifier"
        elif inferred_type == "int" and col_info["cardinality"] < identifier_cardinality_max:
            # Low cardinality integers might be categorical
            semantic_type = "categorical"
            
        col_info["semantic_type"] = semantic_type
        semantics[col] = col_info
    return semantics
