"""
Static sandbox policy for LLM-generated Pandas code.

AST-only: no DataFrame execution. Cloud generation and the local executor
share this module so import/allowlist checks cannot drift.
"""

from __future__ import annotations

import ast
import re
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

IMPORT_ALLOW_LIST = frozenset({"pandas", "numpy", "pd", "np", "scipy", "scipy.stats"})
PRELOADED_IMPORTS = frozenset({"pandas", "numpy", "pd", "np"})

BANNED_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.Try,
    ast.ExceptHandler,
    ast.With,
    ast.ClassDef,
    ast.AsyncFunctionDef,
    ast.Await,
    ast.Yield,
    ast.YieldFrom,
)

BANNED_NAMES = {
    "eval",
    "exec",
    "open",
    "getattr",
    "setattr",
    "delattr",
    "hasattr",
    "globals",
    "locals",
    "vars",
    "dir",
    "help",
    "input",
    "breakpoint",
    "compile",
    "__import__",
    "exit",
    "quit",
}

PLOTTING_METHODS = {
    "plot",
    "hist",
    "boxplot",
    "scatter_matrix",
    "pie",
    "imshow",
    "show",
    "savefig",
    "subplots",
    "figure",
}

_IO_METHODS = {"to_csv", "to_sql", "to_json", "to_pickle"}

FAILURE_TAG_RE = re.compile(
    r"\[failure category=(?P<category>[a-z_]+) code=(?P<code>[A-Z0-9_]+)\]"
)


def format_tagged_failure(category: str, code: str, message: str) -> str:
    """Prefix an error so repair routing can use structured codes, not English."""
    body = message.strip()
    if FAILURE_TAG_RE.search(body):
        return body
    return f"[failure category={category} code={code}] {body}"


def _import_module_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Import):
        return node.names[0].name if node.names else None
    if isinstance(node, ast.ImportFrom):
        return node.module
    return None


def _import_aliases(node: ast.AST) -> Set[str]:
    names: Set[str] = set()
    if isinstance(node, ast.Import):
        for alias in node.names:
            names.add(alias.asname or alias.name.split(".", 1)[0])
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            names.add(alias.asname or alias.name)
    return names


def _used_names(tree: ast.AST) -> Set[str]:
    used: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
    return used


def strip_forbidden_format_characters(source: str) -> Tuple[str, bool]:
    """
    Drop format/control characters and combining marks that cannot appear in
    valid sandbox code (e.g. U+200B, U+0367). Newlines, carriage returns, and
    tabs are kept.
    """
    if not source:
        return source, False
    kept: List[str] = []
    changed = False
    for character in source:
        category = unicodedata.category(character)
        drop = (
            category == "Cf"
            or category == "Mn"
            or (category == "Cc" and character not in "\n\r\t")
        )
        if drop:
            changed = True
            continue
        kept.append(character)
    if not changed:
        return source, False
    return "".join(kept), True


def strip_redundant_imports(source: str) -> Tuple[str, bool]:
    """
    Drop preloaded ``pandas``/``numpy`` imports and unused import statements.

    Used-but-disallowed imports are left for ``first_policy_error`` so the
    generator can retry instead of silently breaking the code.
    """
    if not source or not source.strip():
        return source, False
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source, False

    used = _used_names(tree)
    keep: List[ast.stmt] = []
    changed = False

    for stmt in tree.body:
        if not isinstance(stmt, (ast.Import, ast.ImportFrom)):
            keep.append(stmt)
            continue
        module = _import_module_name(stmt) or ""
        aliases = _import_aliases(stmt)
        preloaded = module in PRELOADED_IMPORTS or bool(aliases & PRELOADED_IMPORTS)
        unused = bool(aliases) and aliases.isdisjoint(used)
        if preloaded or unused:
            changed = True
            continue
        keep.append(stmt)

    if not changed:
        return source, False

    tree.body = keep
    ast.fix_missing_locations(tree)
    return ast.unparse(tree), True


_OPEN_TO_CLOSE = {"(": ")", "[": "]", "{": "}"}
_CLOSE_TO_OPEN = {")": "(", "]": "[", "}": "{"}


@dataclass(frozen=True)
class PolicyDiagnostic:
    """Structured sandbox/parser diagnostic. ``first_policy_error`` stringifies this."""

    category: str
    message: str
    code: str = ""
    line: Optional[int] = None
    column: Optional[int] = None
    end_line: Optional[int] = None
    end_column: Optional[int] = None
    source_line: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def format_error(self) -> str:
        if self.category == "syntax":
            location = ""
            if self.line is not None:
                location = f" (<unknown>, line {self.line})"
            body = f"Syntax error in generated code: {self.message}{location}"
        else:
            body = self.message
        code = self.code or self.category.upper()
        return format_tagged_failure(self.category, code, body)

    def caret_view(self) -> Optional[str]:
        if not self.source_line or self.line is None or self.column is None:
            return None
        header = f"> {self.line}: {self.source_line.rstrip()}"
        prefix_len = len(f"> {self.line}: ")
        caret = (" " * (prefix_len + max(self.column, 1) - 1)) + "^"
        return f"{header}\n{caret}"


