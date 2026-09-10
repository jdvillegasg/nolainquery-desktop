import ast
import math
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from .safe_pandas_executor import ExecutionError, SafePandasExecutor, SecurityError

RESERVED_NAMESPACE_KEYS = frozenset({
    "df",
    "result",
    "pd",
    "np",
    "pandas",
    "numpy",
    "math",
    "datetime",
    "scipy",
    "__builtins__",
})


def _target_names(node: ast.AST) -> Set[str]:
    if isinstance(node, ast.Name):
        return {node.id}
    if isinstance(node, (ast.Tuple, ast.List)):
        names: Set[str] = set()
        for elt in node.elts:
            names.update(_target_names(elt))
        return names
    if isinstance(node, ast.Subscript):
        return _target_names(node.value)
    if isinstance(node, ast.Attribute):
        return _target_names(node.value)
    return set()


def assigned_names(code: str) -> Set[str]:
    tree = ast.parse(code)
    names: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                names.update(_target_names(target))
        elif isinstance(node, ast.AugAssign):
            names.update(_target_names(node.target))
    return names


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, int):
        return value
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        v = float(value)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.ravel()[:20]]
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value[:20]]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in list(value.items())[:20]}
    return str(value)


def serialize_variable(name: str, value: Any) -> Dict[str, Any]:
    if isinstance(value, pd.DataFrame):
        raw_preview = value.head(5).to_dict(orient="records")
        preview_rows = [{str(k): _json_safe(v) for k, v in row.items()} for row in raw_preview]
        return {
            "type": "dataframe",
            "shape": [int(value.shape[0]), int(value.shape[1])],
            "columns": [str(c) for c in value.columns.tolist()],
            "preview": preview_rows,
        }
    if isinstance(value, pd.Series):
        head = value.head(10)
        return {
            "type": "series",
            "length": int(len(value)),
            "preview": {str(k): _json_safe(v) for k, v in head.items()},
        }
    if isinstance(value, (int, float, bool, str)) or value is None:
        return {"type": "scalar", "value": _json_safe(value)}
    if isinstance(value, (list, dict, tuple)):
        return {"type": "collection", "preview": _json_safe(value)}
    return {"type": "object", "repr": repr(value)[:240]}


def extract_none_result_reason(code: str) -> Optional[str]:
    """Pull an explanatory comment near `result = None` if present."""
    lines = code.splitlines()
    for i, line in enumerate(lines):
        if not re.search(r"^\s*result\s*=\s*None\b", line):
            continue
        for j in range(i - 1, max(-1, i - 5), -1):
            t = lines[j].strip()
            if t.startswith("#"):
                reason = t.lstrip("#").strip()
                if reason:
                    return reason
            if t and not t.startswith("#"):
                break
        if "#" in line:
            inline = line.split("#", 1)[1].strip()
            if inline:
                return inline
        return (
            "The calculation concluded that this question cannot be answered "
            "with the available columns."
        )
    return None


DEFAULT_RESULT_ROW_LIMIT = 500


def result_row_metadata(result: Any, full_export: bool = False) -> Dict[str, Any]:
    """Describe top-level tabular result truncation for API consumers."""
    if isinstance(result, (pd.DataFrame, pd.Series)):
        total_rows = int(len(result))
        return {
            "result_total_rows": total_rows,
            "result_truncated": not full_export and total_rows > DEFAULT_RESULT_ROW_LIMIT,
        }
    return {"result_total_rows": None, "result_truncated": False}


