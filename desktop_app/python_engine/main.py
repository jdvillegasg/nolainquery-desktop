"""
Local Executor API (Sidecar for Tauri UI)
Receives ComputationGraph JSONs from the frontend and executes them.
"""
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from functools import lru_cache
import logging
import os
import uvicorn
import pandas as pd
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional

from src import paths  # noqa: F401 — ensures shared packages are on sys.path
from src.executors.factory import get_executor
from src.schema import ComputationGraph

app = FastAPI(title="Nolain Data Query - Local Executor")
SIDECAR_TOKEN = os.getenv("NOLAIN_SIDECAR_TOKEN", "").strip()


@app.middleware("http")
async def require_sidecar_token(request: Request, call_next):
    if SIDECAR_TOKEN and request.headers.get("X-Nolain-Sidecar-Token") != SIDECAR_TOKEN:
        return JSONResponse(status_code=401, content={"detail": "Invalid sidecar token."})
    return await call_next(request)


class TransformationExportRequest(BaseModel):
    """Trusted desktop export request; generated code remains sandboxed."""
    code: str
    source_path: str
    destination_path: str


class OpenWorkbookRequest(BaseModel):
    source_path: str
    active_table_id: Optional[str] = None
    active_sheet_name: Optional[str] = None
    force_include_sheets: Optional[List[str]] = None

# Allow requests from the Tauri frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "NOLAIN_SIDECAR_ORIGINS",
            "http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,https://tauri.localhost,http://tauri.localhost",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/execute_dag")
def execute_dag(
    graph: ComputationGraph,
    engine: str = "polars",
    source_path: str = "",
    full_export: bool = False,
):
    """
    Executes a ComputationGraph on the local desktop machine.
    """
    from query_execution.notebook_session import result_row_metadata, serialize_result

    if not source_path or not os.path.exists(source_path):
         raise HTTPException(status_code=400, detail="Invalid source data path")
         
    try:
        if engine == "pandas":
             df = pd.read_csv(source_path) if source_path.endswith('.csv') else pd.read_parquet(source_path)
             executor = get_executor("pandas", df)
        else:
             executor = get_executor("polars", source_path)
             
        result = executor.execute(graph)
        return {
            "status": "success",
            "result": serialize_result(result, full_export=full_export),
            **result_row_metadata(result, full_export=full_export),
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/execute_pandas")
def execute_pandas(
    code: str = Form(...),
    source_path: str = Form(...),
    session_id: str = Form(None),
    reset_session: bool = Form(False),
    full_export: bool = Form(False),
):
    """
    Executes raw Pandas code safely on the local machine.
    Supports notebook-style sessions so variables persist between cell runs.
    """
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Invalid source data path")
    
    from query_execution import SecurityError, ExecutionError, notebook_sessions
    
    try:
        _, payload = notebook_sessions.execute(
            code=code,
            source_path=source_path,
            session_id=session_id,
            reset_session=reset_session,
            full_export=full_export,
        )
        return {"status": "success", **payload}
        
    except SecurityError as e:
        raise HTTPException(status_code=403, detail=f"Security Violation: {str(e)}")
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=f"Execution Error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected Error: {str(e)}")


@app.post("/export_transformation")
def export_transformation(request: TransformationExportRequest):
    """Run safe transformation code and write its DataFrame result to a new file."""
    if not request.source_path or not os.path.exists(request.source_path):
        raise HTTPException(status_code=400, detail="Invalid source data path")
    if not request.destination_path:
        raise HTTPException(status_code=400, detail="A destination path is required")
    try:
        from query_execution import SafePandasExecutor, SecurityError, ExecutionError

        executor = SafePandasExecutor(request.source_path)
        namespace = executor.create_namespace()
        executor.execute_in_namespace(request.code, namespace)
        result = namespace.get("result")
        if not isinstance(result, pd.DataFrame):
            raise HTTPException(
                status_code=400,
                detail="The transformation did not produce a tabular dataset to export.",
            )

        destination = os.path.abspath(request.destination_path)
        source = os.path.abspath(request.source_path)
        if source == destination:
            raise HTTPException(status_code=400, detail="The transformed copy cannot overwrite the source file.")
        if os.path.dirname(source) != os.path.dirname(destination):
            raise HTTPException(
                status_code=403,
                detail="Exports must remain in the source file's directory.",
            )
        suffix = os.path.splitext(destination)[1].lower()
        if suffix == ".csv":
            result.to_csv(destination, index=False)
        elif suffix == ".parquet":
            result.to_parquet(destination, index=False)
        elif suffix in (".xlsx", ".xls"):
            result.to_excel(destination, index=False)
        else:
            raise HTTPException(status_code=400, detail="Use a CSV, Parquet, or Excel destination.")
        return {
            "status": "success",
            "rows": int(len(result)),
            "columns": [str(column) for column in result.columns],
            "destination_path": destination,
        }
    except HTTPException:
        raise
    except SecurityError as e:
        raise HTTPException(status_code=403, detail=f"Security Violation: {str(e)}")
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=f"Execution Error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected Error: {str(e)}")

@app.get("/")
def index():
    return {
        "app": "Nolain Data Query - Local Executor",
        "description": "Backend engine for local computation graph execution.",
        "status": "ready",
        "documentation": "/docs"
    }

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/open_workbook")
def open_workbook_endpoint(request: OpenWorkbookRequest):
    """Ingest a workbook (Excel, CSV, or Parquet) and return a table catalog."""
    from src.workbook import WorkbookIngestError, open_workbook

    if not request.source_path:
        raise HTTPException(status_code=400, detail="source_path is required")
    try:
        catalog = open_workbook(
            request.source_path,
            active_table_id=request.active_table_id,
            active_sheet_name=request.active_sheet_name,
            force_include_sheets=request.force_include_sheets,
        )
        return {"status": "success", "catalog": catalog.to_dict()}
    except WorkbookIngestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logging.exception("open_workbook failed for %s", request.source_path)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/workbook_catalog")