@dataclass(frozen=True)
class CodeAcceptance:
    code: str
    error: Optional[str]
    diagnostic: Optional[PolicyDiagnostic]


def _source_line_at(code: str, lineno: Optional[int]) -> Optional[str]:
    if not lineno or lineno < 1:
        return None
    lines = code.splitlines()
    if lineno > len(lines):
        return None
    return lines[lineno - 1]


def _node_location(code: str, node: ast.AST) -> Dict[str, Optional[int | str]]:
    line = getattr(node, "lineno", None)
    end_line = getattr(node, "end_lineno", None)
    col = getattr(node, "col_offset", None)
    end_col = getattr(node, "end_col_offset", None)
    return {
        "line": line,
        "column": None if col is None else col + 1,
        "end_line": end_line,
        "end_column": None if end_col is None else end_col + 1,
        "source_line": _source_line_at(code, line),
    }


def inspect_policy(code: str, *, require_result: bool = True) -> Optional[PolicyDiagnostic]:
    """Return the first sandbox/parser violation as a structured diagnostic."""
    for offset, character in enumerate(code):
        category = unicodedata.category(character)
        if category == "Cf" or (category == "Cc" and character not in "\n\r\t"):
            line = code.count("\n", 0, offset) + 1
            line_start = code.rfind("\n", 0, offset)
            column = offset - line_start
            return PolicyDiagnostic(
                category="invalid_unicode",
                code="INVALID_UNICODE",
                message=(
                    "Invalid format/control character "
                    f"U+{ord(character):04X} at line {line}, column {column}"
                ),
                line=line,
                column=column,
                source_line=_source_line_at(code, line),
            )
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        line = exc.lineno
        return PolicyDiagnostic(
            category="syntax",
            code="SYNTAX_ERROR",
            message=exc.msg or str(exc),
            line=line,
            column=exc.offset,
            end_line=exc.end_lineno,
            end_column=exc.end_offset,
            source_line=(exc.text or _source_line_at(code, line) or "").rstrip("\n"),
        )

    for node in ast.walk(tree):
        loc = _node_location(code, node)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name not in IMPORT_ALLOW_LIST:
                        return PolicyDiagnostic(
                            category="sandbox_policy",
                            code="BANNED_IMPORT",
                            message=f"Import of module '{alias.name}' is not allowed.",
                            **loc,
                        )
            elif node.module not in IMPORT_ALLOW_LIST:
                return PolicyDiagnostic(
                    category="sandbox_policy",
                    code="BANNED_IMPORT",
                    message=f"Import from module '{node.module}' is not allowed.",
                    **loc,
                )
            continue

        if isinstance(node, BANNED_NODES):
            return PolicyDiagnostic(
                category="sandbox_policy",
                code="BANNED_NODE",
                message=(
                    "for security reasons."
                ),
                **loc,
            )

        if isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            return PolicyDiagnostic(
                category="sandbox_policy",
                message=f"Access to banned name '{node.id}' is prohibited.",
                **loc,
            )
        if isinstance(node, ast.Name) and not node.id.isascii():
            return PolicyDiagnostic(
                category="sandbox_policy",
                message=(
                    f"Non-ASCII identifier '{node.id}' is not allowed in generated code "
                    f"(line {getattr(node, 'lineno', '?')})."
                ),
                **loc,
            )

        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                return PolicyDiagnostic(
                    category="sandbox_policy",
                    message=f"Access to private attribute '{node.attr}' is prohibited.",
                    **loc,
                )
            if node.attr in BANNED_NAMES:
                return PolicyDiagnostic(
                    category="sandbox_policy",
                    message=f"Access to banned attribute '{node.attr}' is prohibited.",
                    **loc,
                )

        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in BANNED_NAMES:
                return PolicyDiagnostic(
                    category="sandbox_policy",
                    message=f"Call to banned function '{node.func.id}' is prohibited.",
                    **loc,
                )
            if isinstance(node.func, ast.Attribute):
                if node.func.attr in _IO_METHODS:
                    return PolicyDiagnostic(
                        category="sandbox_policy",
                        message=f"I/O operations like '{node.func.attr}' are not allowed.",
                        **loc,
                    )
                if node.func.attr in PLOTTING_METHODS:
                    return PolicyDiagnostic(
                        category="sandbox_policy",
                        message=(
                            f"Plotting method '{node.func.attr}' is not allowed. "
                            "Return tabular data in 'result' for the desktop renderer."
                        ),
                        **loc,
                    )
    if require_result:
        assigns_result = any(
            isinstance(node, ast.Name)
            and node.id == "result"
            and isinstance(node.ctx, ast.Store)
            for node in ast.walk(tree)
        )
        if not assigns_result:
            return PolicyDiagnostic(
                category="sandbox_policy",
                message="Generated code must assign the final answer to 'result'.",
            )
    return None