def serialize_result(result: Any, full_export: bool = False) -> Any:
    """JSON-safe execution output (DAG and notebook ``result`` variable)."""
    if isinstance(result, pd.DataFrame):
        output = result if full_export else result.head(DEFAULT_RESULT_ROW_LIMIT)
        sanitized = output.where(output.notna(), other=None)
        raw = sanitized.to_dict(orient="records")
        return [{str(k): _json_safe(v) for k, v in row.items()} for row in raw]
    if isinstance(result, pd.Series):
        output = result if full_export else result.head(DEFAULT_RESULT_ROW_LIMIT)
        sanitized = output.where(output.notna(), other=None)
        value_name = sanitized.name if sanitized.name is not None else "value"
        frame = sanitized.to_frame(name=value_name).reset_index()
        first_col = frame.columns[0]
        if sanitized.index.name is not None:
            frame = frame.rename(columns={first_col: str(sanitized.index.name)})
        elif first_col in ("index", "level_0"):
            frame = frame.rename(columns={first_col: "index"})
        return serialize_result(frame, full_export=True)
    if isinstance(result, (list, tuple)):
        return [serialize_result(v) for v in result]
    if isinstance(result, dict):
        return {str(k): serialize_result(v) for k, v in result.items()}
    return _json_safe(result)


class NotebookSession:
    def __init__(self, source_path: Union[str, Path]):
        self.source_path = str(Path(source_path))
        self._executor = SafePandasExecutor(source_path)
        self.namespace = self._executor.create_namespace()

    def reset(self) -> None:
        self.namespace = self._executor.create_namespace()

    def execute_cell(self, code: str, full_export: bool = False) -> Dict[str, Any]:
        code = code.strip()
        targets = assigned_names(code)
        result_before = self.namespace.get("result")
        stdout = self._executor.execute_in_namespace(code, self.namespace)
        result = self.namespace.get("result")

        variables: Dict[str, Any] = {}
        for name in sorted(targets):
            if name in RESERVED_NAMESPACE_KEYS:
                continue
            if name not in self.namespace:
                continue
            variables[name] = serialize_variable(name, self.namespace[name])

        if "df" in targets and "df" not in variables:
            variables["df"] = serialize_variable("df", self.namespace["df"])

        warnings: list = []
        if result is None:
            reason = extract_none_result_reason(code)
            if reason:
                warnings.append({"code": "result_none", "message": reason})
            elif "result" in targets or result_before is not None:
                warnings.append({
                    "code": "result_none",
                    "message": (
                        "This step finished with no final answer value. "
                        "The question may not be answerable with the available columns."
                    ),
                })
        elif isinstance(result, pd.DataFrame) and result.empty:
            warnings.append({
                "code": "empty_result",
                "message": "No matching records were found after applying the filters in this step.",
            })
        elif isinstance(result, (list, tuple)) and len(result) == 0:
            warnings.append({
                "code": "empty_result",
                "message": "No matching records were found after applying the filters in this step.",
            })

        payload: Dict[str, Any] = {
            "result": serialize_result(result, full_export=full_export),
            "variables": variables,
            **result_row_metadata(result, full_export=full_export),
        }
        if stdout:
            payload["stdout"] = stdout
        if warnings:
            payload["warnings"] = warnings
        return payload


class NotebookSessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, NotebookSession] = {}

    def execute(
        self,
        *,
        code: str,
        source_path: str,
        session_id: Optional[str],
        reset_session: bool,
        full_export: bool = False,
    ) -> Tuple[str, Dict[str, Any]]:
        if reset_session or not session_id or session_id not in self._sessions:
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = NotebookSession(source_path)
        else:
            session = self._sessions[session_id]
            if session.source_path != str(Path(source_path)):
                session_id = str(uuid.uuid4())
                self._sessions[session_id] = NotebookSession(source_path)

        session = self._sessions[session_id]
        if reset_session:
            session.reset()

        payload = session.execute_cell(code, full_export=full_export)
        payload["session_id"] = session_id
        return session_id, payload


# Shared store for the desktop python sidecar.
notebook_sessions = NotebookSessionStore()

__all__ = [
    "NotebookSession",
    "NotebookSessionStore",
    "notebook_sessions",
    "assigned_names",
    "serialize_variable",
    "serialize_result",
    "result_row_metadata",
    "extract_none_result_reason",
    "ExecutionError",
    "SecurityError",
]
