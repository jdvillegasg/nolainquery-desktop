import sys
import os
from pathlib import Path

# Add the package to the path
sys.path.append(str(Path.cwd() / "packages" / "query_execution"))

from query_execution import SafePandasExecutor

# Create a dummy CSV
csv_path = "test_imports.csv"
import pandas as pd
pd.DataFrame({"A": [1, 2], "B": [3, 4]}).to_csv(csv_path, index=False)

try:
    executor = SafePandasExecutor(csv_path)
    code = """
import numpy as np
import pandas as pd
result = np.sum(df['A'])
"""
    res = executor.execute(code)
    print(f"Result: {res}")
finally:
    if os.path.exists(csv_path):
        os.remove(csv_path)
