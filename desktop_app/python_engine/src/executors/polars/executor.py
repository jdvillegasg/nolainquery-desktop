import polars as pl
from typing import Dict, Any, List
from ...schema import ComputationGraph, Node, OperationType

class ExecutionError(Exception):
    pass

class InvalidOperationError(ExecutionError):
    pass

class GraphExecutor:
    """
    Polars AST Executor.
    Maps node operations to lazy Polars LazyFrame expressions (AST).
    Only computes data at the output_node via .collect().
    """
    def __init__(self, source_data: str):
        self.source_data = source_data
        self.lf = pl.scan_parquet(source_data)
        self.node_cache: Dict[str, pl.Expr] = {}
        # Track lazy conditions that should be applied globally for filter extraction
        self.conditions_cache: List[str] = []
        
    def execute(self, graph: ComputationGraph) -> Any:
        self.node_cache.clear()
        self.conditions_cache.clear()
        
        for node in graph.nodes:
            try:
                result = self._execute_node(node)
                self.node_cache[node.id] = result
            except Exception as e:
                raise ExecutionError(f"Failed to execute node '{node.id}' (op: {node.op}): {str(e)}") from e
                
        if graph.output_node not in self.node_cache:
            raise ExecutionError(f"Output node '{graph.output_node}' was not computed")
            
        final_expr = self.node_cache[graph.output_node]
        
        try:
            # We construct a Context that leverages conditions
            ctx = self.lf
            if self.conditions_cache:
                # We apply the SQL filter conditions inside polite Polars SQLContext 
                ctx_sql = pl.SQLContext(source_table=self.lf)
                where_clause = " AND ".join(self.conditions_cache)
                ctx = ctx_sql.execute(f"SELECT * FROM source_table WHERE {where_clause}")
                
            # Trigger computation
            res_df = ctx.select(final_expr).collect()
            
            # Post-process to unwrap
            if res_df.shape[1] == 1:
                series = res_df.to_series()
                if len(series) == 1:
                    return series[0]
                return series.to_list()
            return res_df.to_dicts()
        except Exception as e:
            raise ExecutionError(f"Polars AST evaluation failed: {str(e)}")
            
    def _execute_node(self, node: Node) -> pl.Expr:
        input_values = [self.node_cache[inp] for inp in node.inputs]
        
        if node.op == OperationType.FILTER_EXTRACT:
            col = node.params.get('column')
            cond = node.params.get('condition')
            if cond:
                cond_sql = cond.replace('==', '=')
                self.conditions_cache.append(f"({cond_sql})")
            return pl.col(col)
            
        elif node.op == OperationType.LOAD_CONSTANT:
            return pl.lit(node.params.get('value'))
            
        elif node.op == OperationType.GROUPBY_AGG:
            # Note: A real group by is more complex to return an expression context inline
            # Polars window functions let you compute aggregate per group
            groupby = node.params.get('groupby_column')
            agg_col = node.params.get('agg_column')
            agg_func = node.params.get('agg_function')
            
            if agg_col in self.node_cache:
                agg_expr = self.node_cache[agg_col]
            else:
                agg_expr = pl.col(agg_col)
                
            func_map = {'sum': 'sum', 'mean': 'mean', 'count': 'count', 'max': 'max', 'min': 'min', 'std': 'std'}
            return getattr(agg_expr, func_map[agg_func])().over(pl.col(groupby))
            
        elif node.op == OperationType.ADD:
            return input_values[0] + input_values[1]
            
        elif node.op == OperationType.SUBTRACT:
            return input_values[0] - input_values[1]
            
        elif node.op == OperationType.MULTIPLY:
            return input_values[0] * input_values[1]
            
        elif node.op == OperationType.DIVIDE:
            return input_values[0] / input_values[1]
            
        elif node.op == OperationType.EQ:
            return input_values[0] == input_values[1]
            
        elif node.op == OperationType.GT:
            return input_values[0] > input_values[1]
            
        elif node.op == OperationType.LT:
            return input_values[0] < input_values[1]
            
        elif node.op == OperationType.DOT_PRODUCT:
            return (input_values[0] * input_values[1]).sum()
            
        elif node.op == OperationType.PERCENTAGE_CHANGE:
            return (input_values[1] - input_values[0]) / input_values[0]
            
        # Parity with pandas operations
        elif node.op == OperationType.NLARGEST:
            n = node.params.get('n', 5)
            # top_k returns the largest values in descending order
            return input_values[0].top_k(n)
            
        elif node.op == OperationType.INDEX:
            indices = node.params.get('indices')
            if isinstance(indices, str) and indices in self.node_cache:
                mask = self.node_cache[indices]
                return input_values[0].filter(mask)
            elif isinstance(indices, list):
                # Eagerly fallback for integer list indexing if needed, or use gather
                return input_values[0].gather(indices)
            else:
                return input_values[0].gather([indices]).first()
                
        elif node.op == OperationType.IDXMAX:
            return input_values[0].arg_max()
            
        elif node.op == OperationType.TO_DATETIME:
            fmt = node.params.get('format')
            if fmt:
                return input_values[0].str.strptime(pl.Datetime, format=fmt)
            return input_values[0].str.strptime(pl.Datetime)
            
        elif node.op == OperationType.STR:
            return input_values[0].cast(pl.Utf8)
            
        elif node.op == OperationType.STARTSWITH:
            prefix = node.params.get('prefix')
            return input_values[0].str.starts_with(prefix)
            
        elif node.op == OperationType.ISIN:
            values = node.params.get('values')
            return input_values[0].is_in(values)
            
        elif node.op == OperationType.GET_INDEX:
            # LazyFrame columns don't have natural index, so we return a placeholder or eager row numbers.
            # In purely eager pandas, this extracts the active index. 
            # We'll use eager execution for this specific node if needed, or return a literal indicator.
            return pl.arange(0, input_values[0].count())
            
        # Aggregations
        elif node.op == OperationType.MEAN: return input_values[0].mean()
        elif node.op == OperationType.SUM: return input_values[0].sum()
        elif node.op == OperationType.MAX: return input_values[0].max()
        elif node.op == OperationType.MIN: return input_values[0].min()
        elif node.op == OperationType.COUNT: return input_values[0].count()
        elif node.op == OperationType.NUNIQUE: return input_values[0].n_unique()
        elif node.op == OperationType.STD: return input_values[0].std()
        elif node.op == OperationType.MEDIAN: return input_values[0].median()
        elif node.op == OperationType.ISNAN: return input_values[0].is_null()
        
        else:
            raise InvalidOperationError(f"Unsupported Polars AST operation: {node.op}")
