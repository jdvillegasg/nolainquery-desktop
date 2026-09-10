"""
Validator Module

This module provides validation methods to compare executor results with ground truth values.
Supports comparison of various data types including floats, integers, and strings.
"""

from typing import Any, Tuple, Union
import pandas as pd


def compare_results(computed: Any, ground_truth: Any, tolerance: float = 1e-3) -> Tuple[bool, str]:
    """
    Compare computed result with ground truth.
    
    Supports comparison of float, int, and string types. For numeric types,
    applies tolerance-based comparison. For strings, uses exact equality.
    
    Args:
        computed: The computed result from execution.
        ground_truth: The ground truth value.
        tolerance: Tolerance for floating point comparison (only used for numeric types).
    
    Returns:
        Tuple of (match: bool, details: str)
    """
    try:
        # Check if both are strings
        if isinstance(computed, str) or isinstance(ground_truth, str):
            # If one is string, both should be strings for comparison
            computed_str = str(computed)
            ground_truth_str = str(ground_truth)
            
            matches = computed_str == ground_truth_str
            if matches:
                return True, f"String match: '{computed_str}'"
            else:
                return False, f"String mismatch: computed='{computed_str}', ground_truth='{ground_truth_str}'"
        
        # Try numeric comparison
        # Convert to numeric types, handling NaN
        computed_val = float(computed) if not pd.isna(computed) else float('nan')
        ground_truth_val = float(ground_truth) if not pd.isna(ground_truth) else float('nan')
        
        # Check if both are NaN
        if pd.isna(computed_val) and pd.isna(ground_truth_val):
            return True, "Both are NaN"
        
        # Check if one is NaN and the other is not
        if pd.isna(computed_val) or pd.isna(ground_truth_val):
            return False, f"One value is NaN: computed={computed_val}, ground_truth={ground_truth_val}"
        
        # Check if both are integers (to provide better reporting)
        if isinstance(computed, int) and isinstance(ground_truth, int):
            matches = computed == ground_truth
            if matches:
                return True, f"Integer match: {computed}"
            else:
                diff = abs(computed - ground_truth)
                return False, f"Integer mismatch: computed={computed}, ground_truth={ground_truth}, diff={diff}"
        
        # Floating point comparison with tolerance
        diff = abs(computed_val - ground_truth_val)
        relative_diff = diff / abs(ground_truth_val) if ground_truth_val != 0 else diff
        
        matches = diff <= tolerance or relative_diff <= tolerance
        
        if matches:
            return True, f"Match within tolerance (diff: {diff:.2e})"
        else:
            return False, f"Mismatch: computed={computed_val:.6f}, ground_truth={ground_truth_val:.6f}, diff={diff:.6f}, relative={relative_diff:.2%}"
    
    except Exception as e:
        return False, f"Comparison error: {str(e)}"
