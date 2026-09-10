export interface SandboxPreloadedItem {
  name: string;
  kind: string;
  description: string;
}

export interface SandboxEnvironmentSpec {
  preloaded: SandboxPreloadedItem[];
  allowed_imports: string[];
  builtins: string[];
  rules: string[];
  toolbar_names: string[];
  starter_snippet: string;
}

export const FALLBACK_SANDBOX_ENVIRONMENT: SandboxEnvironmentSpec = {
  preloaded: [
    { name: 'df', kind: 'dataframe', description: 'Copy of the open dataset' },
    { name: 'result', kind: 'variable', description: 'Assign your final answer here' },
    { name: 'pd', kind: 'module', description: 'pandas' },
    { name: 'np', kind: 'module', description: 'numpy' },
    { name: 'pandas', kind: 'module', description: 'Same as pd' },
    { name: 'numpy', kind: 'module', description: 'Same as np' },
    { name: 'math', kind: 'module', description: 'Standard math functions' },
    { name: 'datetime', kind: 'module', description: 'Date and time utilities' },
  ],
  allowed_imports: ['scipy', 'scipy.stats'],
  builtins: [
    'abs', 'all', 'any', 'bool', 'dict', 'divmod', 'enumerate', 'filter', 'float', 'int',
    'len', 'list', 'map', 'max', 'min', 'pow', 'print', 'range', 'reversed', 'round',
    'set', 'slice', 'sorted', 'str', 'sum', 'type', 'zip',
  ],
  rules: [
    'Assign the final answer to result.',
    'Plotting methods (plot, hist, show, etc.) are not allowed.',
    'File I/O (to_csv, to_json, etc.) is not allowed.',
    'Only modules listed here may be imported.',
  ],
  toolbar_names: ['pd', 'np', 'math', 'datetime', 'df', 'result'],
  starter_snippet:
    'filtered = df[df["column"] > 0]\nresult = filtered.groupby("category").size().reset_index(name="count")',
};

export async function fetchSandboxEnvironment(
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
): Promise<SandboxEnvironmentSpec> {
  const response = await fetchFn(`${baseUrl}/sandbox/environment`);
  if (!response.ok) {
    return FALLBACK_SANDBOX_ENVIRONMENT;
  }
  const body = (await response.json()) as { environment?: SandboxEnvironmentSpec };
  return body.environment ?? FALLBACK_SANDBOX_ENVIRONMENT;
}
