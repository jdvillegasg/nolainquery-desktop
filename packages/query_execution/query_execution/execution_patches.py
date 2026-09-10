"""
Execution-time patches for LLM-generated pandas code.

Generation may emit APIs that break on the pandas version in the local engine.
Patches run immediately before SafePandasExecutor validates and exec()s code.

To add a future patch:
  1. Implement ``def _patch_...(source: str) -> tuple[str, bool]`` returning
     (possibly modified source, whether anything changed).
  2. Register an ``ExecutionPatch`` in ``EXECUTION_PATCHES`` (order matters).
  3. Document the trigger (error message / pandas version) in the patch summary.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Callable, List, Tuple

from .pandas_code_policy import (
    strip_forbidden_format_characters,
    strip_redundant_imports,
)

_PATCH_HEADER_PREFIX = "# Nolain execution patches applied:"

# Legacy offset aliases rejected for resample/asfreq on pandas 3+ (use explicit anchors).
_OFFSET_FREQ_REMAP = {
    "M": "ME",
    "Q": "QE",
    "Y": "YE",
    "A": "YE",
}

_RESAMPLE_LIKE_METHODS = frozenset({"resample", "asfreq"})


@dataclass(frozen=True)
class ExecutionPatch:
    patch_id: str
    summary: str
    apply: Callable[[str], Tuple[str, bool]]


class _OffsetFrequencyTransformer(ast.NodeTransformer):
    """Rewrite deprecated offset strings on resample/asfreq/date_range only."""

    def __init__(self) -> None:
        self.changed = False

    def visit_Call(self, node: ast.Call) -> ast.Call:
        self.generic_visit(node)
        if isinstance(node.func, ast.Attribute) and node.func.attr in _RESAMPLE_LIKE_METHODS:
            self._remap_first_string_arg(node)
            self._remap_keyword(node, ("rule", "freq"))
        elif self._is_date_range_call(node):
            self._remap_keyword(node, ("freq",))
        return node

    @staticmethod
    def _is_date_range_call(node: ast.Call) -> bool:
        func = node.func
        if isinstance(func, ast.Name) and func.id == "date_range":
            return True
        if isinstance(func, ast.Attribute) and func.attr == "date_range":
            return True
        return False

    def _remap_string(self, value: str) -> str | None:
        # Only single-letter legacy aliases; leave "ME", "MS", "2M", etc. untouched.
        return _OFFSET_FREQ_REMAP.get(value)

    def _remap_first_string_arg(self, node: ast.Call) -> None:
        if not node.args:
            return
        arg0 = node.args[0]
        if not isinstance(arg0, ast.Constant) or not isinstance(arg0.value, str):
            return
        replacement = self._remap_string(arg0.value)
        if replacement:
            node.args[0] = ast.Constant(value=replacement)
            self.changed = True

    def _remap_keyword(self, node: ast.Call, names: tuple[str, ...]) -> None:
        for kw in node.keywords:
            if kw.arg not in names or kw.value is None:
                continue
            if not isinstance(kw.value, ast.Constant) or not isinstance(kw.value.value, str):
                continue
            replacement = self._remap_string(kw.value.value)
            if replacement:
                kw.value = ast.Constant(value=replacement)
                self.changed = True


def _patch_pandas_offset_frequencies(source: str) -> Tuple[str, bool]:
    """
    Patch: pandas 3+ rejects legacy offset 'M'/'Q'/'Y'/'A' on resample and asfreq.

    Does not alter to_period('M') or other period-alias APIs used by the DAG engine.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source, False

    transformer = _OffsetFrequencyTransformer()
    new_tree = transformer.visit(tree)
    if not transformer.changed:
        return source, False

    ast.fix_missing_locations(new_tree)
    return ast.unparse(new_tree), True


def _patch_forbidden_format_characters(source: str) -> Tuple[str, bool]:
    """Remove zero-width and combining characters that break Python parsing."""
    return strip_forbidden_format_characters(source)


def _patch_redundant_imports(source: str) -> Tuple[str, bool]:
    """Drop preloaded pandas/numpy imports and unused import statements."""
    return strip_redundant_imports(source)


EXECUTION_PATCHES: List[ExecutionPatch] = [
    ExecutionPatch(
        patch_id="strip_forbidden_format_characters",
        summary="Remove format/control and combining characters (e.g. U+200B)",
        apply=_patch_forbidden_format_characters,
    ),
    ExecutionPatch(
        patch_id="strip_redundant_imports",
        summary="Remove preloaded or unused imports (pd/np are already in the sandbox)",
        apply=_patch_redundant_imports,
    ),
    ExecutionPatch(
        patch_id="pandas_offset_freq",
        summary="Map legacy resample/asfreq/date_range offsets (M→ME, Q→QE, Y/A→YE) for pandas 3+",
        apply=_patch_pandas_offset_frequencies,
    ),
]


def apply_execution_patches(source: str) -> str:
    """Run registered patches; prepend a marker comment when any patch modified the code."""
    if not source or not source.strip():
        return source

    code = source
    applied_ids: List[str] = []

    for patch in EXECUTION_PATCHES:
        code, changed = patch.apply(code)
        if changed:
            applied_ids.append(patch.patch_id)

    if not applied_ids:
        return source

    if code.lstrip().startswith(_PATCH_HEADER_PREFIX):
        return code

    summaries = [
        next(p.summary for p in EXECUTION_PATCHES if p.patch_id == pid)
        for pid in applied_ids
    ]
    header_lines = [
        f"{_PATCH_HEADER_PREFIX} {', '.join(applied_ids)}",
        *[f"#   - {s}" for s in summaries],
        "",
    ]
    return "\n".join(header_lines) + code
