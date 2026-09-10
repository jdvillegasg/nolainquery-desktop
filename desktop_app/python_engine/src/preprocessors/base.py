from typing import Dict, Any, List
from typing import Protocol

class BasePreprocessor(Protocol):
    """Protocol for data preprocessors."""
    
    def process_to_parquet(self, output_dir: str) -> List[str]:
        """
        Process the source data and save as Parquet files to avoid OOM.
        
        Args:
            output_dir: Directory where the parquet files should be saved.
            
        Returns:
            List of paths to the created Parquet files.
        """
        ...
        
    def get_context_metadata(self, num_rows: int = 10) -> Dict[str, Any]:
        """
        Extract context metadata including schemas and sample data.
        
        Args:
            num_rows: Number of sample rows to include.
            
        Returns:
            Dictionary with 'available_columns', 'sample_data', and 'column_semantics'.
        """
        ...
