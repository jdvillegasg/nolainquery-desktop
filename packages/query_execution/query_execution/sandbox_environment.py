"""Structured sandbox environment metadata for API and UI consumers."""

from __future__ import annotations

from typing import Any, Dict, List

from .pandas_code_policy import IMPORT_ALLOW_LIST, PRELOADED_IMPORTS
from .safe_pandas_executor import ALLOWED_BUILTIN_NAMES

_PRELOADED: List[Dict[str, str]] = [
    {"name": "df", "kind": "dataframe", "description": "Copy of the open dataset"},
    {"name": "result", "kind": "variable", "description": "Assign your final answer here"},
    {"name": "pd", "kind": "module", "description": "pandas"},
    {"name": "np", "kind": "module", "description": "numpy"},
    {"name": "pandas", "kind": "module", "description": "Same as pd"},
    {"name": "numpy", "kind": "module", "description": "Same as np"},
    {"name": "math", "kind": "module", "description": "Standard math functions"},
    {"name": "datetime", "kind": "module", "description": "Date and time utilities"},
]

_RULES: List[str] = [
    "Assign the final answer to result.",
    "Plotting methods (plot, hist, show, etc.) are not allowed.",
    "File I/O (to_csv, to_json, etc.) is not allowed.",
    "Only modules listed here may be imported.",
]

_STARTER_SNIPPET = (
    "filtered = df[df[\"column\"] > 0]\n"
    "result = filtered.groupby(\"category\").size().reset_index(name=\"count\")"
)


def sandbox_environment_spec() -> Dict[str, Any]:
    """Return the notebook sandbox environment for desktop UI and docs."""
    preloaded_names = {item["name"] for item in _PRELOADED}
    allowed_imports = sorted(
        module
        for module in IMPORT_ALLOW_LIST
        if module not in PRELOADED_IMPORTS and module not in preloaded_names
    )
    toolbar_names = ["pd", "np", "math", "datetime", "df", "result"]
    return {
        "preloaded": list(_PRELOADED),
        "allowed_imports": allowed_imports,
        "builtins": sorted(ALLOWED_BUILTIN_NAMES),
        "rules": list(_RULES),
        "toolbar_names": toolbar_names,
        "starter_snippet": _STARTER_SNIPPET,
    }
