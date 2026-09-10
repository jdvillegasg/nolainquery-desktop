"""
Computation Graph Schema Definitions using Pydantic.

This module defines the core data structures for representing computation graphs
that transform user queries into deterministic mathematical operations.
It also defines the output schema for the SemanticAgent.
"""

from enum import Enum
from typing import List, Dict, Any, Optional, Union
from pydantic import BaseModel, Field
import uuid


class OperationType(str, Enum):
    """Enumeration of allowed operations in the computation graph."""

    # Data extraction operations
    FILTER_EXTRACT = "filter_extract"
    LOAD_CONSTANT = "load_constant"
    GROUPBY_AGG = "groupby_agg"

    # Arithmetic operations
    ADD = "add"
    SUBTRACT = "subtract"
    MULTIPLY = "multiply"
    DIVIDE = "divide"

    # Element-wise math operations
    ABS = "abs"
    ROUND = "round"
    POW = "pow"
    SQRT = "sqrt"
    LOG = "log"

    # Statistical operations
    PERCENTAGE_CHANGE = "percentage_change"
    DOT_PRODUCT = "dot_product"

    # Aggregation operations (unitary - single input)
    MEAN = "mean"
    SUM = "sum"
    MAX = "max"
    MIN = "min"
    NUNIQUE = "nunique"
    UNIQUE = "unique"
    MODE = "mode"
    MEDIAN = "median"
    STD = "std"
    COUNT = "count"
    VALUE_COUNTS = "value_counts"

    # Data inspection / ranking operations
    ISNAN = "isnan"
    NLARGEST = "nlargest"
    NSMALLEST = "nsmallest"
    SORT_VALUES = "sort_values"
    HEAD = "head"
    TAIL = "tail"
    INDEX = "index"
    IDXMAX = "idxmax"
    IDXMIN = "idxmin"
    DROPNA = "dropna"
    FILLNA = "fillna"

    # Comparison operations
    EQ = "eq"
    NE = "ne"
    GT = "gt"
    GE = "ge"
    LT = "lt"
    LE = "le"
    BETWEEN = "between"

    # Logical (mask combinator) operations
    LOGICAL_AND = "logical_and"
    LOGICAL_OR = "logical_or"
    LOGICAL_NOT = "logical_not"

    # Type conversion operations
    TO_DATETIME = "to_datetime"
    STR = "str"

    # String operations
    STARTSWITH = "startswith"
    ISIN = "isin"
    ISIN_FROM_NODE = "isin_from_node"
    CONTAINS = "contains"
    LOWER = "lower"
    UPPER = "upper"
    CONCAT_STR = "concat_str"

    # Index operations
    GET_INDEX = "get_index"

    # Date / time component extraction
    EXTRACT_YEAR = "extract_year"
    EXTRACT_MONTH = "extract_month"
    EXTRACT_DAY = "extract_day"
    EXTRACT_DAYOFWEEK = "extract_dayofweek"
    EXTRACT_WEEK = "extract_week"
    EXTRACT_QUARTER = "extract_quarter"
    TRUNCATE_TO = "truncate_to"
    TIMEDELTA_TO_DAYS = "timedelta_to_days"
    DATE_ADD = "date_add"

    # Conditional aggregation
    COUNT_IF = "count_if"
    SUM_IF = "sum_if"
    MEAN_IF = "mean_if"

    # Percentile / quantile
    QUANTILE = "quantile"
    PERCENTILE_RANK = "percentile_rank"

    # Rank / cumulative
    RANK = "rank"
    CUMSUM = "cumsum"
    CUMSHARE = "cumshare"
    SHIFT = "shift"
    DIFF = "diff"
    ROLLING_MEAN = "rolling_mean"
    ROLLING_SUM = "rolling_sum"


# ---------------------------------------------------------------------------
# Semantic Agent schema
# ---------------------------------------------------------------------------

OTHER_OPTION = "Other (please specify)"


class AmbiguousConcept(BaseModel):
    """
    Represents a single ambiguous concept found in a user query.

    An ambiguous concept is a term that could map to multiple different
    computation paths given the available dataset columns.
    """

    term: str = Field(
        ...,
        description="The ambiguous word or phrase from the user query."
    )

    reason: str = Field(
        ...,
        description="Why this term is ambiguous given the dataset columns."
    )

    interpretations: List[str] = Field(
        ...,
        description=(
            "Ordered list of candidate interpretations. "
            "The last element MUST always be 'Other (please specify)'."
        )
    )


class SemanticAnalysis(BaseModel):
    """
    Full output of the SemanticAgent for a single user query.
    """

    is_ambiguous: bool = Field(
        ...,
        description="True if at least one ambiguous concept was detected."
    )

    concepts: List[AmbiguousConcept] = Field(
        default_factory=list,
        description="List of ambiguous concepts detected in the query."
    )

    input_tokens: Optional[int] = Field(
        default=0, 
        description="Number of input tokens computed for internal tracking."
    )

    output_tokens: Optional[int] = Field(
        default=0, 
        description="Number of output tokens computed for internal tracking."
    )


# ---------------------------------------------------------------------------
# Computation Graph schema
# ---------------------------------------------------------------------------

class Node(BaseModel):
    """
    Represents a single computation node in the graph.
    
    Each node performs one atomic operation and can depend on previous nodes.
    """
    
    id: str = Field(
        ...,
        description="Unique identifier for this node (e.g., 'node_0', 'node_1')"
    )
    
    op: OperationType = Field(
        ...,
        description="The operation this node performs"
    )
    
    params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Static parameters for the operation (e.g., column names, scalars, conditions)"
    )
    
    inputs: List[str] = Field(
        default_factory=list,
        description="List of node IDs that serve as inputs to this operation"
    )
    
    class Config:
        use_enum_values = True


class ComputationGraph(BaseModel):
    """
    Represents a complete computation graph that executes a user query.
    
    The graph is a Directed Acyclic Graph (DAG) where nodes are in topological order.
    """
    
    graph_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this computation graph"
    )
    
    nodes: List[Node] = Field(
        ...,
        description="List of computation nodes in topological order"
    )
    
    output_node: str = Field(
        ...,
        description="ID of the node that produces the final result"
    )
    
    def execute(self, source_data, engine: str = "pandas") -> Any:
        """
        Execute this computation graph on the provided source data.
        
        Args:
            source_data: Pandas DataFrame containing the data to query.
            engine: The execution engine to use ('pandas', 'polars', 'duckdb').
        
        Returns:
            The computed result from the output node.
        """
        from .executors.factory import get_executor
        executor = get_executor(engine, source_data)
        return executor.execute(self)
    
    class Config:
        use_enum_values = True