def get_workbook_catalog(source_path: str, active_table_id: Optional[str] = None):
    """Return a cached workbook catalog, re-ingesting when stale."""
    from src.workbook import WorkbookIngestError, open_workbook

    if not source_path:
        raise HTTPException(status_code=400, detail="source_path is required")
    try:
        catalog = open_workbook(
            source_path,
            active_table_id=active_table_id,
            use_cache=True,
        )
        return {"status": "success", "catalog": catalog.to_dict()}
    except WorkbookIngestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/sandbox/environment")
def sandbox_environment():
    """Return preloaded modules, allowed imports, and sandbox rules for the code editor."""
    from query_execution.sandbox_environment import sandbox_environment_spec

    return {"status": "success", "environment": sandbox_environment_spec()}

from src.tile_data import (
    TileDataRequest,
    UnsupportedTileDataFormat,
    compute_tile_data,
)
from src.insights_data import (
    UnsupportedInsightsDataFormat,
    compute_insights_data,
)
from src.data_access import (
    excel_distinct_values,
    excel_preview_page,
    lazy_distinct_values,
    lazy_preview_page,
)

@app.post("/tile_data")
def get_tile_data(req: TileDataRequest):
    """
    Computes exact aggregations over the full dataset for a UI Tile.
    Delegates to ``src.tile_data.compute_tile_data`` and ``TileDataComputations``.
    """
    if not req.source_path or not os.path.exists(req.source_path):
         raise HTTPException(status_code=400, detail="Invalid source data path")
    try:
        return compute_tile_data(req)
    except UnsupportedTileDataFormat as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@lru_cache(maxsize=32)
def _cached_data_summary(source_path: str, source_mtime_ns: int):
    from src.preprocessors.factory import PreprocessorFactory

    preprocessor = PreprocessorFactory.get_preprocessor(source_path)
    return preprocessor.get_context_metadata()


@app.get("/data_summary")
def get_data_summary(source_path: str):
    """
    Returns the columns and their semantic types for the dashboard crafter.
    """
    if not source_path or not os.path.exists(source_path):
         raise HTTPException(status_code=400, detail="Invalid source data path")
         
    try:
        normalized_path = os.path.abspath(source_path)
        metadata = _cached_data_summary(
            normalized_path, os.stat(normalized_path).st_mtime_ns
        )
        return {"status": "success", "summary": metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/preview_data")
def get_preview_data(source_path: str, page: int = 0, page_size: int = 200):
    """
    Returns a paginated slice of the raw dataset for the spreadsheet viewer.
    For CSV files >100k rows, returns a uniform sample instead of pure pagination
    so the user can still see representative data.
    """
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Invalid source data path")
    try:
        if page < 0 or page_size < 1 or page_size > 1_000:
            raise HTTPException(
                status_code=400,
                detail="page must be >= 0 and page_size must be between 1 and 1000",
            )
        suffix = os.path.splitext(source_path)[1].lower()
        if suffix in (".csv", ".parquet"):
            preview = lazy_preview_page(source_path, page, page_size)
        elif suffix in (".xlsx", ".xls"):
            preview = excel_preview_page(source_path, page, page_size)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format")

        return {
            "status": "success",
            "columns": preview.columns,
            "rows": preview.rows,
            "total_rows": preview.total_rows,
            "sampled_rows": preview.sampled_rows,
            "is_sampled": preview.is_sampled,
            "page": page,
            "page_size": page_size,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/column_values")
def get_column_values(source_path: str, column: str, search: str = "", limit: int = 100):
    """
    Returns distinct values for a given column, optionally filtered by a search term.
    Used by the frontend to populate value dropdowns for condition / filter editing.
    """
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Invalid source data path")
    if not column:
        raise HTTPException(status_code=400, detail="column parameter required")
    try:
        if limit < 1 or limit > 500:
            raise HTTPException(
                status_code=400, detail="limit must be between 1 and 500"
            )
        suffix = os.path.splitext(source_path)[1].lower()
        try:
            if suffix in (".csv", ".parquet"):
                distinct = lazy_distinct_values(
                    source_path, column, search, limit
                )
            elif suffix in (".xlsx", ".xls"):
                distinct = excel_distinct_values(
                    source_path, column, search, limit
                )
            else:
                raise HTTPException(status_code=400, detail="Unsupported file format")
        except KeyError:
            raise HTTPException(
                status_code=400, detail=f"Column '{column}' not found"
            )
        return {
            "status": "success",
            "values": distinct.values,
            "total_count": distinct.total_count,
            "returned_count": len(distinct.values),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/insights_data")
def get_insights_data(source_path: str):
    """
    Computes executive-level KPI metrics over the full dataset.
    Delegates to ``src.insights_data.compute_insights_data`` and ``InsightsDataComputations``.
    """
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Invalid source data path")
    try:
        return compute_insights_data(source_path)
    except UnsupportedInsightsDataFormat as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


if __name__ == "__main__":
    import multiprocessing

    from src.sidecar_lifecycle import reclaim_sidecar_port, register_sidecar_pid

    # PyInstaller bundles cannot resolve the "main:app" import string.
    multiprocessing.freeze_support()
    host = os.getenv("NOLAIN_SIDECAR_HOST", "127.0.0.1")
    port = int(os.getenv("NOLAIN_SIDECAR_PORT", "8001"))
    reclaim_sidecar_port(host, port)
    register_sidecar_pid()
    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
    )
