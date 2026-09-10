import sys
import traceback
from src.preprocessors.factory import PreprocessorFactory

try:
    source_path = '/home/julian/Documents/micro-saas/nolain-data-query/desktop_app/python_engine/src/data/online_retail_II/Year 2010-2011.parquet'
    preprocessor = PreprocessorFactory.get_preprocessor(source_path)
    metadata = preprocessor.get_context_metadata()
    print("Success")
except Exception as e:
    traceback.print_exc()
