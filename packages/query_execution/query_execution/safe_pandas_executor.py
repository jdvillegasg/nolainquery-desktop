import contextlib
import io
import builtins
import pandas as pd
import numpy as np
import scipy
import scipy.stats
import math
import datetime
import logging
import traceback
from typing import Any, Dict, Optional, Union
from pathlib import Path

from .pandas_code_policy import (
    BANNED_NAMES,
    BANNED_NODES,
    IMPORT_ALLOW_LIST,
    PLOTTING_METHODS,
    accept_generated_code,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("query_execution")

# NumPy lazy-imports internal submodules during normal pandas operations (e.g.
# TimedeltaArray.days.mean()). Allow only numpy's own internals, not arbitrary modules.
_NUMPY_INTERNAL_PREFIXES = ("numpy._core.", "numpy.core.")
_MAX_CAPTURED_STDOUT_CHARS = 16_384

ALLOWED_BUILTIN_NAMES = frozenset({
    "range",
    "len",
    "list",
    "dict",
    "set",
    "int",
    "float",
    "str",
    "bool",
    "min",
    "max",
    "sum",
    "any",
    "all",
    "enumerate",
    "zip",
    "round",
    "abs",
    "sorted",
    "filter",
    "map",
    "reversed",
    "slice",
    "type",
    "pow",
    "divmod",
    "print",
})


def _install_timedelta_astype_compat() -> None:
    """Allow `.astype('timedelta64[D]')` on microsecond timedeltas from DatetimeArray diffs."""
    try:
        from pandas.core.arrays.timedeltas import TimedeltaArray
    except ImportError:
        return

    if getattr(TimedeltaArray, "_nolain_astype_compat", False):
        return

    _orig_astype = TimedeltaArray.astype

    def _astype_compat(self, dtype, copy=True):
        dtype_name = np.dtype(dtype).name
        if dtype_name == "timedelta64[D]" and self.dtype == np.dtype("timedelta64[us]"):
            return self.to_numpy().astype("timedelta64[D]")
        return _orig_astype(self, dtype, copy=copy)

    TimedeltaArray.astype = _astype_compat
    TimedeltaArray._nolain_astype_compat = True


_install_timedelta_astype_compat()


class SecurityError(Exception):
    """Raised when the code violates security policies."""
    pass

class ExecutionError(Exception):
    """Raised when code execution fails."""
    pass


def _format_runtime_error(exc: BaseException) -> str:
    """Include the generated-code line so repair prompts can localize the failure."""
    frames = traceback.extract_tb(exc.__traceback__)
    line_no = None
    source_line = None
    for frame in reversed(frames):
        if frame.filename == "<string>":
            line_no = frame.lineno
            source_line = (frame.line or "").strip() or None
            break
    if line_no is None and frames:
        line_no = frames[-1].lineno
        source_line = (frames[-1].line or "").strip() or None
    message = f"Runtime error: {type(exc).__name__}: {exc}"
    if line_no is not None:
        message += f" at line {line_no}"
        if source_line:
            message += f": {source_line}"
    if isinstance(exc, KeyError):
        category, code = "column", "MISSING_COLUMN"
    else:
        category, code = "runtime", type(exc).__name__.upper() or "RUNTIME_ERROR"
    from .pandas_code_policy import format_tagged_failure

    return format_tagged_failure(category, code, message)

class SafePandasExecutor:
    """
    A service for executing LLM-generated Pandas code in a restricted environment.
    
    This component ensures that the code:
    1. Does not perform unauthorized imports or system calls.
    2. Does not access private attributes or dangerous built-in functions.
    3. Operates only on the provided DataFrame.
    4. Returns a result stored in the 'result' variable.
    """

    BANNED_NODES = BANNED_NODES
    BANNED_NAMES = BANNED_NAMES
    ALLOWED_MODULES = {
        'pd': pd,
        'np': np,
        'pandas': pd,
        'numpy': np,
        'scipy': scipy,
        'scipy.stats': scipy.stats
    }
    IMPORT_ALLOW_LIST = set(IMPORT_ALLOW_LIST)
    PLOTTING_METHODS = set(PLOTTING_METHODS)

    def __init__(self, csv_path: Union[str, Path]):
        """
        Initialize the executor with a CSV file.
        
        Args:
            csv_path: Path to the CSV file to load.
        """
        self.csv_path = Path(csv_path)
        if not self.csv_path.exists():
            raise FileNotFoundError(f"CSV file not found at: {csv_path}")
        
        self.df = self._load_data()

    def _load_data(self) -> pd.DataFrame:
        """Load CSV, Parquet, or Excel into a pandas DataFrame."""
        try:
            suffix = self.csv_path.suffix.lower()
            if suffix == ".parquet":
                return pd.read_parquet(self.csv_path)
            if suffix in (".xlsx", ".xls"):
                return pd.read_excel(self.csv_path)
            return pd.read_csv(self.csv_path)
        except Exception as e:
            logger.error(f"Failed to load data: {e}")
            raise ExecutionError(
                f"Failed to load data from {self.csv_path.name}: {str(e)}. "
                "Supported formats for code execution: .csv, .parquet, .xlsx."
            )

    def _safe_import(self, name, *args, **kwargs):
        if name in self.IMPORT_ALLOW_LIST:
            real_name = 'pandas' if name == 'pd' else ('numpy' if name == 'np' else name)
            return __import__(real_name, *args, **kwargs)
        if name.startswith(_NUMPY_INTERNAL_PREFIXES):
            return __import__(name, *args, **kwargs)
        raise SecurityError(f"Import of module '{name}' is strictly prohibited.")

    def create_namespace(self) -> Dict[str, Any]:
        """Create a fresh restricted namespace with a copy of the source DataFrame."""
        return {
            'df': self.df.copy(),
            'result': None,
            '__builtins__': {
                name: getattr(builtins, name)
                for name in ALLOWED_BUILTIN_NAMES
            } | {
                '__import__': self._safe_import,
            },
            'math': math,
            'datetime': datetime,
            'pd': pd,
            'np': np,
            'pandas': pd,
            'numpy': np
        }

    def execute_in_namespace(self, code: str, namespace: Dict[str, Any]) -> str:
        """
        Execute code inside an existing namespace (for notebook-style sessions).
        Mutates namespace in place. Returns captured stdout from print() calls.
        """
        accepted = accept_generated_code(code.strip(), require_result=False)
        if accepted.error:
            category = getattr(accepted.diagnostic, "category", None)
            if category == "syntax" or "syntax error" in str(accepted.error).lower():
                raise ExecutionError(accepted.error)
            raise SecurityError(accepted.error)
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                exec(accepted.code, namespace)
        except Exception as e:
            logger.error(f"Runtime error during code execution: {e}")
            raise ExecutionError(_format_runtime_error(e)) from e
        captured = buffer.getvalue()
        if len(captured) > _MAX_CAPTURED_STDOUT_CHARS:
            omitted = len(captured) - _MAX_CAPTURED_STDOUT_CHARS
            captured = (
                captured[:_MAX_CAPTURED_STDOUT_CHARS]
                + f"\n… ({omitted} more characters truncated)"
            )
        return captured

    def _validate_code(self, code: str, error: str | None = None, diagnostic=None):
        """
        Analyze the Python code using AST to ensure it follows security rules.
        """
        if error is None:
            accepted = accept_generated_code(code)
            error = accepted.error
            diagnostic = accepted.diagnostic
        if not error:
            return
        category = getattr(diagnostic, "category", None)
        if category == "syntax" or str(error).lower().find("syntax error") >= 0:
            raise ExecutionError(error)
        raise SecurityError(error)

    def execute(self, code: str) -> Any:
        """
        Execute the provided Pandas code and return the value stored in 'result'.
        
        Args:
            code: The Python code to execute.
        
        Returns:
            The contents of the 'result' variable after execution.
            
        Raises:
            SecurityError: If the code violates security policies.
            ExecutionError: If there's a runtime error during execution.
        """
        accepted = accept_generated_code(code.strip())
        self._validate_code(accepted.code, accepted.error, accepted.diagnostic)
        code = accepted.code
        
        # 3. Prepare restricted namespace
        combined_namespace = self.create_namespace()

        try:
            # 4. Execute using a single namespace for both globals and locals
            exec(code, combined_namespace)
            
            # 5. Extract result from the unified namespace
            if 'result' not in combined_namespace:
                logger.warning("Code executed successfully but 'result' variable was not set.")
                return None
                
            return combined_namespace['result']
            
        except Exception as e:
            logger.error(f"Runtime error during code execution: {e}")
            raise ExecutionError(_format_runtime_error(e)) from e

if __name__ == "__main__":
    # Quick demonstration/test (can be removed or moved to tests)
    # This expects a test.csv to exist, or just use a dummy df for testing the logic
    pass
