from typing import Any

from .pandas_code_policy import (
    first_policy_error,
    inspect_policy,
    accept_generated_code,
    attempt_syntax_repair,
    PolicyDiagnostic,
    CodeAcceptance,
    strip_redundant_imports,
)

__all__ = [
    "SafePandasExecutor",
    "SecurityError",
    "ExecutionError",
    "notebook_sessions",
    "parse_python_steps",
    "first_policy_error",
    "inspect_policy",
    "accept_generated_code",
    "attempt_syntax_repair",
    "PolicyDiagnostic",
    "CodeAcceptance",
    "strip_redundant_imports",
]


def __getattr__(name: str) -> Any:
    if name in {"SafePandasExecutor", "SecurityError", "ExecutionError"}:
        from .safe_pandas_executor import ExecutionError, SafePandasExecutor, SecurityError

        return {
            "SafePandasExecutor": SafePandasExecutor,
            "SecurityError": SecurityError,
            "ExecutionError": ExecutionError,
        }[name]
    if name == "notebook_sessions":
        from .notebook_session import notebook_sessions

        return notebook_sessions
    if name == "parse_python_steps":
        from .notebook_cells import parse_python_steps

        return parse_python_steps
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
