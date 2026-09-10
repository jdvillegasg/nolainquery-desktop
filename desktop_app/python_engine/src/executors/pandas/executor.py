"""
Computation Graph Executor

This module provides the execution engine that runs computation graphs on actual data.
It takes a ComputationGraph and source data (pandas DataFrame) and executes all
operations sequentially, returning the final result.
"""

from typing import Dict, Any, Union, List
import pandas as pd
import numpy as np
from ...schema import ComputationGraph, Node, OperationType
from ..exceptions import ExecutionError, InvalidOperationError


class GraphExecutor:
    """
    Executes computation graphs on source data.
    
    The executor maintains a cache of computed node values and executes
    nodes in topological order, ensuring all dependencies are computed
    before dependent nodes.
    """
    
    def __init__(self, source_data: pd.DataFrame):
        """
        Initialize the executor with source data.
        
        Args:
            source_data: Pandas DataFrame containing the CSV data to query.
        """
        self.source_data = source_data
        self.node_cache: Dict[str, Any] = {}
        self.mask_cache: Dict[str, pd.Series] = {}
        self.node_scopes: Dict[str, str] = {}  # Maps node_id to scope_condition
    
    def execute(self, graph: ComputationGraph) -> Any:
        """
        Execute a computation graph and return the final result.
        
        Args:
            graph: ComputationGraph to execute.
        
        Returns:
            The computed value from the output node (scalar, list, or array).
        
        Raises:
            ExecutionError: If execution fails.
        """
        # Clear cache for new execution
        self.node_cache.clear()
        
        # Execute all nodes in topological order
        for node in graph.nodes:
            try:
                result = self._execute_node(node)
                self.node_cache[node.id] = result
            except Exception as e:
                raise ExecutionError(
                    f"Failed to execute node '{node.id}' (op: {node.op}): {str(e)}"
                ) from e
        
        # Return the output node's value
        if graph.output_node not in self.node_cache:
            raise ExecutionError(f"Output node '{graph.output_node}' was not computed")
        
        final_result = self.node_cache[graph.output_node]

        # Keep Series/DataFrame structure so labels (e.g. groupby keys) survive serialization.
        if isinstance(final_result, pd.DataFrame):
            return final_result
        if isinstance(final_result, pd.Series):
            return final_result
        elif isinstance(final_result, (np.integer, int)):
            return int(final_result)
        elif isinstance(final_result, (np.floating, float)):
            return float(final_result)
        elif isinstance(final_result, np.ndarray):
            return final_result.tolist()
            
        return final_result
    
    def _execute_node(self, node: Node) -> Any:
        """
        Execute a single node operation.
        
        Args:
            node: Node to execute.
        
        Returns:
            Computed value for this node.
        
        Raises:
            InvalidOperationError: If the operation is invalid or unsupported.
        """
        # Get input values from cache
        input_values = [self.node_cache[input_id] for input_id in node.inputs]
        
        # Dispatch to the appropriate operation handler
        # Dispatch to the appropriate operation handler
        result = None
        scope = "Unknown"
        
        if node.op == OperationType.FILTER_EXTRACT:
            result = self._op_filter_extract(node.params)
            condition = node.params.get("condition")
            scope = condition.strip() if condition else "Global"
            
        elif node.op == OperationType.LOAD_CONSTANT:
            result = self._op_load_constant(node.params)
            scope = "Scalar"
            
        elif node.op == OperationType.GROUPBY_AGG:
            result = self._op_groupby_agg(node.params)
            # Groupby results are effectively global or their own scope. 
            # For simplicity, we treat them as Global lists or Scalars depending on result.
            scope = "Global" 
            
        elif node.op in [OperationType.ADD, OperationType.SUBTRACT, OperationType.MULTIPLY, OperationType.DIVIDE, 
                        OperationType.EQ, OperationType.GT, OperationType.LT, OperationType.GE, OperationType.LE, OperationType.NE,
                        OperationType.LOGICAL_AND, OperationType.LOGICAL_OR, OperationType.DOT_PRODUCT, OperationType.CONCAT_STR]:
            # Element-wise operations
            if node.op == OperationType.ADD:
                result = self._op_add(input_values)
            elif node.op == OperationType.SUBTRACT:
                result = self._op_subtract(input_values)
            elif node.op == OperationType.MULTIPLY:
                result = self._op_multiply(input_values)
            elif node.op == OperationType.DIVIDE:
                result = self._op_divide(input_values)
            elif node.op == OperationType.EQ:
                result = self._op_eq(input_values)
            elif node.op == OperationType.GT:
                result = self._op_gt(input_values)
            elif node.op == OperationType.LT:
                result = self._op_lt(input_values)
            elif node.op == OperationType.GE:
                result = self._op_ge(input_values)
            elif node.op == OperationType.LE:
                result = self._op_le(input_values)
            elif node.op == OperationType.NE:
                result = self._op_ne(input_values)
            elif node.op == OperationType.LOGICAL_AND:
                result = self._op_logical_and(input_values)
            elif node.op == OperationType.LOGICAL_OR:
                result = self._op_logical_or(input_values)
            elif node.op == OperationType.DOT_PRODUCT:
                result = self._op_dot_product(input_values)
            elif node.op == OperationType.CONCAT_STR:
                result = self._op_concat_str(input_values)
            elif node.op == OperationType.ISIN:
                result = self._op_isin(input_values, node.params)

            # Determine scope from inputs
            input_scopes = [self.node_scopes.get(inp, "Unknown") for inp in node.inputs]
            
            # Filter out Scalars
            non_scalar_scopes = [s for s in input_scopes if s != "Scalar"]
            
            if not non_scalar_scopes:
                scope = "Scalar"
            else:
                # Check for conflicts
                first_scope = non_scalar_scopes[0]
                for s in non_scalar_scopes[1:]:
                    if s != first_scope:
                        raise InvalidOperationError(
                            f"Scope mismatch in node '{node.id}': Cannot operate on different scopes '{first_scope}' and '{s}'. "
                            "Ensure filters are identical."
                        )
                scope = first_scope

        elif node.op in [OperationType.MEAN, OperationType.SUM, OperationType.MAX, OperationType.MIN, 
                         OperationType.STD, OperationType.MEDIAN, OperationType.MODE, OperationType.NUNIQUE, 
                         OperationType.COUNT]:
            # Aggregations return Scalars
            if node.op == OperationType.MEAN:
                result = self._op_mean(input_values)
            elif node.op == OperationType.SUM:
                result = self._op_sum(input_values)
            elif node.op == OperationType.MAX:
                result = self._op_max(input_values)
            elif node.op == OperationType.MIN:
                result = self._op_min(input_values)
            elif node.op == OperationType.STD:
                result = self._op_std(input_values)
            elif node.op == OperationType.MEDIAN:
                result = self._op_median(input_values)
            elif node.op == OperationType.MODE:
                result = self._op_mode(input_values)
            elif node.op == OperationType.NUNIQUE:
                result = self._op_nunique(input_values)
            elif node.op == OperationType.COUNT:
                result = self._op_count(input_values)
            
            scope = "Scalar"

        elif node.op == OperationType.PERCENTAGE_CHANGE:
            # Element-wise operation: returns a Series when inputs are Series, scalar otherwise.
            result = self._op_percentage_change(input_values)
            input_scopes = [self.node_scopes.get(inp, "Unknown") for inp in node.inputs]
            non_scalar_scopes = [s for s in input_scopes if s != "Scalar"]
            scope = non_scalar_scopes[0] if non_scalar_scopes else "Scalar"

        # Pass-through ops (preserve scope)
        elif node.op in [OperationType.TO_DATETIME, OperationType.STR, OperationType.STARTSWITH, OperationType.CONTAINS,
                         OperationType.ISNAN, OperationType.ISIN, OperationType.ISIN_FROM_NODE, OperationType.LOGICAL_NOT, 
                         OperationType.LOWER, OperationType.UPPER, OperationType.FILLNA, OperationType.BETWEEN]:
             if node.op == OperationType.TO_DATETIME:
                 result = self._op_to_datetime(input_values, node.params)
             elif node.op == OperationType.STR:
                 result = self._op_str(input_values)
             elif node.op == OperationType.STARTSWITH:
                 result = self._op_startswith(input_values, node.params)
             elif node.op == OperationType.CONTAINS:
                 result = self._op_contains(input_values, node.params)
             elif node.op == OperationType.ISNAN:
                 result = self._op_isnan(input_values)
             elif node.op == OperationType.ISIN:
                 result = self._op_isin(input_values, node.params)
             elif node.op == OperationType.ISIN_FROM_NODE:
                 result = self._op_isin_from_node(input_values)
             elif node.op == OperationType.LOGICAL_NOT:
                 result = self._op_logical_not(input_values)
             elif node.op == OperationType.LOWER:
                 result = self._op_lower(input_values)
             elif node.op == OperationType.UPPER:
                 result = self._op_upper(input_values)
             elif node.op == OperationType.FILLNA:
                 result = self._op_fillna(input_values, node.params)
             elif node.op == OperationType.BETWEEN:
                 result = self._op_between(input_values, node.params)
             # Inherit scope from single input
             scope = self.node_scopes.get(node.inputs[0], "Unknown")

        # Derived-scope ops (row alignment is lost after this operation)
        elif node.op in [OperationType.SORT_VALUES, OperationType.DROPNA]:
             if node.op == OperationType.SORT_VALUES:
                 result = self._op_sort_values(input_values, node.params)
             elif node.op == OperationType.DROPNA:
                 result = self._op_dropna(input_values)
             scope = "Derived"

        # N-Largest etc (returns subset, changes scope?? or keeps it?)
        # nlargest returns a list of values. It loses the alignment with original rows usually unless we keep index.
        # But for scope tracking, it's a new derived list. 
        # Let's say it returns a "Derived" scope or "Global" list if it's just values.
        elif node.op in [OperationType.NLARGEST, OperationType.NSMALLEST, OperationType.HEAD, OperationType.TAIL, OperationType.UNIQUE, OperationType.VALUE_COUNTS]:
            if node.op == OperationType.NLARGEST:
                result = self._op_nlargest(input_values, node.params)
            elif node.op == OperationType.NSMALLEST:
                result = self._op_nsmallest(input_values, node.params)
            elif node.op == OperationType.HEAD:
                result = self._op_head(input_values, node.params)
            elif node.op == OperationType.TAIL:
                result = self._op_tail(input_values, node.params)
            elif node.op == OperationType.UNIQUE:
                result = self._op_unique(input_values)
            elif node.op == OperationType.VALUE_COUNTS:
                result = self._op_value_counts(input_values)
            scope = "Derived" # These operations typically break alignment or change the set of rows
            
        elif node.op == OperationType.INDEX:
             result = self._op_index(input_values, node.params)
             scope = "Scalar" if not isinstance(result, (pd.Series, list, np.ndarray)) else "Derived"
             
        elif node.op == OperationType.IDXMAX:
             result = self._op_idxmax(input_values)
             scope = "Scalar"

        elif node.op == OperationType.IDXMIN:
             result = self._op_idxmin(input_values)
             scope = "Scalar"

        elif node.op == OperationType.GET_INDEX:
            result = self._op_get_index(input_values)
            scope = "Global" 
            
        # ----- Element-wise math operations -----------------------------------
        elif node.op in [OperationType.ABS, OperationType.ROUND, OperationType.POW, OperationType.SQRT, OperationType.LOG]:
            if node.op == OperationType.ABS:
                result = self._op_abs(input_values)
            elif node.op == OperationType.ROUND:
                result = self._op_round(input_values, node.params)
            elif node.op == OperationType.POW:
                result = self._op_pow(input_values)
            elif node.op == OperationType.SQRT:
                result = self._op_sqrt(input_values)
            elif node.op == OperationType.LOG:
                result = self._op_log(input_values)
            
            # Inherit scope from first input (usually all inputs share same scope anyway)
            scope = self.node_scopes.get(node.inputs[0], "Global") if node.inputs else "Global"

        # ----- Date / time component extraction --------------------------------
        elif node.op in [
            OperationType.EXTRACT_YEAR, OperationType.EXTRACT_MONTH, OperationType.EXTRACT_DAY,
            OperationType.EXTRACT_DAYOFWEEK, OperationType.EXTRACT_WEEK, OperationType.EXTRACT_QUARTER,
            OperationType.TRUNCATE_TO, OperationType.TIMEDELTA_TO_DAYS, OperationType.DATE_ADD
        ]:
            if node.op == OperationType.EXTRACT_YEAR:
                result = self._op_extract_component(input_values, "year")
            elif node.op == OperationType.EXTRACT_MONTH:
                result = self._op_extract_component(input_values, "month")
            elif node.op == OperationType.EXTRACT_DAY:
                result = self._op_extract_component(input_values, "day")
            elif node.op == OperationType.EXTRACT_DAYOFWEEK:
                result = self._op_extract_component(input_values, "dayofweek")
            elif node.op == OperationType.EXTRACT_WEEK:
                result = self._op_extract_component(input_values, "week")
            elif node.op == OperationType.EXTRACT_QUARTER:
                result = self._op_extract_component(input_values, "quarter")
            elif node.op == OperationType.TRUNCATE_TO:
                result = self._op_truncate_to(input_values, node.params)
            elif node.op == OperationType.TIMEDELTA_TO_DAYS:
                result = self._op_timedelta_to_days(input_values)
            elif node.op == OperationType.DATE_ADD:
                result = self._op_date_add(input_values, node.params)
            scope = self.node_scopes.get(node.inputs[0], "Global") if node.inputs else "Global"

        # ----- Conditional aggregation -----------------------------------------
        elif node.op in [OperationType.COUNT_IF, OperationType.SUM_IF, OperationType.MEAN_IF]:
            if node.op == OperationType.COUNT_IF:
                result = self._op_count_if(input_values)
            elif node.op == OperationType.SUM_IF:
                result = self._op_sum_if(input_values)
            elif node.op == OperationType.MEAN_IF:
                result = self._op_mean_if(input_values)
            scope = "Scalar"

        # ----- Percentile / quantile -------------------------------------------
        elif node.op in [OperationType.QUANTILE, OperationType.PERCENTILE_RANK]:
            if node.op == OperationType.QUANTILE:
                result = self._op_quantile(input_values, node.params)
                scope = "Scalar"
            elif node.op == OperationType.PERCENTILE_RANK:
                result = self._op_percentile_rank(input_values)
                scope = self.node_scopes.get(node.inputs[0], "Global") if node.inputs else "Global"

        # ----- Rank / cumulative -----------------------------------------------
        elif node.op in [OperationType.RANK, OperationType.CUMSUM, OperationType.CUMSHARE, 
                         OperationType.SHIFT, OperationType.DIFF, OperationType.ROLLING_MEAN, OperationType.ROLLING_SUM]:
            if node.op == OperationType.RANK:
                result = self._op_rank(input_values, node.params)
            elif node.op == OperationType.CUMSUM:
                result = self._op_cumsum(input_values)
            elif node.op == OperationType.CUMSHARE:
                result = self._op_cumshare(input_values)
            elif node.op == OperationType.SHIFT:
                result = self._op_shift(input_values, node.params)
            elif node.op == OperationType.DIFF:
                result = self._op_diff(input_values, node.params)
            elif node.op == OperationType.ROLLING_MEAN:
                result = self._op_rolling_mean(input_values, node.params)
            elif node.op == OperationType.ROLLING_SUM:
                result = self._op_rolling_sum(input_values, node.params)
            scope = self.node_scopes.get(node.inputs[0], "Global") if node.inputs else "Global"

        else:
            raise InvalidOperationError(f"Unsupported operation: {node.op}")

        self.node_scopes[node.id] = scope
        return result
    
    # Data extraction operations
    
    def _op_filter_extract(self, params: Dict[str, Any]) -> Union[float, int, str, List]:
        """
        Extract data from source using optional filter condition with .loc indexing.
        
        Args:
            params: Must contain 'column', optionally 'condition'.
                   If no condition provided, extracts all rows.
        
        Returns:
            pd.Series (filtered) or scalar value.
        """
        column = params.get("column")
        condition = params.get("condition")
        
        if not column:
            raise InvalidOperationError("filter_extract requires 'column' parameter")
        
        if column not in self.source_data.columns:
            raise InvalidOperationError(
                f"Column '{column}' not found in source data. "
                f"Available columns: {list(self.source_data.columns)}"
            )
        
        # Extract values with or without condition
        try:
            if condition:
                # Check mask cache first
                if condition in self.mask_cache:
                    mask = self.mask_cache[condition]
                else:
                    try:
                        mask = self.source_data.eval(condition)
                    except Exception:
                        import re
                        mod_cond = condition
                        # Replace bitwise & | with logical and / or to avoid precedence errors
                        mod_cond = mod_cond.replace(' & ', ' and ').replace(' | ', ' or ')
                        mod_cond = mod_cond.replace('&', ' and ').replace('|', ' or ')
                        # Heuristic: convert year(Col) to Col.dt.year
                        mod_cond = re.sub(r'year\((.*?)\)', r'\1.dt.year', mod_cond)
                        mod_cond = re.sub(r'month\((.*?)\)', r'\1.dt.month', mod_cond)
                        
                        # Heuristic: handle unquoted string on RHS (e.g. StockCode ==StockCode)
                        parts = mod_cond.split('==')
                        if len(parts) == 2:
                            lhs = parts[0].strip()
                            rhs = parts[1].strip()
                            if rhs.isalnum() and not rhs.isdigit() and not (rhs.startswith("'") or rhs.startswith('"')) and rhs not in self.source_data.columns:
                                mod_cond = f"{lhs} == '{rhs}'"
                                
                        mask = self.source_data.eval(mod_cond)
                    self.mask_cache[condition] = mask
                
                filtered_values = self.source_data.loc[mask, column]
                # Canonicalize blank space to avoid "Year=2023" vs "Year = 2023" mismatches
                # Ideally, translator normalizes this. We use the raw string as scope id.
                scope_id = condition.strip()
            else:
                # No condition - extract all values from column
                filtered_values = self.source_data[column]
                scope_id = "Global"
                
        except Exception as e:
            raise InvalidOperationError(
                f"Invalid filter condition '{condition}': {str(e)}"
            ) from e
        
        # Return as Series (preserving index for alignment)
        # If it's a single value (scalar), we might want to keep it as Series of length 1 
        # for consistency in operations, BUT if the semantic is "scalar constant", 
        # treating it as Series can be tricky.
        # However, for filter_extract, we expect a subset of rows.
        
        # Return as Series (preserving index for alignment)
        return filtered_values
    
    def _op_load_constant(self, params: Dict[str, Any]) -> Union[float, List[float]]:
        """
        Load a constant value.
        
        Args:
            params: Must contain 'value'.
        
        Returns:
            The constant value.
        """
        if "value" not in params:
            raise InvalidOperationError("load_constant requires 'value' parameter")
        
        return params["value"]
    
    def _op_groupby_agg(self, params: Dict[str, Any]) -> Union[float, List[float]]:
        """
        Group data by one or more columns/nodes and apply an aggregation function.

        Supports both single-key grouping (`groupby_column`) and multi-key grouping
        (`groupby_columns`, a list of source-column names or node ids of source-aligned
        derived Series such as the output of extract_month / extract_year).
        When `groupby_columns` is present it takes precedence over `groupby_column`.
        """
        groupby_columns_param = params.get("groupby_columns")
        groupby_column = params.get("groupby_column")
        agg_column = params.get("agg_column")
        agg_function = params.get("agg_function")

        if not agg_column:
            raise InvalidOperationError("groupby_agg requires 'agg_column' parameter")
        if not agg_function:
            raise InvalidOperationError("groupby_agg requires 'agg_function' parameter")

        # Validate aggregation function
        valid_agg_funcs = ['sum', 'mean', 'count', 'max', 'min', 'std', 'median', 'nunique']
        if agg_function not in valid_agg_funcs:
            raise InvalidOperationError(
                f"Invalid aggregation function '{agg_function}'. "
                f"Valid options: {valid_agg_funcs}"
            )

        # Resolve agg_column: either a computed node or source column
        if agg_column in self.node_cache:
            agg_values = self.node_cache[agg_column]
            if not isinstance(agg_values, pd.Series):
                if isinstance(agg_values, list) and len(agg_values) == len(self.source_data):
                    agg_values = pd.Series(agg_values, index=self.source_data.index)
                else:
                    raise InvalidOperationError(
                        f"Computed node '{agg_column}' used in groupby must be a Series with length matching source data."
                    )
        elif agg_column in self.source_data.columns:
            agg_values = self.source_data[agg_column]
        else:
            raise InvalidOperationError(
                f"'agg_column' '{agg_column}' is neither a known node id nor a source column. "
                f"Available columns: {list(self.source_data.columns)}"
            )

        # Build groupby key(s)
        if isinstance(groupby_columns_param, list) and groupby_columns_param:
            # Multi-key groupby
            group_keys = []
            for entry in groupby_columns_param:
                if isinstance(entry, str) and entry in self.node_cache:
                    key_series = self.node_cache[entry]
                    if not isinstance(key_series, pd.Series):
                        raise InvalidOperationError(
                            f"Entry '{entry}' in groupby_columns resolves to a non-Series value."
                        )
                    group_keys.append(key_series)
                elif isinstance(entry, str) and entry in self.source_data.columns:
                    group_keys.append(self.source_data[entry])
                else:
                    raise InvalidOperationError(
                        f"groupby_columns entry '{entry}' is neither a known node id nor a source column."
                    )
            try:
                result = agg_values.groupby(group_keys).agg(agg_function)
            except Exception as e:
                raise InvalidOperationError(f"Failed to apply multi-key groupby aggregation: {str(e)}") from e
        else:
            # Single-key groupby (legacy path)
            if not groupby_column:
                raise InvalidOperationError(
                    "groupby_agg requires either 'groupby_column' or 'groupby_columns' parameter."
                )
            if groupby_column not in self.source_data.columns:
                raise InvalidOperationError(
                    f"Column '{groupby_column}' not found in source data. "
                    f"Available columns: {list(self.source_data.columns)}"
                )
            try:
                result = agg_values.groupby(self.source_data[groupby_column]).agg(agg_function)
            except Exception as e:
                raise InvalidOperationError(f"Failed to apply groupby aggregation: {str(e)}") from e

        # We return the result even if empty, to let downstream nodes handle it.
        # However, for convenience in some tasks, we might want to log it.
        return result
    
    # Arithmetic operations
    
    def _op_add(self, inputs: List[Any]) -> Any:
        """Element-wise addition."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"add requires 2 inputs, got {len(inputs)}")
            
        a, b = inputs
        
        # Enforce strict index alignment if both are Series
        # Handle index alignment if both are Series
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                try:
                    # Attempt to align by reindexing b to a's index
                    b = b.reindex(a.index)
                except Exception:
                    raise InvalidOperationError("Scope mismatch: Indices cannot be aligned for addition.")
        
        try:
            return a + b
        except Exception as e:
            raise InvalidOperationError(f"Addition failed: {str(e)}")
    
    def _op_subtract(self, inputs: List[Any]) -> Any:
        """Element-wise subtraction."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"subtract requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                try:
                    b = b.reindex(a.index)
                except Exception:
                    raise InvalidOperationError("Scope mismatch: Indices cannot be aligned for subtraction.")
        
        try:
            return a - b
        except Exception as e:
            raise InvalidOperationError(f"Subtraction failed: {str(e)}")
    
    def _op_multiply(self, inputs: List[Any]) -> Any:
        """Element-wise multiplication."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"multiply requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                try:
                    b = b.reindex(a.index)
                except Exception:
                    raise InvalidOperationError("Scope mismatch: Indices cannot be aligned for multiplication.")
        
        try:
            return a * b
        except Exception as e:
            raise InvalidOperationError(f"Multiplication failed: {str(e)}")
    
    def _op_divide(self, inputs: List[Any]) -> Any:
        """Element-wise division."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"divide requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch: Indices must match exactly for division.")
        
        # Handle division by zero gracefully using Pandas inf/nan
        try:
            if isinstance(b, (int, float)) and b == 0:
                return np.inf if a > 0 else (-np.inf if a < 0 else np.nan)
            
            # Pandas handles div by zero smoothly returning inf/nan
            return a / b
        except Exception as e:
            raise InvalidOperationError(f"Division failed: {str(e)}")
    
    
    # Statistical operations
    
    def _op_percentage_change(self, inputs: List[Any]) -> float:
        """
        Calculate percentage change: ((new - old) / old).
        
        Args:
            inputs: [old_value, new_value]
        
        Returns:
            Percentage change as decimal (e.g., 0.15 for 15% increase).
        """
        if len(inputs) != 2:
            raise InvalidOperationError(
                f"percentage_change requires 2 inputs, got {len(inputs)}"
            )
        
        old_value, new_value = inputs
        
        try:
            # Handle possible zero division gracefully using NaN / inf
            if not isinstance(old_value, (pd.Series, pd.DataFrame, np.ndarray)) and old_value == 0:
                if new_value > 0:
                    return np.inf
                elif new_value < 0:
                    return -np.inf
                else:
                    return np.nan
                
            result = (new_value - old_value) / old_value
            
            # If it's a Series with any inf, we might want to warn or just let it be.
            # Most analytical systems handle inf/nan.
            return result
        except ZeroDivisionError:
             return np.nan
        except Exception as e:
            raise InvalidOperationError(f"percentage_change failed: {str(e)}")
    
    def _op_dot_product(self, inputs: List[Any]) -> float:
        """
        Calculate dot product of two vectors.
        
        Args:
            inputs: [vector1, vector2]
        
        Returns:
            Scalar dot product result.
        """
        if len(inputs) != 2:
            raise InvalidOperationError(
                f"dot_product requires 2 inputs, got {len(inputs)}"
            )
        
        vec1, vec2 = inputs
        
        # Ensure both are vectors/Series
        if not isinstance(vec1, (list, pd.Series, np.ndarray)):
            raise InvalidOperationError("dot_product requires vector inputs")
        if not isinstance(vec2, (list, pd.Series, np.ndarray)):
            raise InvalidOperationError("dot_product requires vector inputs")
        
        try:
            if isinstance(vec1, pd.Series):
                return float(vec1.dot(vec2))
            return float(np.dot(vec1, vec2))
        except Exception as e:
            raise InvalidOperationError(f"dot_product failed: {str(e)}")
    
    # Aggregation operations
    
    def _op_mean(self, inputs: List[Any]) -> float:
        """Calculate arithmetic mean of a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"mean requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if len(values) == 0:
            return np.nan
        
        if isinstance(values, pd.Series):
            return float(values.mean())
        return float(np.mean(values))
    
    def _op_sum(self, inputs: List[Any]) -> float:
        """Calculate sum of all elements in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"sum requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if isinstance(values, pd.Series):
            return float(values.sum())
        return float(np.sum(values))
    
    def _op_max(self, inputs: List[Any]) -> float:
        """Find maximum value in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"max requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if len(values) == 0:
            raise InvalidOperationError("Cannot find max of empty vector")
        
        if isinstance(values, pd.Series):
            return float(values.max())
        return float(np.max(values))
    
    def _op_min(self, inputs: List[Any]) -> float:
        """Find minimum value in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"min requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if len(values) == 0:
            raise InvalidOperationError("Cannot find min of empty vector")
        
        if isinstance(values, pd.Series):
            return float(values.min())
        return float(np.min(values))
    
    def _op_nunique(self, inputs: List[Any]) -> float:
        """Count the number of unique values in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"nunique requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return 1.0
        
        if len(values) == 0:
            return 0.0
        
        if isinstance(values, pd.Series):
            return float(values.nunique())
        return float(pd.Series(values).nunique())
    
    def _op_mode(self, inputs: List[Any]) -> float:
        """Find the most frequent value in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"mode requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if len(values) == 0:
            raise InvalidOperationError("Cannot find mode of empty vector")
        
        # pandas mode() returns a Series, take the first mode
        if isinstance(values, pd.Series):
            mode_result = values.mode()
        else:
            mode_result = pd.Series(values).mode()
            
        if len(mode_result) == 0:
            raise InvalidOperationError("No mode found")
        
        return float(mode_result.iloc[0])
    
    def _op_median(self, inputs: List[Any]) -> float:
        """Calculate median of a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"median requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return float(values)
        
        if len(values) == 0:
            raise InvalidOperationError("Cannot calculate median of empty vector")
        
        if isinstance(values, pd.Series):
            return float(values.median())
        return float(np.median(values))
    
    def _op_std(self, inputs: List[Any]) -> float:
        """Calculate standard deviation of a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"std requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return 0.0
        
        if len(values) == 0:
            raise InvalidOperationError("Cannot calculate std of empty vector")
        
        if len(values) == 1:
            return 0.0
        
        if isinstance(values, pd.Series):
            return float(values.std(ddof=1))
        return float(np.std(values, ddof=1))
    
    def _op_count(self, inputs: List[Any]) -> int:
        """Count the number of elements in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"count requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return 1
        
        if isinstance(values, pd.Series):
            return int(values.count()) # count excludes NaNs in pandas
        return len(values)
    
    def _op_isnan(self, inputs: List[Any]) -> List[bool]:
        """Check for NaN (missing) values in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"isnan requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, (list, pd.Series, np.ndarray)):
            return pd.isna(values)
        
        if isinstance(values, pd.Series):
            return values.isna()
        return pd.Series(values).isna()
    
    def _op_nlargest(self, inputs: List[Any], params: Dict[str, Any]) -> List[float]:
        """Return the n largest values from a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"nlargest requires 1 input, got {len(inputs)}")
        
        n = params.get("n")
        if n is None:
            raise InvalidOperationError("nlargest requires 'n' parameter")
        
        if not isinstance(n, int) or n <= 0:
            raise InvalidOperationError(f"'n' must be a positive integer, got {n}")
        
        values = inputs[0]
        if not isinstance(values, pd.Series):
            series = pd.Series(values)
        else:
            series = values
            
        if len(series) == 0:
            raise InvalidOperationError("Cannot find largest values in empty vector")
        
        return series.nlargest(min(n, len(series)))
    
    def _op_index(self, inputs: List[Any], params: Dict[str, Any]) -> Union[Any, List[Any]]:
        """Extract element(s) at specified index/indices from a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"index requires 1 input, got {len(inputs)}")
        
        indices_param = params.get("indices")
        if indices_param is None:
            raise InvalidOperationError("index requires 'indices' parameter")
        
        values = inputs[0]
        
        # Resolve indices if it's a node ID string
        if isinstance(indices_param, str) and indices_param in self.node_cache:
            indices = self.node_cache[indices_param]
        else:
            indices = indices_param
            
        # Handle boolean masking (Series or list of booleans)
        if isinstance(indices, (pd.Series, list)) and len(indices) > 0:
            # Check if it's a boolean mask
            is_bool_mask = False
            if isinstance(indices, pd.Series):
                is_bool_mask = indices.dtype == bool
            else:
                is_bool_mask = all(isinstance(x, bool) for x in indices)
                
            if is_bool_mask:
                if not isinstance(values, pd.Series):
                    values = pd.Series(values)
                # Ensure strict alignment if it's a Series mask
                if isinstance(indices, pd.Series) and not values.index.equals(indices.index):
                    raise InvalidOperationError(
                        f"Scope mismatch: Boolean mask index (length {len(indices)}) "
                        f"does not strictly align with the data vector (length {len(values)})."
                    )
                return values[indices]

        # Handle None or empty indices (e.g. from failed idxmax)
        if indices is None:
            return None if not isinstance(values, pd.Series) else pd.Series([], dtype=values.dtype)

        # Handle single integer index
        if isinstance(indices, int):
            try:
                if isinstance(values, pd.Series):
                    return values.iloc[indices]
                return values[indices]
            except IndexError:
                raise InvalidOperationError(f"Index {indices} out of range")
        
        # Handle string or other scalar labels (such as returned by idxmax)
        if isinstance(indices, (str, float, np.number, pd.Timestamp)):
            try:
                if isinstance(values, pd.Series):
                    return values.loc[indices]
                elif hasattr(values, '__getitem__'):
                    return values[indices]
            except KeyError:
                raise InvalidOperationError(f"Index label {indices} not found")
        
        # Handle list of integer indices
        if not isinstance(indices, (list, pd.Series)):
            raise InvalidOperationError(f"'indices' must be an integer, string label, list of integers/labels, or node ID referencing a mask/list, got {type(indices)}")
        
        try:
            if isinstance(values, pd.Series):
                # If indices is a Series of ints, iloc still works
                return values.iloc[indices]
            return [values[idx] for idx in indices]
        except (IndexError, TypeError, KeyError):
            raise InvalidOperationError("One or more indices out of range or invalid for indexing")
    
    def _op_eq(self, inputs: List[Any]) -> Any:
        """Element-wise equality comparison."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"eq requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for equality comparison")
        return a == b
    
    def _op_gt(self, inputs: List[Any]) -> Any:
        """Element-wise greater than comparison."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"gt requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for greater than comparison")
        return a > b
    
    def _op_lt(self, inputs: List[Any]) -> Any:
        """Element-wise less than comparison."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"lt requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for less than comparison")
        return a < b
    
    def _op_ge(self, inputs: List[Any]) -> Any:
        """Element-wise greater than or equal to comparison."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"ge requires 2 inputs, got {len(inputs)}")
        
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for ge comparison")
        return a >= b

    def _op_logical_and(self, inputs: List[Any]) -> Any:
        """Element-wise logical AND."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"logical_and requires 2 inputs, got {len(inputs)}")
        a, b = inputs
        
        if a is None: a = False
        if b is None: b = False
        
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for logical_and")
                
        if isinstance(a, pd.Series) or isinstance(b, pd.Series):
            # Fill NAs with False for boolean operations
            s_a = a.fillna(False) if isinstance(a, pd.Series) else a
            s_b = b.fillna(False) if isinstance(b, pd.Series) else b
            return s_a & s_b
            
        return bool(a and b)

    def _op_logical_or(self, inputs: List[Any]) -> Any:
        """Element-wise logical OR."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"logical_or requires 2 inputs, got {len(inputs)}")
        a, b = inputs
        
        if a is None: a = False
        if b is None: b = False
        
        if isinstance(a, pd.Series) and isinstance(b, pd.Series):
            if not a.index.equals(b.index):
                raise InvalidOperationError("Scope mismatch for logical_or")
                
        if isinstance(a, pd.Series) or isinstance(b, pd.Series):
            s_a = a.fillna(False) if isinstance(a, pd.Series) else a
            s_b = b.fillna(False) if isinstance(b, pd.Series) else b
            return s_a | s_b
            
        return bool(a or b)

    def _op_logical_not(self, inputs: List[Any]) -> Any:
        """Element-wise logical NOT."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"logical_not requires 1 input, got {len(inputs)}")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return ~a
        return not bool(a)

    def _op_sort_values(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        """Sort a Series by its values (default) or by its index labels."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"sort_values requires 1 input, got {len(inputs)}")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        ascending = params.get("ascending", True)
        by = params.get("by", "values")
        if by == "index":
            return a.sort_index(ascending=ascending)
        return a.sort_values(ascending=ascending)
    
    def _op_idxmax(self, inputs: List[Any]) -> int:
        """Return the index position of the maximum value in a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"idxmax requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if not isinstance(values, pd.Series):
            values = pd.Series(values)
        
        if len(values) == 0:
            return None
        
        return values.idxmax()
    
    def _op_to_datetime(self, inputs: List[Any], params: Dict[str, Any]) -> List:
        """Convert values to datetime objects."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"to_datetime requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        date_format = params.get("format")
        
        try:
            if date_format:
                return pd.to_datetime(values, format=date_format)
            else:
                return pd.to_datetime(values)
        except Exception as e:
            raise InvalidOperationError(f"Failed to convert to datetime: {str(e)}") from e
    
    def _op_str(self, inputs: List[Any]) -> Union[str, List[str]]:
        """Convert values to string type."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"str requires 1 input, got {len(inputs)}")
        
        values = inputs[0]
        
        if isinstance(values, pd.Series):
            return values.astype(str)
        if isinstance(values, list):
            return [str(v) for v in values]
        return str(values)
    
    def _op_startswith(self, inputs: List[Any], params: Dict[str, Any]) -> List[bool]:
        """Check if string values start with a specified prefix."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"startswith requires 1 input, got {len(inputs)}")
        
        prefix = params.get("prefix")
        if prefix is None:
            raise InvalidOperationError("startswith requires 'prefix' parameter")
        
        if not isinstance(prefix, str):
            raise InvalidOperationError(f"'prefix' must be a string, got {type(prefix)}")
        
        values = inputs[0]
        
        if isinstance(values, pd.Series):
            return values.str.startswith(prefix)
        
        # Fallback for non-series
        if not isinstance(values, list):
            return str(values).startswith(prefix)
        
        return [str(v).startswith(prefix) for v in values]
    
    def _op_isin(self, inputs: List[Any], params: Dict[str, Any]) -> Union[bool, List[bool]]:
        """Check if values are contained in a provided list."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"isin requires 1 input, got {len(inputs)}")
        
        check_values = params.get("values")
        if check_values is None:
            raise InvalidOperationError("isin requires 'values' parameter")
        
        if not isinstance(check_values, list):
            raise InvalidOperationError(f"'values' parameter must be a list, got {type(check_values)}")
        
        values = inputs[0]
        
        if isinstance(values, pd.Series):
            return values.isin(check_values)
        
        if isinstance(values, list):
            return [v in check_values for v in values]
            
        return values in check_values

    def _op_get_index(self, inputs: List[Any]) -> pd.Series:
        """Extract index labels from a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"get_index requires 1 input, got {len(inputs)}")

        values = inputs[0]

        if not isinstance(values, pd.Series):
            try:
                values = pd.Series(values)
            except Exception:
                return pd.Series([values])

        # If the input is a boolean mask, return the indices where it is True
        if hasattr(values, 'dtype') and values.dtype == bool:
            return pd.Series(values[values].index.values)

        return pd.Series(values.index.values)

    # -------------------------------------------------------------------------
    # Date / time component extraction
    # -------------------------------------------------------------------------

    def _op_extract_component(self, inputs: List[Any], component: str) -> pd.Series:
        """
        Extract a calendar component from a datetime Series.

        component must be one of: 'year', 'month', 'day', 'dayofweek', 'week', 'quarter'.
        """
        if len(inputs) != 1:
            raise InvalidOperationError(f"extract_{component} requires 1 input, got {len(inputs)}")

        values = inputs[0]

        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        # Auto-convert if not already datetime
        if not pd.api.types.is_datetime64_any_dtype(values):
            try:
                values = pd.to_datetime(values)
            except Exception as e:
                raise InvalidOperationError(
                    f"extract_{component}: input cannot be parsed as datetime: {e}"
                ) from e

        try:
            if component == "year":
                return values.dt.year.astype(int)
            elif component == "month":
                return values.dt.month.astype(int)
            elif component == "day":
                return values.dt.day.astype(int)
            elif component == "dayofweek":
                return values.dt.dayofweek.astype(int)
            elif component == "week":
                # isocalendar() returns a DataFrame; re-wrap with original index
                return pd.Series(
                    values.dt.isocalendar().week.astype(int).values,
                    index=values.index,
                )
            elif component == "quarter":
                return values.dt.quarter.astype(int)
            else:
                raise InvalidOperationError(f"Unknown datetime component: {component}")
        except Exception as e:
            raise InvalidOperationError(f"extract_{component} failed: {e}") from e

    def _op_truncate_to(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        """
        Truncate a datetime Series to the start of the specified calendar period.

        params['unit'] must be one of: 'day', 'week', 'month', 'quarter'.
        Returns a datetime Series where each value is the period-start timestamp.
        """
        if len(inputs) != 1:
            raise InvalidOperationError(f"truncate_to requires 1 input, got {len(inputs)}")

        unit = params.get("unit")
        valid_units = ("day", "week", "month", "quarter")
        if unit not in valid_units:
            raise InvalidOperationError(
                f"truncate_to 'unit' must be one of {valid_units}, got '{unit}'"
            )

        values = inputs[0]

        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        if not pd.api.types.is_datetime64_any_dtype(values):
            try:
                values = pd.to_datetime(values)
            except Exception as e:
                raise InvalidOperationError(
                    f"truncate_to: input cannot be parsed as datetime: {e}"
                ) from e

        freq_map = {"day": "D", "week": "W", "month": "M", "quarter": "Q"}
        freq = freq_map[unit]

        try:
            return values.dt.to_period(freq)
        except Exception as e:
            raise InvalidOperationError(f"truncate_to failed: {e}") from e

    # -------------------------------------------------------------------------
    # Conditional aggregation
    # -------------------------------------------------------------------------

    def _op_count_if(self, inputs: List[Any]) -> int:
        """Count the number of True values in a boolean mask."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"count_if requires 1 input, got {len(inputs)}")

        mask = inputs[0]

        if isinstance(mask, pd.Series):
            return int(mask.sum())
        if isinstance(mask, (list, np.ndarray)):
            return int(sum(bool(v) for v in mask))
        return int(bool(mask))

    def _op_sum_if(self, inputs: List[Any]) -> float:
        """Sum a value vector only where a boolean mask is True."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"sum_if requires 2 inputs, got {len(inputs)}")

        values, mask = inputs[0], inputs[1]

        if not isinstance(values, pd.Series):
            values = pd.Series(values)
        if not isinstance(mask, pd.Series):
            mask = pd.Series(mask)

        if not values.index.equals(mask.index):
            try:
                mask = mask.reindex(values.index, fill_value=False)
            except Exception as e:
                raise InvalidOperationError(f"sum_if: value vector and mask must share the same index. {e}")

        return float(values[mask].sum())

    def _op_mean_if(self, inputs: List[Any]) -> float:
        """Average a value vector only where a boolean mask is True."""
        if len(inputs) != 2:
            raise InvalidOperationError(f"mean_if requires 2 inputs, got {len(inputs)}")

        values, mask = inputs[0], inputs[1]

        if not isinstance(values, pd.Series):
            values = pd.Series(values)
        if not isinstance(mask, pd.Series):
            mask = pd.Series(mask)

        if not values.index.equals(mask.index):
            try:
                mask = mask.reindex(values.index, fill_value=False)
            except Exception as e:
                raise InvalidOperationError(f"mean_if: value vector and mask must share the same index. {e}")

        filtered = values[mask]
        if len(filtered) == 0:
            return np.nan

        return float(filtered.mean())

    # -------------------------------------------------------------------------
    # Percentile / quantile
    # -------------------------------------------------------------------------

    def _op_quantile(self, inputs: List[Any], params: Dict[str, Any]) -> float:
        """Compute the q-th quantile of a vector."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"quantile requires 1 input, got {len(inputs)}")

        q = params.get("q")
        if q is None:
            raise InvalidOperationError("quantile requires 'q' parameter")

        try:
            q = float(q)
        except (TypeError, ValueError):
            raise InvalidOperationError(f"quantile 'q' must be a float in [0, 1], got {q!r}")

        if not (0.0 <= q <= 1.0):
            raise InvalidOperationError(f"quantile 'q' must be in [0, 1], got {q}")

        values = inputs[0]
        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        if len(values) == 0:
            raise InvalidOperationError("quantile: input vector is empty")

        return float(values.quantile(q))

    def _op_percentile_rank(self, inputs: List[Any]) -> pd.Series:
        """Return per-element percentile rank in [0, 1]."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"percentile_rank requires 1 input, got {len(inputs)}")

        values = inputs[0]
        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        if len(values) == 0:
            raise InvalidOperationError("percentile_rank: input vector is empty")

        return values.rank(pct=True)

    # -------------------------------------------------------------------------
    # Rank / cumulative
    # -------------------------------------------------------------------------

    def _op_rank(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        """Assign integer ranks to each element."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"rank requires 1 input, got {len(inputs)}")

        ascending = bool(params.get("ascending", True))

        values = inputs[0]
        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        if len(values) == 0:
            raise InvalidOperationError("rank: input vector is empty")

        return values.rank(ascending=ascending, method="min").astype(int)

    def _op_cumsum(self, inputs: List[Any]) -> pd.Series:
        """Running cumulative sum."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"cumsum requires 1 input, got {len(inputs)}")

        values = inputs[0]
        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        return values.cumsum()

    def _op_cumshare(self, inputs: List[Any]) -> pd.Series:
        """Running cumulative share of total (values in [0, 1])."""
        if len(inputs) != 1:
            raise InvalidOperationError(f"cumshare requires 1 input, got {len(inputs)}")

        values = inputs[0]
        if not isinstance(values, pd.Series):
            values = pd.Series(values)

        total = values.sum()
        if total == 0:
            raise InvalidOperationError("cumshare: total is zero — cannot compute share.")

        return values.cumsum() / total

    # -------------------------------------------------------------------------
    # Generic expressive operations
    # -------------------------------------------------------------------------

    def _op_le(self, inputs: List[Any]) -> Any:
        if len(inputs) != 2:
            raise InvalidOperationError(f"le requires 2 inputs, got {len(inputs)}")
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series) and not a.index.equals(b.index):
            raise InvalidOperationError("Scope mismatch for le comparison")
        return a <= b

    def _op_ne(self, inputs: List[Any]) -> Any:
        if len(inputs) != 2:
            raise InvalidOperationError(f"ne requires 2 inputs, got {len(inputs)}")
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series) and not a.index.equals(b.index):
            raise InvalidOperationError("Scope mismatch for ne comparison")
        return a != b

    def _op_between(self, inputs: List[Any], params: Dict[str, Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"between requires 1 input, got {len(inputs)}")
        low = params.get("low")
        high = params.get("high")
        if low is None or high is None:
            raise InvalidOperationError("between requires both 'low' and 'high' parameters")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.between(low, high)
        return low <= a <= high

    def _op_dropna(self, inputs: List[Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"dropna requires 1 input, got {len(inputs)}")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.dropna()
        return a

    def _op_fillna(self, inputs: List[Any], params: Dict[str, Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"fillna requires 1 input, got {len(inputs)}")
        val = params.get("value")
        if val is None:
            raise InvalidOperationError("fillna requires 'value' parameter")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.fillna(val)
        return val if pd.isna(a) else a

    def _op_contains(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError(f"contains requires 1 input, got {len(inputs)}")
        substr = params.get("substring")
        case = params.get("case", False)
        if not substr:
            raise InvalidOperationError("contains requires 'substring' parameter")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.astype(str).str.contains(substr, case=case, na=False)

    def _op_lower(self, inputs: List[Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"lower requires 1 input")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.astype(str).str.lower()
        return str(a).lower()

    def _op_upper(self, inputs: List[Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"upper requires 1 input")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.astype(str).str.upper()
        return str(a).upper()

    def _op_concat_str(self, inputs: List[Any]) -> Any:
        if len(inputs) != 2:
            raise InvalidOperationError(f"concat_str requires 2 inputs")
        a, b = inputs
        if isinstance(a, pd.Series) and isinstance(b, pd.Series) and not a.index.equals(b.index):
            raise InvalidOperationError("Scope mismatch for concat_str")
        if isinstance(a, pd.Series) or isinstance(b, pd.Series):
            s_a = a if isinstance(a, pd.Series) else pd.Series([a]*len(b), index=b.index)
            s_b = b if isinstance(b, pd.Series) else pd.Series([b]*len(a), index=a.index)
            return s_a.astype(str) + s_b.astype(str)
        return str(a) + str(b)

    def _op_isin_from_node(self, inputs: List[Any]) -> pd.Series:
        # Expected: target_vector, set_vector (from another node)
        if len(inputs) != 2:
            raise InvalidOperationError(f"isin_from_node requires 2 inputs")
        target, values_set = inputs
        if not isinstance(target, pd.Series):
            target = pd.Series(target)
        if isinstance(values_set, pd.Series):
            values_set = values_set.tolist()
        elif not isinstance(values_set, list):
            values_set = [values_set]
            
        mask = target.isin(values_set)
        # Fallback: if no values matched but the index labels match, use the index
        # This is a common pattern in LLM-generated DAGs for filtering groupby results.
        if not mask.any() and target.index.isin(values_set).any():
            return pd.Series(target.index.isin(values_set), index=target.index)
            
        return mask

    def _op_timedelta_to_days(self, inputs: List[Any]) -> Any:
        if len(inputs) != 1:
            raise InvalidOperationError(f"timedelta_to_days requires 1 input")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.dt.total_seconds() / 86400.0
        try:
            return a.total_seconds() / 86400.0
        except AttributeError:
            raise InvalidOperationError("Value is not a timedelta")

    def _op_date_add(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError(f"date_add requires 1 input")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        a = pd.to_datetime(a)
        amount = params.get("amount", 0)
        unit = params.get("unit", "days")
        if unit == "days":
            return a + pd.Timedelta(days=amount)
        elif unit == "months":
            return a + pd.DateOffset(months=amount)
        elif unit == "years":
            return a + pd.DateOffset(years=amount)
        raise InvalidOperationError(f"Invalid unit {unit}")

    def _op_shift(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError("shift requires 1 input")
        periods = params.get("periods", 1)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.shift(periods=periods)

    def _op_diff(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError("diff requires 1 input")
        periods = params.get("periods", 1)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.diff(periods=periods)

    def _op_rolling_mean(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError("rolling_mean requires 1 input")
        window = params.get("window", 3)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.rolling(window=window, min_periods=1).mean()

    def _op_rolling_sum(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if len(inputs) != 1:
            raise InvalidOperationError("rolling_sum requires 1 input")
        window = params.get("window", 3)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.rolling(window=window, min_periods=1).sum()

    # -------------------------------------------------------------------------
    # Missing operations implementation
    # -------------------------------------------------------------------------

    def _op_abs(self, inputs: List[Any]) -> Any:
        if not inputs:
            raise InvalidOperationError("abs requires 1 input")
        a = inputs[0]
        return np.abs(a)

    def _op_round(self, inputs: List[Any], params: Dict[str, Any]) -> Any:
        if not inputs:
            raise InvalidOperationError("round requires 1 input")
        decimals = params.get("decimals", 0)
        a = inputs[0]
        if isinstance(a, pd.Series):
            return a.round(decimals)
        return round(a, decimals)

    def _op_pow(self, inputs: List[Any]) -> Any:
        if len(inputs) != 2:
            raise InvalidOperationError("pow requires 2 inputs")
        a, b = inputs
        return np.power(a, b)

    def _op_sqrt(self, inputs: List[Any]) -> Any:
        if not inputs:
            raise InvalidOperationError("sqrt requires 1 input")
        return np.sqrt(inputs[0])

    def _op_log(self, inputs: List[Any]) -> Any:
        if not inputs:
            raise InvalidOperationError("log requires 1 input")
        return np.log(inputs[0])

    def _op_unique(self, inputs: List[Any]) -> pd.Series:
        if not inputs:
            raise InvalidOperationError("unique requires 1 input")
        a = inputs[0]
        if isinstance(a, pd.Series):
            return pd.Series(a.unique())
        return pd.Series(np.unique(a))

    def _op_value_counts(self, inputs: List[Any]) -> pd.Series:
        if not inputs:
            raise InvalidOperationError("value_counts requires 1 input")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.value_counts()

    def _op_nsmallest(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if not inputs:
            raise InvalidOperationError("nsmallest requires 1 input")
        n = params.get("n")
        if n is None:
            raise InvalidOperationError("nsmallest requires 'n' parameter")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.nsmallest(n)

    def _op_head(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if not inputs:
            raise InvalidOperationError("head requires 1 input")
        n = params.get("n", 5)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.head(n)

    def _op_tail(self, inputs: List[Any], params: Dict[str, Any]) -> pd.Series:
        if not inputs:
            raise InvalidOperationError("tail requires 1 input")
        n = params.get("n", 5)
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.tail(n)

    def _op_idxmin(self, inputs: List[Any]) -> Any:
        if not inputs:
            raise InvalidOperationError("idxmin requires 1 input")
        a = inputs[0]
        if not isinstance(a, pd.Series):
            a = pd.Series(a)
        return a.idxmin()
