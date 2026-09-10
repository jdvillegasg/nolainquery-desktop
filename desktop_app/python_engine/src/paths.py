"""
Ensure shared packages are importable without a separate pip install.

Inserts `packages/query_operations` and `packages/query_execution` (repo root)
onto sys.path when running the desktop engine from source.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _repo_root() -> Path:
    # src/paths.py -> src -> python_engine -> desktop_app -> repo (nolain-data-query)
    return Path(__file__).resolve().parents[3]


def _ensure_package_on_path(package_dir: str) -> None:
    pkg_parent = _repo_root() / "packages" / package_dir
    if pkg_parent.is_dir():
        s = str(pkg_parent)
        if s not in sys.path:
            sys.path.insert(0, s)


def ensure_query_operations_on_path() -> None:
    _ensure_package_on_path("query_operations")


def ensure_query_execution_on_path() -> None:
    _ensure_package_on_path("query_execution")


# Run on import so shared packages work before any executor submodule loads.
ensure_query_operations_on_path()
ensure_query_execution_on_path()
