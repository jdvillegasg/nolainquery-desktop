"""
Operation Registry - The "Compiler Instruction Set"

Single source of truth for cloud (`cloud_api`) and desktop (`desktop_app/python_engine`):
import this package as `query_operations` or via compatibility shims (`app.core.operations`,
`src.executors.pandas.operations`).

This module documents all available operations that can be used in computation graphs.
We maintain two perspectives:
1. VALIDATOR_REGISTRY: Pure structural metadata for deterministic checks.
2. COMPILER_REGISTRY: Rich semantic metadata for LLM prompt generation.

The COMPILER_REGISTRY models each operation with explicit, declarative fields so
the planner / compiler agent can reason about scope alignment, parameter kinds and
result kinds without parsing free-form prose.
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Concept / scope vocabulary used across the registry
# ---------------------------------------------------------------------------
#
# Output scopes (what scope the node's result lives in):
#   "scalar"               -> Single broadcast-neutral value. Combines freely with any scope.
#   "global"               -> Source-aligned vector (all rows of the source table).
#   "filtered"             -> Source-aligned vector restricted by a filter condition.
#                             Two "filtered" results share scope ONLY if they were produced
#                             with the exact same condition string.
#   "grouped"              -> Vector indexed by group keys (output of a groupby_agg).
#                             Two "grouped" results share scope ONLY if grouped by the same column.
#   "inherits_from_input"  -> Result keeps the scope of its (single) input. Used by element-wise
#                             single-input ops (type conversions, masks, math unary, ...).
#   "inherits_from_inputs" -> Result keeps the common scope of its inputs. Used by element-wise
#                             multi-input ops (arithmetic, comparison, logical). All non-scalar
#                             inputs MUST share the same scope.
#   "derived"              -> Alignment is lost. Result is a vector but its index no longer
#                             aligns with any other scope and CANNOT be combined element-wise
#                             with any other vector.
#
# Result kinds (what a downstream consumer should expect):
#   "scalar"               -> A single number / string / timestamp.
#   "vector"               -> A pandas.Series of values aligned to its scope.
#   "mask"                 -> A pandas.Series of booleans, intended to be consumed by `index`
#                             or by logical_and / logical_or / logical_not.
#   "label_vector"         -> A pandas.Series of labels (e.g., index labels). Almost always
#                             consumed for display, NOT for element-wise arithmetic.
#
# Parameter kinds (how to fill a parameter):
#   "source_column"        -> Raw column-name string from the source table (e.g., "Year").
#   "node_id"              -> A string referencing another node id (e.g., "node_3").
#   "column_or_node"       -> Either a raw source-column name OR a node id.
#   "literal_scalar"       -> A literal scalar (int / float / str / bool).
#   "literal_list"         -> A literal list of values.
#   "literal_int"          -> A literal integer.
#   "literal_bool"         -> A literal boolean.
#   "agg_function"         -> One of the supported aggregation strings (see groupby_agg.params).
#   "condition"            -> A pandas .eval/.query-style boolean expression. See "Concepts".
#   "format_string"        -> A strftime-style format string.


# ---------------------------------------------------------------------------
# Spec dataclasses
# ---------------------------------------------------------------------------

@dataclass
class CompilerOperationSpec:
    """Rich specification used to render docs for the planner / compiler agent."""
    name: str
    category: str
    summary: str
    description: str  # Behavior + scope rules summarized as prose (kept for legacy renderer compat).
    inputs: List[str]                       # Strict Python type strings.
    output: str                             # Strict Python type string.
    output_scope: str                       # See "Output scopes" vocabulary above.
    input_scope_requirements: List[str]     # Parallel to `inputs`. One scope-name per input.
    result_kind: str                        # See "Result kinds" vocabulary above.
    example: str
    params: Dict[str, str] = field(default_factory=dict)
    param_kinds: Dict[str, str] = field(default_factory=dict)
    required_params: Optional[List[str]] = None
    caveats: List[str] = field(default_factory=list)
    anti_patterns: List[str] = field(default_factory=list)


@dataclass
class ValidatorOperationSpec:
    """Minimal specification for deterministic validation."""
    name: str
    inputs: List[str]
    required_params: Optional[List[str]] = None


@dataclass
class InputPort:
    """Named semantic input accepted by an operation."""
    name: str
    accepted_kinds: List[str]
    accepted_types: List[str]
    scope_rule: str = "any"
    description: str = ""


@dataclass
class ParamContract:
    """Machine-readable contract for a static operation parameter."""
    name: str
    kind: str
    required: bool = False
    description: str = ""


@dataclass
class OutputContract:
    """Machine-readable description of an operation result."""
    kind: str
    output_type: str
    scope_rule: str
    index_lineage: str = "preserved"
    description: str = ""


@dataclass
class OperationContract:
    """Graph grammar contract: legal ports, params, result and transitions."""
    name: str
    category: str
    summary: str
    input_ports: List[InputPort]
    params: List[ParamContract]
    output: OutputContract
    valid_consumers: List[str] = field(default_factory=list)
    forbidden_consumers: List[str] = field(default_factory=list)
    canonical_patterns: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Category vocabulary (used for grouping in the rendered view)
# ---------------------------------------------------------------------------

CATEGORY_ORDER: List[str] = [
    "extraction",
    "arithmetic",
    "math",
    "statistical",
    "aggregation",
    "conditional_aggregation",
    "ranking",
    "comparison",
    "logical",
    "predicate",
    "type_conversion",
    "datetime",
    "indexing",
]

CATEGORY_LABEL: Dict[str, str] = {
    "extraction":              "Data Extraction (read from source)",
    "arithmetic":              "Arithmetic (element-wise)",
    "math":                    "Math (element-wise unary / binary)",
    "statistical":             "Statistical (multi-input)",
    "aggregation":             "Aggregation (vector -> scalar / collapsed)",
    "conditional_aggregation": "Conditional Aggregation (aggregate under a mask)",
    "ranking":                 "Ranking & Ordering",
    "comparison":              "Comparison (produces boolean masks)",
    "logical":                 "Logical (combine boolean masks)",
    "predicate":               "Predicate (produces boolean masks)",
    "type_conversion":         "Type Conversion",
    "datetime":                "Date / Time Component Extraction",
    "indexing":                "Indexing & Index Inspection",
}


# ---------------------------------------------------------------------------
# COMPILER REGISTRY
# ---------------------------------------------------------------------------

COMPILER_REGISTRY: Dict[str, CompilerOperationSpec] = {

    # ----- Extraction --------------------------------------------------------

    "filter_extract": CompilerOperationSpec(
        name="filter_extract",
        category="extraction",
        summary="Reads a column from the source table, optionally restricted by a row condition.",
        description=(
            "Reads a column from the source table using .loc indexing. Takes NO inputs and uses "
            "the raw column name from the source table directly. Without `condition` it produces "
            "a 'global' scope (all source rows). With `condition` it produces a 'filtered' scope "
            "uniquely identified by the exact condition string."
        ),
        inputs=[],
        input_scope_requirements=[],
        output="pandas.Series",
        output_scope="global",  # becomes "filtered" when condition is provided
        result_kind="vector",
        params={
            "column": "Name of the column to extract from the source table.",
            "condition": (
                "Optional pandas eval/query-style boolean expression (e.g., \"year == 2024\", "
                "\"`Order Date` > '2023-01-01'\", \"country in ['USA','UK']\"). "
                "When set, defines a 'filtered' scope uniquely identified by this exact string."
            ),
        },
        param_kinds={
            "column": "source_column",
            "condition": "condition",
        },
        required_params=["column"],
        caveats=[
            "The result of `filter_extract` retains the original source row index, so it is "
            "scope-compatible only with other nodes produced under the same condition (or with scalars).",
            "Two filter_extract nodes with different `condition` strings produce DIFFERENT 'filtered' scopes, "
            "even if they semantically select overlapping rows.",
            "Column names containing spaces must be wrapped in backticks in `condition` (e.g., \"`Order Date` > '2023-01-01'\").",
        ],
        anti_patterns=[
            "DO NOT pre-extract a column only to feed it to `groupby_agg.groupby_column` or `filter_extract.column` "
            "— those parameters take raw source-column names, not node IDs.",
        ],
        example='{"params": {"column": "revenue", "condition": "year == 2024"}, "inputs": []}',
    ),

    "groupby_agg": CompilerOperationSpec(
        name="groupby_agg",
        category="extraction",
        summary="Groups source rows by one or more columns/nodes and aggregates a column or computed series per group.",
        description=(
            "Takes NO `inputs`. Groups rows by `groupby_column` (single source-column name) OR by "
            "`groupby_columns` (list of source-column names or node ids of source-aligned derived vectors, "
            "e.g. an `extract_month` result). Aggregates `agg_column` per group. `agg_column` can be "
            "either a raw source-column name OR a node id referencing a previously computed Series — "
            "but if a node id is passed, that node MUST be source-aligned (length and index matching the "
            "source table). The result is a vector indexed by group keys ('grouped' scope). "
            "Use `groupby_columns` for multi-key grouping (e.g. per customer per month); use "
            "`groupby_column` for single-key grouping."
        ),
        inputs=[],
        input_scope_requirements=[],
        output="pandas.Series",
        output_scope="grouped",
        result_kind="vector",
        params={
            "groupby_column": (
                "Raw source-column name to group by (NEVER a node id). "
                "Use this for single-key grouping. Either this OR `groupby_columns` is required."
            ),
            "groupby_columns": (
                "List of source-column names or node ids for multi-key grouping (e.g. ['Customer ID', 'node_3'] "
                "where node_3 is an extract_month result). When present, takes precedence over `groupby_column`. "
                "Each entry is either a raw source-column name string or a node id of a source-aligned Series."
            ),
            "agg_column": (
                "Either a raw source-column name OR a node id (e.g., 'node_2'). "
                "If a node id is used, the referenced node must be source-aligned (same length/index as the source table)."
            ),
            "agg_function": (
                "Aggregation function. One of: 'sum', 'mean', 'count', 'max', 'min', 'std', 'median', 'nunique'."
            ),
        },
        param_kinds={
            "groupby_column": "source_column",
            "groupby_columns": "literal_list",
            "agg_column": "column_or_node",
            "agg_function": "agg_function",
        },
        required_params=["agg_column", "agg_function"],
        caveats=[
            "Either `groupby_column` (single key) or `groupby_columns` (multi-key list) MUST be provided.",
            "The output index is the set of distinct group keys, NOT source rows. Results from two "
            "groupby_agg with different grouping keys have DIFFERENT 'grouped' scopes and "
            "cannot be combined element-wise.",
            "When `agg_column` is a node id, the referenced node must still live in 'global' or "
            "'filtered' scope (source-aligned). Passing an already-grouped node is invalid.",
            "Entries in `groupby_columns` that are node ids must reference source-aligned vectors "
            "(e.g. the output of `extract_month`, `extract_year`, etc.).",
        ],
        anti_patterns=[
            "DO NOT create a `filter_extract` node for `groupby_column`; it is read directly from the source.",
            "DO NOT pass another `groupby_agg`'s output as `agg_column` (it is no longer source-aligned).",
            "DO NOT use both `groupby_column` and `groupby_columns` simultaneously; use only one.",
        ],
        example='{"params": {"groupby_columns": ["Customer ID", "node_3"], "agg_column": "node_2", "agg_function": "sum"}, "inputs": []}',
    ),

    "load_constant": CompilerOperationSpec(
        name="load_constant",
        category="extraction",
        summary="Injects a literal constant into the graph.",
        description=(
            "Injects a fixed scalar value into the graph. The result has 'scalar' scope and "
            "broadcasts freely with any other scope. Use for thresholds, multipliers, comparison "
            "right-hand sides, percentages, and similar constants."
        ),
        inputs=[],
        input_scope_requirements=[],
        output="Union[float, int, str]",
        output_scope="scalar",
        result_kind="scalar",
        params={
            "value": "Scalar literal to inject (int, float, str, or bool).",
        },
        param_kinds={
            "value": "literal_scalar",
        },
        required_params=["value"],
        caveats=[
            "Use ONLY for scalar literals. To pass a list of literal values to operations such as `isin`, "
            "use the `values` parameter of that operation directly — do not place a list in `load_constant`.",
        ],
        anti_patterns=[
            "DO NOT use `load_constant` with a list value as the right-hand side of an arithmetic op; "
            "the result will not behave as a scalar.",
        ],
        example='{"params": {"value": 100}, "inputs": []}',
    ),

    # ----- Arithmetic --------------------------------------------------------

    "add": CompilerOperationSpec(
        name="add",
        category="arithmetic",
        summary="Element-wise addition of two operands.",
        description="Element-wise addition. Supports scalar+scalar, vector+vector, and scalar+vector broadcasting.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float, int]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "If both inputs are vectors, they must share the SAME non-scalar scope.",
            "Mixing 'global', 'filtered:<X>', and 'grouped:<Y>' vectors is INVALID.",
        ],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "subtract": CompilerOperationSpec(
        name="subtract",
        category="arithmetic",
        summary="Element-wise subtraction (first input minus second).",
        description="Element-wise subtraction. Supports scalar-scalar, vector-vector, and broadcasting.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float, int]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same non-scalar scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "multiply": CompilerOperationSpec(
        name="multiply",
        category="arithmetic",
        summary="Element-wise multiplication of two operands.",
        description="Element-wise multiplication. Supports scalar*scalar, vector*vector, and broadcasting.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float, int]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same non-scalar scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "divide": CompilerOperationSpec(
        name="divide",
        category="arithmetic",
        summary="Element-wise division (first input divided by second).",
        description="Element-wise division. Division by zero returns an error.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float, int]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "Both vector inputs must share the same non-scalar scope.",
            "Division by zero raises an error — guard with a non-zero filter or use `percentage_change` for safer growth math.",
        ],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    # ----- Math --------------------------------------------------------------

    "abs": CompilerOperationSpec(
        name="abs",
        category="math",
        summary="Element-wise absolute value.",
        description="Returns the absolute value of each element.",
        inputs=["Union[pandas.Series, float, int]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, float, int]",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "round": CompilerOperationSpec(
        name="round",
        category="math",
        summary="Element-wise rounding to a fixed number of decimals.",
        description="Rounds each element to the specified number of decimal places.",
        inputs=["Union[pandas.Series, float]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, float]",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={
            "decimals": "Number of decimal places to round to (integer, defaults to 0).",
        },
        param_kinds={"decimals": "literal_int"},
        example='{"inputs": ["node_0"], "params": {"decimals": 2}}',
    ),

    "pow": CompilerOperationSpec(
        name="pow",
        category="math",
        summary="Element-wise exponentiation (base ** exponent).",
        description="Raises each element of the first input to the power of the second input.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same non-scalar scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "sqrt": CompilerOperationSpec(
        name="sqrt",
        category="math",
        summary="Element-wise square root.",
        description="Returns the (non-negative) square root of each element.",
        inputs=["Union[pandas.Series, float, int]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, float]",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Negative values produce NaN."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "log": CompilerOperationSpec(
        name="log",
        category="math",
        summary="Element-wise natural logarithm.",
        description="Returns the natural logarithm (base e) of each element.",
        inputs=["Union[pandas.Series, float, int]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, float]",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Inputs <= 0 produce NaN or -inf."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    # ----- Statistical -------------------------------------------------------

    "percentage_change": CompilerOperationSpec(
        name="percentage_change",
        category="statistical",
        summary="Computes (new - old) / old.",
        description=(
            "Computes percentage change between two values using ((new - old) / old). "
            "Useful for growth rates, returns, and relative changes."
        ),
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, float]",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "First input is the OLD value (denominator); second input is the NEW value (numerator).",
            "If old_value == 0, the operation raises an error (scalar) or yields inf (vector).",
        ],
        example='{"inputs": ["node_old", "node_new"], "params": {}}',
    ),

    "dot_product": CompilerOperationSpec(
        name="dot_product",
        category="statistical",
        summary="Algebraic dot product (inner product) of two vectors.",
        description="Multiplies elements pairwise and sums the result. Useful for weighted sums and projections.",
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=["Both inputs must be vectors of the same length and same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    # ----- Aggregation -------------------------------------------------------

    "mean": CompilerOperationSpec(
        name="mean",
        category="aggregation",
        summary="Arithmetic mean of a vector.",
        description="Reduces a Series to a single float. Result has 'scalar' scope.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "sum": CompilerOperationSpec(
        name="sum",
        category="aggregation",
        summary="Sum of all elements in a vector.",
        description="Reduces a Series to a single numeric value. Result has 'scalar' scope.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "max": CompilerOperationSpec(
        name="max",
        category="aggregation",
        summary="Maximum value in a vector.",
        description="Reduces a Series to its maximum value. Result has 'scalar' scope.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "min": CompilerOperationSpec(
        name="min",
        category="aggregation",
        summary="Minimum value in a vector.",
        description="Reduces a Series to its minimum value. Result has 'scalar' scope.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "nunique": CompilerOperationSpec(
        name="nunique",
        category="aggregation",
        summary="Count of distinct values in a vector.",
        description="Returns the number of distinct elements in the Series.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="int",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "unique": CompilerOperationSpec(
        name="unique",
        category="aggregation",
        summary="Distinct values in a vector (the values themselves).",
        description=(
            "Returns the distinct elements as a vector. Use this when the question asks for the "
            "actual unique values (e.g., 'which countries have data?'). Use `nunique` if only the "
            "count is needed."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "Output index is fresh and does NOT align with the input or any other scope. "
            "Use only as a final/display vector — do not combine element-wise with other vectors.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "mode": CompilerOperationSpec(
        name="mode",
        category="aggregation",
        summary="Most frequent value in a numeric vector.",
        description=(
            "Returns the most common value. If multiple modes exist, returns the first in the distribution."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=[
            "Numeric only: the executor casts the result to float. Calling `mode` on a string/categorical "
            "vector will fail at execution time. For categorical 'most common', use `value_counts` and read the top key.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "median": CompilerOperationSpec(
        name="median",
        category="aggregation",
        summary="Median of a vector.",
        description="Returns the middle value of the sorted distribution.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "std": CompilerOperationSpec(
        name="std",
        category="aggregation",
        summary="Standard deviation of a vector.",
        description="Measures the dispersion of values around the mean (sample std, ddof=1).",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "count": CompilerOperationSpec(
        name="count",
        category="aggregation",
        summary="Number of non-null elements in a vector.",
        description="Returns the count of non-null elements in the Series.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="int",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "value_counts": CompilerOperationSpec(
        name="value_counts",
        category="aggregation",
        summary="Frequency table over the values of a vector (sorted descending).",
        description=(
            "Returns a Series whose index is the distinct values of the input and whose values are "
            "their counts, sorted from most-frequent to least-frequent."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "Output index is the distinct values; output values are their counts. Alignment with "
            "the original input is LOST.",
            "Pair with `index` (integer 0) or `idxmax` to extract the most-frequent value/key.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "idxmax": CompilerOperationSpec(
        name="idxmax",
        category="aggregation",
        summary="Index label of the maximum value.",
        description="Returns the index label corresponding to the maximum value in the input.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="Union[int, str, pandas.Timestamp]",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=[
            "Returns an INDEX LABEL (e.g., a year, a category, a date), NOT the maximum value itself. "
            "For the value, use `max`.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "idxmin": CompilerOperationSpec(
        name="idxmin",
        category="aggregation",
        summary="Index label of the minimum value.",
        description="Returns the index label corresponding to the minimum value in the input.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="Union[int, str, pandas.Timestamp]",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=[
            "Returns an INDEX LABEL (e.g., a year, a category, a date), NOT the minimum value itself. "
            "For the value, use `min`.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    # ----- Ranking -----------------------------------------------------------

    "nlargest": CompilerOperationSpec(
        name="nlargest",
        category="ranking",
        summary="Top n values from a vector (descending).",
        description="Returns the largest n values, sorted descending. Preserves the input's index labels.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={
            "n": "Number of top values to return.",
        },
        param_kinds={"n": "literal_int"},
        required_params=["n"],
        caveats=[
            "If n exceeds the length of the input, the result is silently capped to len(input).",
            "Index labels of the original vector are preserved on the output, but the output is "
            "treated as 'derived' scope — alignment with the original is no longer guaranteed for "
            "downstream element-wise math.",
            "To get the labels (e.g., the top-N category names), pair with `get_index`.",
        ],
        example='{"inputs": ["node_0"], "params": {"n": 5}}',
    ),

    "nsmallest": CompilerOperationSpec(
        name="nsmallest",
        category="ranking",
        summary="Bottom n values from a vector (ascending).",
        description="Returns the smallest n values, sorted ascending. Preserves the input's index labels.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={
            "n": "Number of bottom values to return.",
        },
        param_kinds={"n": "literal_int"},
        required_params=["n"],
        caveats=[
            "If n exceeds the length of the input, the result is silently capped to len(input).",
            "Index labels are preserved but treated as 'derived' scope; pair with `get_index` for labels.",
        ],
        example='{"inputs": ["node_0"], "params": {"n": 5}}',
    ),

    "sort_values": CompilerOperationSpec(
        name="sort_values",
        category="ranking",
        summary="Sort a vector by its values or by its index labels.",
        description=(
            "Returns the input reordered. When `by='values'` (default) sorts by the Series' data values. "
            "When `by='index'` sorts by the Series' index labels — use this after `groupby_agg` to sort "
            "group keys (e.g., month periods, category names) chronologically or alphabetically before "
            "applying `shift`, `diff`, or rolling operations."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={
            "ascending": "If true (default), sort ascending; if false, sort descending.",
            "by": "What to sort by: 'values' (default) sorts by data values; 'index' sorts by index labels.",
        },
        param_kinds={"ascending": "literal_bool", "by": "literal_scalar"},
        caveats=[
            "Output values are the same set as input values, but reordered. Original alignment is lost.",
            "Pair with `head` / `tail` / `index` to pick the first or last K elements.",
            "When applied to a `groupby_agg` result, `by='values'` (default) sorts by aggregated amounts "
            "(e.g., revenue). To sort group keys chronologically or alphabetically (e.g., months, categories), "
            "use `by='index'` instead.",
        ],
        anti_patterns=[
            "DO NOT use `by='values'` (the default) before `shift` / `diff` / `rolling_*` on time-series data — "
            "it sorts by aggregated amounts, not by time. Use `by='index'` to get chronological order.",
        ],
        example='{"inputs": ["node_0"], "params": {"ascending": true, "by": "index"}}',
    ),

    "head": CompilerOperationSpec(
        name="head",
        category="ranking",
        summary="First n elements of a vector.",
        description="Returns the first n elements of the input, preserving their order and index labels.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={
            "n": "Number of leading elements to return.",
        },
        param_kinds={"n": "literal_int"},
        required_params=["n"],
        caveats=[
            "If n exceeds the length of the input, returns all elements.",
            "Pair with `sort_values` first to get a meaningful 'first-by-X' semantic.",
        ],
        example='{"inputs": ["node_0"], "params": {"n": 5}}',
    ),

    "tail": CompilerOperationSpec(
        name="tail",
        category="ranking",
        summary="Last n elements of a vector.",
        description="Returns the last n elements of the input, preserving their order and index labels.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        params={
            "n": "Number of trailing elements to return.",
        },
        param_kinds={"n": "literal_int"},
        required_params=["n"],
        caveats=[
            "If n exceeds the length of the input, returns all elements.",
            "Pair with `sort_values` first to get a meaningful 'last-by-X' semantic.",
        ],
        example='{"inputs": ["node_0"], "params": {"n": 5}}',
    ),

    # ----- Comparison (mask producers) ---------------------------------------

    "eq": CompilerOperationSpec(
        name="eq",
        category="comparison",
        summary="Element-wise equality (==).",
        description="Element-wise equality comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int, str]", "Union[pandas.Series, float, int, str]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "ne": CompilerOperationSpec(
        name="ne",
        category="comparison",
        summary="Element-wise inequality (!=).",
        description="Element-wise inequality comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int, str]", "Union[pandas.Series, float, int, str]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "gt": CompilerOperationSpec(
        name="gt",
        category="comparison",
        summary="Element-wise greater than (>).",
        description="Element-wise > comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "ge": CompilerOperationSpec(
        name="ge",
        category="comparison",
        summary="Element-wise greater than or equal (>=).",
        description="Element-wise >= comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "lt": CompilerOperationSpec(
        name="lt",
        category="comparison",
        summary="Element-wise less than (<).",
        description="Element-wise < comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "le": CompilerOperationSpec(
        name="le",
        category="comparison",
        summary="Element-wise less than or equal (<=).",
        description="Element-wise <= comparison. Produces a boolean mask.",
        inputs=["Union[pandas.Series, float, int]", "Union[pandas.Series, float, int]"],
        input_scope_requirements=["any", "any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Both vector inputs must share the same scope."],
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),

    "between": CompilerOperationSpec(
        name="between",
        category="comparison",
        summary="Element-wise inclusive range check (low <= x <= high).",
        description=(
            "Returns a boolean mask that is True where the input is within [low, high] (inclusive). "
            "Useful for date ranges and numeric bands without needing logical_and."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={
            "low": "Lower bound (inclusive). Same type as the input vector.",
            "high": "Upper bound (inclusive). Same type as the input vector.",
        },
        param_kinds={
            "low": "literal_scalar",
            "high": "literal_scalar",
        },
        required_params=["low", "high"],
        example='{"inputs": ["node_0"], "params": {"low": 100, "high": 500}}',
    ),

    # ----- Logical (mask combinators) ---------------------------------------

    "logical_and": CompilerOperationSpec(
        name="logical_and",
        category="logical",
        summary="Element-wise logical AND of two boolean masks.",
        description=(
            "Combines two boolean masks element-wise. Use to AND multiple conditions together "
            "without merging them into a single `filter_extract.condition` string."
        ),
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="pandas.Series",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=[
            "Both inputs must be boolean masks sharing the same scope.",
        ],
        example='{"inputs": ["node_mask_a", "node_mask_b"], "params": {}}',
    ),

    "logical_or": CompilerOperationSpec(
        name="logical_or",
        category="logical",
        summary="Element-wise logical OR of two boolean masks.",
        description="Combines two boolean masks element-wise to express disjunctive conditions.",
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="pandas.Series",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=[
            "Both inputs must be boolean masks sharing the same scope.",
        ],
        example='{"inputs": ["node_mask_a", "node_mask_b"], "params": {}}',
    ),

    "logical_not": CompilerOperationSpec(
        name="logical_not",
        category="logical",
        summary="Element-wise logical NOT (negation) of a boolean mask.",
        description="Negates each element of the input boolean mask.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={},
        param_kinds={},
        caveats=["Input must be a boolean mask."],
        example='{"inputs": ["node_mask"], "params": {}}',
    ),

    # ----- Predicate (mask producers; non-binary) ----------------------------

    "isnan": CompilerOperationSpec(
        name="isnan",
        category="predicate",
        summary="Boolean mask of missing values.",
        description="Returns a boolean Series where True indicates a missing/NaN value.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "startswith": CompilerOperationSpec(
        name="startswith",
        category="predicate",
        summary="Boolean mask of strings that start with a given prefix.",
        description="Case-sensitive prefix check. Returns a boolean mask.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={
            "prefix": "Literal string prefix to test for (case-sensitive).",
        },
        param_kinds={"prefix": "literal_scalar"},
        required_params=["prefix"],
        example='{"inputs": ["node_0"], "params": {"prefix": "ABC"}}',
    ),

    "isin": CompilerOperationSpec(
        name="isin",
        category="predicate",
        summary="Boolean mask of values contained in a literal list.",
        description="Returns True for each element that appears in the provided literal list (exact match).",
        inputs=["Union[pandas.Series, float, int, str]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, bool]",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={
            "values": "Literal list of values to test membership against (e.g., [\"USA\", \"UK\"]).",
        },
        param_kinds={"values": "literal_list"},
        required_params=["values"],
        example='{"inputs": ["node_0"], "params": {"values": ["USA", "UK"]}}',
    ),

    # ----- Type conversion ---------------------------------------------------

    "to_datetime": CompilerOperationSpec(
        name="to_datetime",
        category="type_conversion",
        summary="Convert strings or numerics to datetimes.",
        description="Converts a vector of strings or numeric values to pandas Timestamps. Format string is optional but recommended for performance and accuracy.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={
            "format": "strftime-style format string (e.g., '%Y-%m-%d').",
        },
        param_kinds={"format": "format_string"},
        example='{"inputs": ["node_0"], "params": {"format": "%Y-%m-%d"}}',
    ),

    "str": CompilerOperationSpec(
        name="str",
        category="type_conversion",
        summary="Convert values to string type.",
        description="Casts each element to its string representation.",
        inputs=["Union[pandas.Series, float, int]"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, str]",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    # ----- Indexing & index inspection --------------------------------------

    "index": CompilerOperationSpec(
        name="index",
        category="indexing",
        summary="Pick element(s) from a vector by position, list of positions, or boolean mask.",
        description=(
            "Selects element(s) from the input vector. The `indices` parameter supports four forms: "
            "(1) a single integer position; (2) a literal list of integer positions; (3) a literal list of "
            "booleans (mask); (4) a node id referencing either an integer-position vector OR a boolean mask "
            "vector. When a boolean mask Series is referenced, its index MUST align with the input vector "
            "(same scope) — otherwise execution fails."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="Union[pandas.Series, float, int, str]",
        output_scope="inherits_from_input",  # Result kind below differentiates scalar vs vector
        result_kind="vector",
        params={
            "indices": (
                "One of: an integer position (e.g., 0), a literal list of integers ([0, 2, 5]), a literal list "
                "of booleans, or a node id (string) referencing a previously-computed mask Series or integer-position "
                "Series."
            ),
        },
        param_kinds={"indices": "node_id"},  # Most expressive form; literal forms also accepted.
        required_params=["indices"],
        caveats=[
            "If `indices` is a single integer, the output is a SCALAR (not a vector). "
            "If `indices` is a list of integers, the output is a Series of length len(indices). "
            "If `indices` is a boolean mask (literal or node id), the output is a Series of variable length.",
            "When `indices` is a node id referencing a boolean MASK Series, the mask's index must "
            "align EXACTLY with the input vector's index (same scope). Mis-aligned masks fail at execution.",
            "When `indices` references a node, do NOT also include that node in `inputs` — it is used only via the parameter.",
        ],
        anti_patterns=[
            "DO NOT pass a node id as `indices` if the node is not a mask or an integer-position list.",
            "DO NOT pass a mask whose scope differs from the data vector's scope.",
        ],
        example='{"inputs": ["node_0"], "params": {"indices": "node_6"}}',
    ),

    "get_index": CompilerOperationSpec(
        name="get_index",
        category="indexing",
        summary="Extract the index labels of a vector as a fresh vector.",
        description=(
            "Returns the index labels of the input as a new Series. Typically used to recover the "
            "names/keys/dates that correspond to a ranked or aggregated result (e.g., the labels of "
            "an `nlargest` output, or the group keys of a `groupby_agg` output)."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="label_vector",
        params={},
        param_kinds={},
        caveats=[
            "The output Series has a FRESH integer index (0, 1, 2, ...). The original index labels "
            "become the output VALUES. As a result, alignment with the input is lost.",
            "Use the result for display / final answer only — do NOT combine it element-wise with the input or other vectors.",
        ],
        anti_patterns=[
            "DO NOT use `get_index` to perform element-wise math on labels and values from the same source.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    # ----- Date / Time Component Extraction ---------------------------------

    "extract_year": CompilerOperationSpec(
        name="extract_year",
        category="datetime",
        summary="Extract the year component from a datetime vector.",
        description=(
            "Returns an integer vector of year values (e.g., 2010, 2011). "
            "Input MUST be a datetime Series (use `to_datetime` first if needed). "
            "Output scope inherits from the input."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype. Apply `to_datetime` before this op if the column is stored as strings."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "extract_month": CompilerOperationSpec(
        name="extract_month",
        category="datetime",
        summary="Extract the month component (1–12) from a datetime vector.",
        description=(
            "Returns an integer vector of month values (1 = January … 12 = December). "
            "Input MUST be a datetime Series. Output scope inherits from the input. "
            "Use the result as a `groupby_columns` entry in `groupby_agg` for monthly grouping."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "extract_day": CompilerOperationSpec(
        name="extract_day",
        category="datetime",
        summary="Extract the day-of-month (1–31) from a datetime vector.",
        description="Returns an integer vector of day-of-month values. Input must be datetime dtype.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "extract_dayofweek": CompilerOperationSpec(
        name="extract_dayofweek",
        category="datetime",
        summary="Extract the day of the week (0=Monday … 6=Sunday) from a datetime vector.",
        description=(
            "Returns an integer vector where 0 = Monday, 1 = Tuesday, …, 5 = Saturday, 6 = Sunday. "
            "Use `isin` with `[0,1,2,3,4]` to select weekdays; `[5,6]` for weekends. "
            "Input must be datetime dtype."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype. 0=Monday, 6=Sunday (ISO convention)."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "extract_week": CompilerOperationSpec(
        name="extract_week",
        category="datetime",
        summary="Extract the ISO week number (1–53) from a datetime vector.",
        description="Returns an integer vector of ISO week numbers. Input must be datetime dtype.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "extract_quarter": CompilerOperationSpec(
        name="extract_quarter",
        category="datetime",
        summary="Extract the quarter (1–4) from a datetime vector.",
        description=(
            "Returns an integer vector of quarter values (1=Q1, 2=Q2, 3=Q3, 4=Q4). "
            "Use `isin` with `[1]` to filter Q1, etc. Input must be datetime dtype."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Input must be datetime dtype."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "truncate_to": CompilerOperationSpec(
        name="truncate_to",
        category="datetime",
        summary="Truncate a datetime vector to the start of the specified calendar period.",
        description=(
            "Returns a datetime vector where each timestamp is snapped to the start of its "
            "enclosing period (day, week, month, or quarter). Useful as a `groupby_columns` key "
            "for time-bucketed aggregations. Input must be datetime dtype."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={
            "unit": "Calendar period to truncate to. One of: 'day', 'week', 'month', 'quarter'.",
        },
        param_kinds={"unit": "literal_scalar"},
        required_params=["unit"],
        caveats=[
            "Input must be datetime dtype.",
            "Week truncation snaps to Monday of the ISO week.",
            "The output values are pandas Period objects (e.g. '2010-01' for month, '2010Q1' for quarter), "
            "NOT timestamps or integers. They are orderable and usable as groupby_agg keys.",
        ],
        example='{"inputs": ["node_0"], "params": {"unit": "month"}}',
    ),

    # ----- Conditional Aggregation ------------------------------------------

    "count_if": CompilerOperationSpec(
        name="count_if",
        category="conditional_aggregation",
        summary="Count the number of True values in a boolean mask.",
        description=(
            "Reduces a boolean mask Series to a single integer count of True values. "
            "Equivalent to `filter_extract → count` but in a single node. "
            "Result has 'scalar' scope."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="int",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=["Input must be a boolean mask Series."],
        example='{"inputs": ["node_mask"], "params": {}}',
    ),

    "sum_if": CompilerOperationSpec(
        name="sum_if",
        category="conditional_aggregation",
        summary="Sum a value vector only where a boolean mask is True.",
        description=(
            "Takes two inputs: a numeric value vector and a boolean mask vector. "
            "Sums only those values where the mask is True. Both inputs MUST share the same scope. "
            "Result has 'scalar' scope. Equivalent to `index(values, mask) → sum` in fewer nodes."
        ),
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=[
            "First input is the VALUES vector; second input is the boolean MASK.",
            "Both inputs must share the same non-scalar scope (same row alignment).",
        ],
        example='{"inputs": ["node_values", "node_mask"], "params": {}}',
    ),

    "mean_if": CompilerOperationSpec(
        name="mean_if",
        category="conditional_aggregation",
        summary="Average a value vector only where a boolean mask is True.",
        description=(
            "Takes two inputs: a numeric value vector and a boolean mask vector. "
            "Computes the mean of values where the mask is True. Both inputs MUST share the same scope. "
            "Result has 'scalar' scope."
        ),
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={},
        param_kinds={},
        caveats=[
            "First input is the VALUES vector; second input is the boolean MASK.",
            "Both inputs must share the same non-scalar scope.",
        ],
        example='{"inputs": ["node_values", "node_mask"], "params": {}}',
    ),

    # ----- Percentile / Quantile --------------------------------------------

    "quantile": CompilerOperationSpec(
        name="quantile",
        category="statistical",
        summary="Compute the q-th quantile of a vector (q in [0, 1]).",
        description=(
            "Reduces a vector to the value at the q-th quantile using linear interpolation. "
            "q=0.5 is the median; q=0.9 is the 90th percentile. Result has 'scalar' scope."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="float",
        output_scope="scalar",
        result_kind="scalar",
        params={
            "q": "Quantile level as a float in [0, 1]. E.g., 0.5 for median, 0.9 for 90th percentile.",
        },
        param_kinds={"q": "literal_scalar"},
        required_params=["q"],
        caveats=["q must be a float between 0 and 1 inclusive."],
        example='{"inputs": ["node_0"], "params": {"q": 0.9}}',
    ),

    "percentile_rank": CompilerOperationSpec(
        name="percentile_rank",
        category="statistical",
        summary="Per-element percentile rank in [0, 1] within the vector.",
        description=(
            "Returns a float vector where each element is the fraction of values in the input "
            "that are less than or equal to it (i.e., its percentile rank). "
            "Equivalent to pandas rank(pct=True). Output scope inherits from the input."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "Result values are in [0, 1]. Use `ge` / `le` comparisons against a threshold to filter "
            "elements above or below a percentile boundary.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    # ----- Rank / Cumulative ------------------------------------------------

    "rank": CompilerOperationSpec(
        name="rank",
        category="ranking",
        summary="Assign an integer rank to each element within a vector.",
        description=(
            "Returns an integer vector of ranks. By default ascending=True (rank 1 = smallest value). "
            "Ties receive the minimum rank of the tied group (method='min'). "
            "Output scope inherits from the input."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={
            "ascending": "If true (default), rank 1 is the smallest value. If false, rank 1 is the largest.",
        },
        param_kinds={"ascending": "literal_bool"},
        caveats=["Ranks start at 1, not 0."],
        example='{"inputs": ["node_0"], "params": {"ascending": false}}',
    ),

    "cumsum": CompilerOperationSpec(
        name="cumsum",
        category="ranking",
        summary="Cumulative sum of a vector (running total).",
        description=(
            "Returns a vector where each element is the sum of all elements up to and including "
            "that position. The vector must already be in the desired order (sort first if needed). "
            "Output scope inherits from the input."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=["Sort the input with `sort_values` before applying `cumsum` if order matters."],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "cumshare": CompilerOperationSpec(
        name="cumshare",
        category="ranking",
        summary="Cumulative share of total: running sum divided by the overall sum.",
        description=(
            "Returns a float vector in [0, 1] where each element is the fraction of the grand total "
            "accumulated up to and including that position. Useful for Pareto / 80-20 analysis. "
            "The vector must already be in the desired order. "
            "Output scope inherits from the input."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={},
        param_kinds={},
        caveats=[
            "Sort descending first (sort_values ascending=False) before applying cumshare for a standard "
            "Pareto curve.",
            "If the total is zero, the result will contain NaN / inf values.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),

    "dropna": CompilerOperationSpec(
        name="dropna",
        category="type_conversion",
        summary="Drops NaN values from a series.",
        description=(
            "Removes all NaN/null elements and returns the remaining values. "
            "The resulting Series has a shorter index that no longer aligns with the original source. "
            "Use only as a final cleaning step or before a scalar aggregation."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="derived",
        result_kind="vector",
        caveats=[
            "Row alignment with the original input is LOST after dropna. Do NOT combine the result "
            "element-wise with any source-aligned or filtered vector.",
        ],
        example='{"inputs": ["node_0"], "params": {}}',
    ),
    "fillna": CompilerOperationSpec(
        name="fillna",
        category="type_conversion",
        summary="Fills NaN values with a constant.",
        description="Replaces missing values with constant.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"value": "Fill value"},
        param_kinds={"value": "literal_scalar"},
        required_params=["value"],
        example='{"inputs": ["node_0"], "params": {"value": 0}}',
    ),
    "contains": CompilerOperationSpec(
        name="contains",
        category="predicate",
        summary="Substring match.",
        description="Produces a boolean mask where string contains the target.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="mask",
        params={"substring": "Target substring", "case": "Case sensitive?"},
        param_kinds={"substring": "literal_scalar", "case": "literal_bool"},
        required_params=["substring"],
        example='{"inputs": ["node_0"], "params": {"substring": "apple", "case": false}}',
    ),
    "lower": CompilerOperationSpec(
        name="lower",
        category="type_conversion",
        summary="Converts strings to lowercase.",
        description="Lowercase all strings.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        example='{"inputs": ["node_0"], "params": {}}',
    ),
    "upper": CompilerOperationSpec(
        name="upper",
        category="type_conversion",
        summary="Converts strings to uppercase.",
        description="Uppercase all strings.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        example='{"inputs": ["node_0"], "params": {}}',
    ),
    "concat_str": CompilerOperationSpec(
        name="concat_str",
        category="arithmetic",
        summary="Concatenate two string vectors.",
        description="String concat element-wise.",
        inputs=["pandas.Series", "Union[pandas.Series, str]"],
        input_scope_requirements=["any", "any"],
        output="pandas.Series",
        output_scope="inherits_from_inputs",
        result_kind="vector",
        example='{"inputs": ["node_0", "node_1"], "params": {}}',
    ),
    "isin_from_node": CompilerOperationSpec(
        name="isin_from_node",
        category="predicate",
        summary="Filter values based on dynamic list generated by another node.",
        description="Produces boolean mask where items in target exist in the dynamic set calculated by another node.",
        inputs=["pandas.Series", "pandas.Series"],
        input_scope_requirements=["any", "any"],
        output="pandas.Series",
        output_scope="inherits_from_inputs",
        result_kind="mask",
        example='{"inputs": ["node_target", "node_set"], "params": {}}',
    ),
    "timedelta_to_days": CompilerOperationSpec(
        name="timedelta_to_days",
        category="datetime",
        summary="Converts timedeltas to float days.",
        description="Divides total seconds by 86400.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        example='{"inputs": ["node_0"], "params": {}}',
    ),
    "date_add": CompilerOperationSpec(
        name="date_add",
        category="datetime",
        summary="Add offset to date.",
        description="Adds a specified amount of days/months/years.",
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"amount": "Amount to add", "unit": "'days', 'months', or 'years'"},
        param_kinds={"amount": "literal_int", "unit": "literal_scalar"},
        required_params=["amount", "unit"],
        example='{"inputs": ["node_0"], "params": {"amount": 7, "unit": "days"}}',
    ),
    "shift": CompilerOperationSpec(
        name="shift",
        category="ranking",
        summary="Shift a series by N positions to obtain lagged or lead values.",
        description=(
            "Offsets the Series by `periods` positions. Positive periods produce a lag (previous values); "
            "negative periods produce a lead (future values). The first `periods` elements become NaN. "
            "The operation is purely positional — it DOES NOT know about dates or group keys."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"periods": "Number of positions to shift (positive = lag, negative = lead)."},
        param_kinds={"periods": "literal_int"},
        caveats=[
            "The input MUST already be sorted in the desired order before applying shift. "
            "For time-series data from groupby_agg, apply sort_values(by='index', ascending=True) first "
            "to ensure chronological order. Skipping the sort step produces temporally meaningless lags.",
        ],
        example='{"inputs": ["node_0"], "params": {"periods": 1}}',
    ),
    "diff": CompilerOperationSpec(
        name="diff",
        category="ranking",
        summary="Absolute difference between each element and the element N positions earlier.",
        description=(
            "Computes element[i] - element[i - periods]. The first `periods` elements become NaN. "
            "The operation is purely positional — it DOES NOT know about dates or group keys."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"periods": "Number of positions to look back (default 1)."},
        param_kinds={"periods": "literal_int"},
        caveats=[
            "The input MUST already be sorted in the desired order before applying diff. "
            "For time-series data from groupby_agg, apply sort_values(by='index', ascending=True) first.",
        ],
        example='{"inputs": ["node_0"], "params": {"periods": 1}}',
    ),
    "rolling_mean": CompilerOperationSpec(
        name="rolling_mean",
        category="ranking",
        summary="Moving average over a sliding window of N consecutive rows.",
        description=(
            "Returns a vector where each element is the mean of the preceding `window` elements "
            "(including the current one). Uses min_periods=1 so partial windows at the start are included."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"window": "Number of rows per window."},
        param_kinds={"window": "literal_int"},
        required_params=["window"],
        caveats=[
            "The input MUST already be sorted in the desired order before applying rolling_mean. "
            "For time-series data from groupby_agg, apply sort_values(by='index', ascending=True) first.",
        ],
        example='{"inputs": ["node_0"], "params": {"window": 3}}',
    ),
    "rolling_sum": CompilerOperationSpec(
        name="rolling_sum",
        category="ranking",
        summary="Moving sum over a sliding window of N consecutive rows.",
        description=(
            "Returns a vector where each element is the sum of the preceding `window` elements "
            "(including the current one). Uses min_periods=1 so partial windows at the start are included."
        ),
        inputs=["pandas.Series"],
        input_scope_requirements=["any"],
        output="pandas.Series",
        output_scope="inherits_from_input",
        result_kind="vector",
        params={"window": "Number of rows per window."},
        param_kinds={"window": "literal_int"},
        required_params=["window"],
        caveats=[
            "The input MUST already be sorted in the desired order before applying rolling_sum. "
            "For time-series data from groupby_agg, apply sort_values(by='index', ascending=True) first.",
        ],
        example='{"inputs": ["node_0"], "params": {"window": 3}}',
    ),
}


# ---------------------------------------------------------------------------
# VALIDATOR REGISTRY (derived from the compiler registry)
# ---------------------------------------------------------------------------

VALIDATOR_REGISTRY: Dict[str, ValidatorOperationSpec] = {
    name: ValidatorOperationSpec(
        name=spec.name,
        inputs=spec.inputs,
        required_params=spec.required_params,
    )
    for name, spec in COMPILER_REGISTRY.items()
}

# Legacy support — kept so older callers (e.g., translator.py) keep working.
OPERATION_REGISTRY = COMPILER_REGISTRY


# ---------------------------------------------------------------------------
# Operation Graph Grammar
# ---------------------------------------------------------------------------

_PORT_NAMES: Dict[str, List[str]] = {
    # Binary semantic order matters.
    "add": ["left", "right"],
    "subtract": ["left", "right"],
    "multiply": ["left", "right"],
    "divide": ["numerator", "denominator"],
    "pow": ["base", "exponent"],
    "percentage_change": ["old", "new"],
    "dot_product": ["left_vector", "right_vector"],
    "eq": ["left", "right"],
    "ne": ["left", "right"],
    "gt": ["left", "right"],
    "ge": ["left", "right"],
    "lt": ["left", "right"],
    "le": ["left", "right"],
    "logical_and": ["left_mask", "right_mask"],
    "logical_or": ["left_mask", "right_mask"],
    "concat_str": ["left", "right"],
    "isin_from_node": ["target", "values_set"],
    "sum_if": ["values", "mask"],
    "mean_if": ["values", "mask"],

    # Unary operations.
    "abs": ["values"],
    "round": ["values"],
    "sqrt": ["values"],
    "log": ["values"],
    "mean": ["values"],
    "sum": ["values"],
    "max": ["values"],
    "min": ["values"],
    "nunique": ["values"],
    "unique": ["values"],
    "mode": ["values"],
    "median": ["values"],
    "std": ["values"],
    "count": ["values"],
    "value_counts": ["values"],
    "idxmax": ["values"],
    "idxmin": ["values"],
    "nlargest": ["values"],
    "nsmallest": ["values"],
    "sort_values": ["values"],
    "head": ["values"],
    "tail": ["values"],
    "index": ["values"],
    "get_index": ["values"],
    "to_datetime": ["values"],
    "str": ["values"],
    "lower": ["values"],
    "upper": ["values"],
    "isnan": ["values"],
    "startswith": ["values"],
    "contains": ["values"],
    "isin": ["values"],
    "between": ["values"],
    "logical_not": ["mask"],
    "extract_year": ["datetimes"],
    "extract_month": ["datetimes"],
    "extract_day": ["datetimes"],
    "extract_dayofweek": ["datetimes"],
    "extract_week": ["datetimes"],
    "extract_quarter": ["datetimes"],
    "truncate_to": ["datetimes"],
    "timedelta_to_days": ["timedeltas"],
    "date_add": ["datetimes"],
    "count_if": ["mask"],
    "quantile": ["values"],
    "percentile_rank": ["values"],
    "rank": ["values"],
    "cumsum": ["values"],
    "cumshare": ["values"],
    "shift": ["values"],
    "diff": ["values"],
    "rolling_mean": ["values"],
    "rolling_sum": ["values"],
    "dropna": ["values"],
    "fillna": ["values"],
}

_INDEX_LINEAGE_BY_SCOPE: Dict[str, str] = {
    "scalar": "none",
    "global": "source_aligned",
    "filtered": "filtered_source_aligned",
    "grouped": "group_key_indexed",
    "inherits_from_input": "preserved_from_input",
    "inherits_from_inputs": "preserved_from_common_input",
    "derived": "fresh_or_reordered_index",
}

_MASK_CONSUMERS = [
    "index.params.indices",
    "logical_and.left_mask",
    "logical_and.right_mask",
    "logical_or.left_mask",
    "logical_or.right_mask",
    "logical_not.mask",
    "count_if.mask",
    "sum_if.mask",
    "mean_if.mask",
]

_VECTOR_CONSUMERS = [
    "add.left",
    "add.right",
    "subtract.left",
    "subtract.right",
    "multiply.left",
    "multiply.right",
    "divide.numerator",
    "divide.denominator",
    "eq.left",
    "eq.right",
    "ne.left",
    "ne.right",
    "gt.left",
    "gt.right",
    "ge.left",
    "ge.right",
    "lt.left",
    "lt.right",
    "le.left",
    "le.right",
    "sum.values",
    "mean.values",
    "count.values",
    "max.values",
    "min.values",
    "median.values",
    "std.values",
    "quantile.values",
    "sort_values.values",
    "nlargest.values",
    "nsmallest.values",
    "get_index.values",
    "index.values",
    "sum_if.values",
    "mean_if.values",
    "groupby_agg.params.agg_column",
]


def _accepted_kinds_for_port(op_name: str, port_name: str, spec: CompilerOperationSpec) -> List[str]:
    if "mask" in port_name or op_name == "count_if":
        return ["mask"]
    if op_name in {"logical_and", "logical_or", "logical_not"}:
        return ["mask"]
    if op_name in {"sum_if", "mean_if"} and port_name == "mask":
        return ["mask"]
    if op_name in {"sum_if", "mean_if"} and port_name == "values":
        return ["vector"]
    if op_name in {"mean", "sum", "max", "min", "nunique", "unique", "mode", "median", "std",
                   "count", "value_counts", "nlargest", "nsmallest", "sort_values", "head",
                   "tail", "index", "get_index", "quantile", "percentile_rank", "rank",
                   "cumsum", "cumshare", "shift", "diff", "rolling_mean", "rolling_sum"}:
        return ["vector"]
    if op_name in {"eq", "ne", "gt", "ge", "lt", "le"}:
        return ["scalar", "vector"]
    if op_name in {"add", "subtract", "multiply", "divide", "pow", "percentage_change"}:
        return ["scalar", "vector"]
    if op_name == "dot_product":
        return ["vector"]
    return ["vector", "scalar", "mask"]


def _scope_rule_for_port(op_name: str, port_name: str, spec: CompilerOperationSpec) -> str:
    if op_name in {"sum_if", "mean_if"}:
        return "same_scope_as_other_input"
    if op_name == "count_if":
        return "any_mask_scope"
    if op_name in {"logical_and", "logical_or"}:
        return "same_mask_scope_as_other_input"
    if op_name in {"add", "subtract", "multiply", "divide", "pow", "percentage_change",
                   "eq", "ne", "gt", "ge", "lt", "le", "concat_str"}:
        return "same_non_scalar_scope_or_scalar"
    return (spec.input_scope_requirements or ["any"])[0] if spec.input_scope_requirements else "any"


def _build_contract(name: str, spec: CompilerOperationSpec) -> OperationContract:
    port_names = _PORT_NAMES.get(name, [f"input_{i}" for i in range(len(spec.inputs))])
    input_ports: List[InputPort] = []
    for idx, input_type in enumerate(spec.inputs):
        port_name = port_names[idx] if idx < len(port_names) else f"input_{idx}"
        input_ports.append(
            InputPort(
                name=port_name,
                accepted_kinds=_accepted_kinds_for_port(name, port_name, spec),
                accepted_types=[input_type],
                scope_rule=_scope_rule_for_port(name, port_name, spec),
            )
        )

    params = [
        ParamContract(
            name=param_name,
            kind=(spec.param_kinds or {}).get(param_name, "literal_scalar"),
            required=bool(spec.required_params and param_name in spec.required_params),
            description=param_desc,
        )
        for param_name, param_desc in spec.params.items()
    ]

    valid_consumers = list(_MASK_CONSUMERS if spec.result_kind == "mask" else _VECTOR_CONSUMERS)
    if spec.result_kind == "scalar":
        valid_consumers = [
            "add.left", "add.right", "subtract.left", "subtract.right",
            "multiply.left", "multiply.right", "divide.numerator", "divide.denominator",
            "eq.left", "eq.right", "ne.left", "ne.right", "gt.left", "gt.right",
            "ge.left", "ge.right", "lt.left", "lt.right", "le.left", "le.right",
            "load_constant.params.value",
        ]
    elif spec.result_kind == "label_vector":
        valid_consumers = ["index.values", "final_output"]

    forbidden_consumers = []
    if spec.output_scope == "grouped":
        forbidden_consumers.append("groupby_agg.params.agg_column")
    if spec.output_scope == "derived":
        forbidden_consumers.extend([
            "add.*", "subtract.*", "multiply.*", "divide.*", "groupby_agg.params.agg_column"
        ])

    return OperationContract(
        name=name,
        category=spec.category,
        summary=spec.summary,
        input_ports=input_ports,
        params=params,
        output=OutputContract(
            kind=spec.result_kind,
            output_type=spec.output,
            scope_rule=spec.output_scope,
            index_lineage=_INDEX_LINEAGE_BY_SCOPE.get(spec.output_scope, "preserved"),
            description=spec.description,
        ),
        valid_consumers=valid_consumers,
        forbidden_consumers=forbidden_consumers,
        canonical_patterns=spec.caveats + spec.anti_patterns,
    )


OPERATION_CONTRACTS: Dict[str, OperationContract] = {
    name: _build_contract(name, spec)
    for name, spec in COMPILER_REGISTRY.items()
}


def get_input_port_order(op_name: str) -> List[str]:
    """Return the named-port order used when lowering to positional inputs."""
    contract = OPERATION_CONTRACTS.get(op_name)
    if not contract:
        return []
    return [port.name for port in contract.input_ports]


def lower_named_port_graph(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a named-port graph draft to the executor's current positional ComputationGraph.

    This is the deterministic bridge between the compiler-facing graph grammar and
    the runtime schema. If a graph already uses positional `inputs`, it is normalized
    and returned unchanged apart from dropping compiler-only fields such as `why`.
    """
    lowered_nodes: List[Dict[str, Any]] = []
    for node in graph.get("nodes", []):
        op_name = node.get("op")
        raw_inputs = node.get("inputs", [])
        if isinstance(raw_inputs, dict):
            port_order = get_input_port_order(op_name)
            missing = [port for port in port_order if port not in raw_inputs]
            extra = [port for port in raw_inputs if port not in port_order]
            if missing or extra:
                raise ValueError(
                    f"Named-port input mismatch for node '{node.get('id')}' ({op_name}): "
                    f"missing={missing}, extra={extra}, expected_order={port_order}"
                )
            inputs = [raw_inputs[port] for port in port_order]
        elif isinstance(raw_inputs, list):
            inputs = raw_inputs
        else:
            raise ValueError(
                f"Node '{node.get('id')}' ({op_name}) inputs must be a dict of named ports or a positional list."
            )

        lowered_nodes.append({
            "id": node.get("id"),
            "op": op_name,
            "params": node.get("params", {}),
            "inputs": inputs,
        })

    return {
        "graph_id": graph.get("graph_id"),
        "nodes": lowered_nodes,
        "output_node": graph.get("output_node"),
    }


