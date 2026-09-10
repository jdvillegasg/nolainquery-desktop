class ExecutionError(Exception):
    """Base exception for execution errors."""
    pass

class InvalidOperationError(ExecutionError):
    """Raised when an operation cannot be executed."""
    pass
