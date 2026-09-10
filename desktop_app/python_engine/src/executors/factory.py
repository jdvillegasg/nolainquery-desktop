from .. import paths  # noqa: F401 — ensures shared `query_operations` is on sys.path

from .base import BaseGraphExecutor

def get_executor(engine: str, source_data: str) -> BaseGraphExecutor:
    """
    Get the appropriate GraphExecutor for a given analytical engine.
    
    Args:
        engine: 'pandas', 'polars', or 'duckdb'
        source_data: The path to the parquet file (for polars/duckdb) or DataFrame (for legacy pandas)
    """
    if engine.lower() == 'pandas':
        from .pandas.executor import GraphExecutor as PandasExecutor
        return PandasExecutor(source_data)
        
    elif engine.lower() == 'polars':
        from .polars.executor import GraphExecutor as PolarsExecutor
        return PolarsExecutor(source_data)
        
    else:
        raise ValueError(f"Unsupported execution engine: {engine}")
        
def get_operations_registry(engine: str) -> dict:
    """
    Return the canonical operation registry (shared across engines).

    The *engine* argument is reserved for future per-engine registry overrides.
    """
    from query_operations import OPERATION_REGISTRY

    el = engine.lower()
    if el in ("pandas", "polars"):
        return OPERATION_REGISTRY
    raise ValueError(f"Unsupported execution engine: {engine}")
