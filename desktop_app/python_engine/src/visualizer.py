"""
DAG Visualizer for Computation Graphs

This module uses Graphviz to generate visual representations of the computation graphs.
"""

from typing import Optional
import graphviz
from .schema import ComputationGraph

class GraphVisualizer:
    """
    Generates visualizations for ComputationGraph objects.
    """
    
    def __init__(self, format: str = 'png'):
        """
        Initialize the visualizer.
        
        Args:
            format: Output format (png, svg, pdf, etc.)
        """
        self.format = format

    def visualize(self, graph: ComputationGraph, output_path: str, view: bool = False) -> str:
        """
        Generate a visualization of the computation graph.
        
        Args:
            graph: The ComputationGraph object to visualize.
            output_path: Path to save the output image (without extension).
            view: Whether to open the generated image.
            
        Returns:
            Path to the rendered file.
        """
        dot = graphviz.Digraph(
            comment=f"Computation Graph: {graph.graph_id}",
            format=self.format
        )
        
        # Set graph attributes for better layout
        dot.attr(rankdir='TB')  # Top to Bottom
        dot.attr('node', shape='box', style='rounded,filled', fillcolor='#f0f0f0')
        
        # Add nodes
        for node in graph.nodes:
            # Create a label that shows opcode and params
            label = f"[{node.id}]\n{node.op}"
            if node.params:
                # Add params to label, truncated if too long
                params_str = "\n".join([f"{k}={v}" for k, v in node.params.items()])
                if len(params_str) > 50:
                    params_str = params_str[:47] + "..."
                label += f"\n{params_str}"
                
            # Highlight output node
            if node.id == graph.output_node:
                dot.node(node.id, label, fillcolor='#d0ffd0', penwidth='2.0')
            else:
                dot.node(node.id, label)
                
            # Add edges
            for input_id in node.inputs:
                dot.edge(input_id, node.id)
                
        # Render
        try:
            return dot.render(output_path, view=view, cleanup=True)
        except Exception as e:
            # Fallback or error handling
            print(f"Visualization warning: {str(e)}")
            return ""