def render_operation_graph_grammar(ops: Optional[List[str]] = None) -> str:
    """Render the machine-readable graph grammar as compact prompt documentation."""
    names = ops or list(OPERATION_CONTRACTS.keys())
    lines: List[str] = [
        "# OPERATION GRAPH GRAMMAR",
        "",
        "Use named input ports while drafting graphs. The compiler service lowers them to positional inputs.",
        "A node may only consume another node through a compatible port. Scopes must obey each port's `scope_rule`.",
        "",
        "## Scope Rules",
        "- `scalar` broadcasts to any scope.",
        "- `global` vectors combine only with `global` vectors or scalars.",
        "- `filtered` vectors combine only with the same filtered condition or scalars.",
        "- `grouped` vectors combine only with grouped vectors using the same group keys or scalars.",
        "- `derived` vectors are for final/display/ranking paths and must not feed element-wise math unless explicitly allowed.",
        "- Boolean masks may only filter/index vectors with the same scope.",
        "",
        "## Operation Contracts",
    ]
    for name in names:
        contract = OPERATION_CONTRACTS.get(name)
        if not contract:
            continue
        lines.append(f"### {contract.name}")
        lines.append(f"- category: `{contract.category}`")
        lines.append(f"- summary: {contract.summary}")
        if contract.input_ports:
            for port in contract.input_ports:
                lines.append(
                    f"- input port `{port.name}`: kinds={port.accepted_kinds}; "
                    f"types={port.accepted_types}; scope_rule=`{port.scope_rule}`"
                )
        else:
            lines.append("- input ports: none")
        if contract.params:
            for param in contract.params:
                req = "required" if param.required else "optional"
                lines.append(f"- param `{param.name}`: kind=`{param.kind}`; {req}")
        else:
            lines.append("- params: none")
        lines.append(
            f"- output: kind=`{contract.output.kind}`; type=`{contract.output.output_type}`; "
            f"scope_rule=`{contract.output.scope_rule}`; index_lineage=`{contract.output.index_lineage}`"
        )
        if contract.forbidden_consumers:
            lines.append(f"- forbidden consumers: {contract.forbidden_consumers}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Concept blocks (rendered into the prompt as ground-truth vocabulary)
# ---------------------------------------------------------------------------

CONCEPTS_BLOCK = """## CONCEPTS

The compiler reasons about each node in terms of three orthogonal properties: its **scope**,
its **result kind**, and the **kind of every parameter**. Use this vocabulary literally.

### Output scopes (one per node)
- `scalar` — a single broadcast-neutral value. Combines freely with ANY other scope.
- `global` — a vector aligned to ALL source rows.
- `filtered` — a vector aligned to the source rows selected by a specific condition string. Two
  `filtered` vectors share scope ONLY if produced with the EXACT same condition string.
- `grouped` — a vector indexed by the group keys of a `groupby_agg`. Two `grouped` vectors share
  scope ONLY if grouped by the same column.
- `inherits_from_input` / `inherits_from_inputs` — the node's scope is its input's scope.
  For multi-input ops, all non-`scalar` inputs MUST share the same scope.
- `derived` — alignment is lost. The result is a vector but its index no longer aligns with
  any other scope. CANNOT be combined element-wise with any other vector.

### Result kinds (what a downstream consumer should expect)
- `scalar` — a single value (number, string, timestamp).
- `vector` — a series of values aligned to its scope.
- `mask` — a boolean series, intended to be consumed by `index` or by `logical_and` / `logical_or` / `logical_not`.
- `label_vector` — a vector of labels (e.g., index labels). Use for display only; do NOT combine element-wise with values.

### Parameter kinds (how to fill each parameter)
- `source_column` — a raw column-name string from the source table (NEVER a node id).
- `node_id` — a string referencing another node id in the graph.
- `column_or_node` — either a raw source-column name OR a node id.
- `literal_scalar` / `literal_list` / `literal_int` / `literal_bool` — a literal value, NOT a node id.
- `agg_function` — one of the supported aggregation strings (see `groupby_agg.params.agg_function`).
- `condition` — a pandas eval/query-style boolean expression (see "Condition syntax" below).
- `format_string` — a strftime-style format string.

### Condition syntax (used by `filter_extract.condition`)
- The expression must be a single boolean expression in pandas .eval / .query syntax.
- Allowed: `==`, `!=`, `<`, `<=`, `>`, `>=`, `&`, `|`, `~`, `+`, `-`, `*`, `/`, parentheses,
  numeric/string literals, comma-separated lists `[ ]`, alphanumerics and underscores.
- Column names containing spaces or special characters MUST be wrapped in backticks
  (e.g., `` `Order Date` > '2023-01-01' ``).
- String literals must be quoted (single or double).
- Disallowed: any non-listed character, or any of the keywords `import`, `exec`, `eval`,
  `lambda`, `__`, `globals`, `locals`, `open(`, `system(`. The validator rejects them.

### Source-column vs. node-id (critical distinction)
Some parameters take a raw source column name (e.g., `filter_extract.column`,
`groupby_agg.groupby_column`); others can take EITHER a column name OR a node id
(e.g., `groupby_agg.agg_column`); others take ONLY a node id (e.g., `index.indices` when
referencing a mask). ALWAYS check each parameter's `kind` before filling it. NEVER pre-extract
a column with `filter_extract` only to feed it to a parameter that expects a raw column name —
the result is an unused node, which is a critical failure.
"""


RECIPES_BLOCK = """## RECIPES (canonical compositions)

Use these as templates for common patterns. Each line lists the operation chain only.

- Filtered total / filtered mean:
    filter_extract(col=X, condition=C)  ->  sum / mean
- Top-N values, with their labels:
    filter_extract(col=X) [+ groupby_agg if needed]  ->  nlargest(n=N)  ->  get_index   # labels
                                                                       ->  (the nlargest itself) # values
- Multi-condition filter using mask combinators:
    filter_extract(col=X, condition=C1)              # global mask base
    mask_a = gt / lt / eq / startswith / isin / between (...)   # all in SAME scope
    mask_b = gt / lt / eq / startswith / isin / between (...)
    combined = logical_and(mask_a, mask_b)
    index(values_node, indices=combined)
- Per-group aggregate then global aggregate:
    groupby_agg(groupby_column=G, agg_column=X, agg_function=F)  ->  max / min / mean / idxmax / idxmin
- Year-over-year change using two filtered totals:
    a = filter_extract(col=X, condition="year == OLD") -> sum
    b = filter_extract(col=X, condition="year == NEW") -> sum
    percentage_change(a, b)        # both inputs are scalars, broadcast-neutral
- Month-over-month growth rate (shifted):
    months = filter_extract(DateCol) -> to_datetime -> truncate_to(month)
    rev = filter_extract(Qty) * filter_extract(Price)
    monthly_rev = groupby_agg(groupby_columns=[months], agg_column=rev, agg_function='sum')
    sorted_monthly = sort_values(monthly_rev)
    prev_monthly = shift(sorted_monthly, periods=1)
    percentage_change(prev_monthly, sorted_monthly)
- 7-day rolling average:
    days = filter_extract(DateCol) -> to_datetime -> truncate_to(day)
    rev = filter_extract(Qty) * filter_extract(Price)
    daily_rev = groupby_agg(groupby_columns=[days], agg_column=rev, agg_function='sum')
    sorted_daily = sort_values(daily_rev)
    rolling_mean(sorted_daily, window=7)
- Pareto / 80-20 cumulative share:
    revenue_by_product = groupby_agg(groupby_column=StockCode, agg_column=..., agg_function='sum')
    sorted_rev = sort_values(revenue_by_product, ascending=False)
    cumshare(sorted_rev)   # running fraction; find where it crosses 0.8
- Customers above the 90th percentile of spend:
    spend_per_customer = groupby_agg(groupby_column="Customer ID", agg_column=..., agg_function='sum')
    threshold = quantile(spend_per_customer, q=0.9)
    mask = gt(spend_per_customer, threshold)
    count_if(mask)
- Difference from average:
    vals = filter_extract(col=X)
    subtract(vals, mean(vals))
"""




PRE_OUTPUT_REMINDER = """## PRE-OUTPUT CHECKS (mandatory)

Before returning the JSON graph, verify each item in this list:

1. Every node id is referenced by another node OR is `output_node` (no orphans).
2. Every `[REQUIRED]` parameter is present in `params` for every node.
3. For each node, its `param_kinds` are respected: a `source_column` parameter has a raw column
   name; a `node_id` parameter has a node id; a literal parameter has a literal value.
4. For every multi-input op, all non-`scalar` inputs share the same scope (see "Output scopes").
5. No node consumes a `derived` vector for element-wise math against another scope.
6. No `groupby_agg` is fed an already-grouped vector as `agg_column`.
"""


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _render_op_block(spec: CompilerOperationSpec, deep: bool = False) -> str:
    """Render a single operation entry in a compact tabular-like format."""
    lines: List[str] = []
    lines.append(f"### {spec.name}")
    lines.append(f"- **Summary**: {spec.summary}")
    
    # Combined Kind/Type/Scope info
    ports_info = []
    if not spec.inputs:
        ports_info.append("Inputs: NONE")
    else:
        zipped = list(zip(spec.inputs, spec.input_scope_requirements or ["any"] * len(spec.inputs)))
        input_str = ", ".join(f"{t}({s})" for t, s in zipped)
        ports_info.append(f"Inputs: {input_str}")
    
    ports_info.append(f"Output: {spec.output}({spec.output_scope})")
    ports_info.append(f"Kind: {spec.result_kind}")
    lines.append("- " + " | ".join(ports_info))

    # Parameters
    if spec.params:
        p_lines = []
        for p_name, p_desc in spec.params.items():
            is_req = bool(spec.required_params and p_name in spec.required_params)
            req_tag = "!" if is_req else "?" # ! for required, ? for optional
            kind = (spec.param_kinds or {}).get(p_name, "literal")
            p_lines.append(f"`{p_name}`{req_tag}({kind}): {p_desc}")
        lines.append("- **Params**: " + " ; ".join(p_lines))

    # Behavior & Caveats (only essential)
    if deep or spec.caveats or spec.anti_patterns:
        content = []
        if deep: content.append(f"Behavior: {spec.description}")
        if spec.caveats: content.append("Caveats: " + " ".join(spec.caveats))
        if spec.anti_patterns: content.append("Avoid: " + " ".join(spec.anti_patterns))
        if content:
            lines.append("- **Details**: " + " | ".join(content))

    lines.append(f"- **Example**: `{spec.example}`")
    return "\n".join(lines)



def _ops_by_category() -> Dict[str, List[CompilerOperationSpec]]:
    """Group registry entries by category, preserving registry order within each group."""
    grouped: Dict[str, List[CompilerOperationSpec]] = {cat: [] for cat in CATEGORY_ORDER}
    for spec in COMPILER_REGISTRY.values():
        grouped.setdefault(spec.category, []).append(spec)
    return grouped


def render_generation_view() -> str:
    """
    View 1 — Generation-time (standard).
    Provides a shared concept block, recipes, and per-category operation specs.
    """
    parts: List[str] = []
    parts.append("# AVAILABLE OPERATIONS\n")
    parts.append(
        "You MUST ONLY use the operations listed below. Adhere strictly to their parameter "
        "requirements, scope rules, and behavioral constraints.\n"
    )
    parts.append(CONCEPTS_BLOCK)
    parts.append(RECIPES_BLOCK)
    parts.append(PRE_OUTPUT_REMINDER)
    parts.append("## OPERATIONS\n")


    grouped = _ops_by_category()
    for cat in CATEGORY_ORDER:
        ops = grouped.get(cat) or []
        if not ops:
            continue
        parts.append(f"### Category: {CATEGORY_LABEL.get(cat, cat)}\n")
        for spec in ops:
            parts.append(_render_op_block(spec, deep=False))
            parts.append("")  # blank line between ops

    return "\n".join(parts)


def render_correction_view(implicated_ops: List[str]) -> str:
    """
    View 2 — Correction-time (targeted).
    Renders the FULL deep spec for each implicated operation.
    """
    if not implicated_ops:
        return ""

    parts: List[str] = []
    parts.append("# OPERATION DEEP-DIVE (Correction Context)\n")
    parts.append(
        "One or more operations in your previous attempt failed. Study their FULL specifications "
        "below, including caveats and anti-patterns:\n"
    )

    seen = set()
    for op_name in implicated_ops:
        if op_name in seen or op_name not in COMPILER_REGISTRY:
            continue
        seen.add(op_name)
        spec = COMPILER_REGISTRY[op_name]
        parts.append(_render_op_block(spec, deep=True))
        parts.append("")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Backward-compat helpers
# ---------------------------------------------------------------------------

def get_operations_documentation(registry_ignored=None) -> str:
    """
    Legacy renderer — returns the full per-op documentation as a flat list.

    Kept for callers that import `get_operations_documentation` from this module
    or from `app.core.base_ops`. Prefer `render_generation_view` for new code.
    """
    parts: List[str] = ["# AVAILABLE OPERATIONS\n"]
    for spec in COMPILER_REGISTRY.values():
        parts.append(_render_op_block(spec, deep=True))
        parts.append("")
    return "\n".join(parts)
