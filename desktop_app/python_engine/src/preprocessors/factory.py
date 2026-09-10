import os
from .base import BasePreprocessor
from .csv_preprocessor import CSVPreprocessor
from .excel_preprocessor import ExcelPreprocessor
from .parquet_preprocessor import ParquetPreprocessor

class PreprocessorFactory:
    """Factory to get the right preprocessor for the file type."""
    
    @staticmethod
    def get_preprocessor(file_path: str, data_folder: str = None) -> BasePreprocessor:
        """
        Get the appropriate preprocessor based on the file extension.
        
        Args:
            file_path: Path to the source data file.
            data_folder: Output base folder for generated Parquet files.
            
        Returns:
            An instance of BasePreprocessor for the given file type.
        """
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.csv':
            return CSVPreprocessor(file_path, data_folder)
        elif ext in ['.xlsx', '.xls']:
            return ExcelPreprocessor(file_path, data_folder)
        elif ext == '.parquet':
            return ParquetPreprocessor(file_path, data_folder)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