def first_policy_error(code: str) -> Optional[str]:
    """Return the first sandbox violation, or None if the code is statically allowed."""
    diagnostic = inspect_policy(code)
    return None if diagnostic is None else diagnostic.format_error()


def policy_errors(code: str) -> List[str]:
    error = first_policy_error(code)
    return [error] if error else []


def _index_at(source: str, line: int, column: int) -> Optional[int]:
    if line < 1 or column < 1:
        return None
    lines = source.splitlines(keepends=True)
    if line > len(lines):
        return None
    start = sum(len(row) for row in lines[: line - 1])
    row = lines[line - 1]
    content_len = len(row.rstrip("\r\n"))
    idx = start + column - 1
    if start <= idx <= start + content_len:
        return min(idx, start + content_len - 1) if content_len else None
    return None


def _insert_at_line_end(source: str, line: int, char: str) -> Optional[str]:
    lines = source.splitlines(keepends=True)
    if line < 1 or line > len(lines):
        return None
    row = lines[line - 1]
    newline = ""
    body = row
    if body.endswith("\r\n"):
        body, newline = body[:-2], "\r\n"
    elif body.endswith("\n"):
        body, newline = body[:-1], "\n"
    lines[line - 1] = body + char + newline
    return "".join(lines)


def attempt_syntax_repair(source: str) -> Optional[str]:
    """
    Try a one-character delimiter repair at the parser-reported location.

    Candidates are accepted only when ``inspect_policy`` returns None.
    """
    if not source or not source.strip():
        return None
    diagnostic = inspect_policy(source)
    if diagnostic is None or diagnostic.category != "syntax":
        return None

    candidates: List[str] = []
    idx = None
    if diagnostic.line is not None and diagnostic.column is not None:
        idx = _index_at(source, diagnostic.line, diagnostic.column)

    if idx is not None:
        ch = source[idx]
        if ch in _CLOSE_TO_OPEN:
            candidates.append(source[:idx] + source[idx + 1 :])
        if idx > 0 and source[idx - 1] in _CLOSE_TO_OPEN:
            candidates.append(source[: idx - 1] + source[idx:])
        if ch in _OPEN_TO_CLOSE and diagnostic.line is not None:
            inserted = _insert_at_line_end(
                source, diagnostic.line, _OPEN_TO_CLOSE[ch]
            )
            if inserted:
                candidates.append(inserted)

    message = diagnostic.message or ""
    opener_match = None
    for opener, closer in _OPEN_TO_CLOSE.items():
        if f"'{opener}' was never closed" in message:
            opener_match = opener
            break
        if f"unmatched '{closer}'" in message and idx is None and diagnostic.line:
            # Fall back to removing the last closer on the reported line.
            line_text = _source_line_at(source, diagnostic.line) or ""
            pos = line_text.rfind(closer)
            if pos >= 0:
                line_start = sum(
                    len(row)
                    for row in source.splitlines(keepends=True)[: diagnostic.line - 1]
                )
                remove_at = line_start + pos
                candidates.append(source[:remove_at] + source[remove_at + 1 :])
    if opener_match and diagnostic.line is not None:
        inserted = _insert_at_line_end(
            source, diagnostic.line, _OPEN_TO_CLOSE[opener_match]
        )
        if inserted:
            candidates.append(inserted)
        candidates.append(source + _OPEN_TO_CLOSE[opener_match])

    seen = set()
    for candidate in candidates:
        if candidate in seen or candidate == source:
            continue
        seen.add(candidate)
        if abs(len(candidate) - len(source)) != 1:
            continue
        if inspect_policy(candidate) is None:
            return candidate
    return None


def accept_generated_code(source: str, *, require_result: bool = True) -> CodeAcceptance:
    """
    Shared candidate acceptance: execution patches, then AST/policy/result checks.
    """
    from .execution_patches import apply_execution_patches

    code = apply_execution_patches(source if isinstance(source, str) else "")
    diagnostic = inspect_policy(code, require_result=require_result)
    return CodeAcceptance(
        code=code,
        error=None if diagnostic is None else diagnostic.format_error(),
        diagnostic=diagnostic,
    )
