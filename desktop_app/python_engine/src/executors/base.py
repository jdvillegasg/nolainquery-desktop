from typing import Any, Protocol

class BaseGraphExecutor(Protocol):
    """
    Protocol for Computation Graph Executors.
    """
    
    def execute(self, graph: Any) -> Any:
        """
        Executes a computation graph and returns the final result.
        
        Args:
            graph: The computation graph to execute.
            
        Returns:
            The computed value from the output node (scalar, list, array, etc).
        """
        ...
        
def get_operations_documentation(registry: dict) -> str:
    """
    Generate comprehensive documentation of all operations for the system prompt.
    Takes a specific OPERATION_REGISTRY dictionary.
    """
    doc = "# AVAILABLE OPERATIONS\n\n"
    doc += "You MUST ONLY use the following operations. No other operations are allowed.\n\n"
    
    for op_name, spec in registry.items():
        doc += f"## {spec.name}\n"
        doc += f"**Description**: {spec.description}\n"
        
        if not hasattr(spec, 'inputs') or not spec.inputs:
            inputs_str = "None"
        else:
            inputs_str = f"List of {len(spec.inputs)} node(s) with types: {spec.inputs}"
            
        doc += f"**Inputs**: {inputs_str}\n"
        doc += f"**Output**: {getattr(spec, 'output', 'Any')}\n"
        
        if hasattr(spec, 'params') and spec.params:
            doc += "**Parameters**:\n"
            for param_name, param_desc in spec.params.items():
                req_params = getattr(spec, 'required_params', [])
                is_required = req_params and param_name in req_params
                req_prefix = " [REQUIRED]" if is_required else " [OPTIONAL]"
                doc += f"  - `{param_name}`{req_prefix}: {param_desc}\n"
        
        if hasattr(spec, 'example'):
            doc += f"**Example**: {spec.example}\n\n"
    
    return doc
