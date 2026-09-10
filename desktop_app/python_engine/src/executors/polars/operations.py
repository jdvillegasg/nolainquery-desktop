"""
Operation registry — re-export of the shared `query_operations` package.

Canonical definitions: `packages/query_operations/query_operations/__init__.py`
"""
from __future__ import annotations

from ... import paths  # noqa: F401

from query_operations import (  # noqa: E402
    COMPILER_REGISTRY,
    OPERATION_CONTRACTS,
    OPERATION_REGISTRY,
    VALIDATOR_REGISTRY,
    CompilerOperationSpec,
    InputPort,
    OperationContract,
    OutputContract,
    ParamContract,
    ValidatorOperationSpec,
    get_operations_documentation,
    get_input_port_order,
    lower_named_port_graph,
    render_correction_view,
    render_generation_view,
    render_operation_graph_grammar,
)

OperationSpec = CompilerOperationSpec

__all__ = [
    "COMPILER_REGISTRY",
    "OPERATION_CONTRACTS",
    "OPERATION_REGISTRY",
    "VALIDATOR_REGISTRY",
    "CompilerOperationSpec",
    "InputPort",
    "OperationContract",
    "OutputContract",
    "ParamContract",
    "ValidatorOperationSpec",
    "OperationSpec",
    "get_operations_documentation",
    "get_input_port_order",
    "lower_named_port_graph",
    "render_correction_view",
    "render_generation_view",
    "render_operation_graph_grammar",
]
