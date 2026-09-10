/** Shared cell parser — must stay in sync with notebook_cells.py */

export interface PythonStep {
  desc?: string;
  code: string;
}

function isSectionComment(line: string): boolean {
  // Only column-0 `#` headers split notebook cells (must match notebook_cells.py).
  return line.length > 0 && line[0] === '#' && line.trimStart() === line;
}

/** True for top-level import lines (e.g. `import pandas as pd`). */
export function isImportLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  return /^(?:import\b|from\s+[\w.]+\s+import\b)/.test(trimmed);
}

export function stripImportLines(code: string): string {
  return code
    .split('\n')
    .filter(line => !isImportLine(line))
    .join('\n');
}

/** Collapse consecutive blank lines (common in LLM output) to a single newline. */
function collapseExtraBlankLines(code: string): string {
  return code.replace(/\n(?:[ \t]*\n)+/g, '\n');
}

function normalizeSectionCode(lines: string[]): string {
  return collapseExtraBlankLines(stripImportLines(lines.join('\n')).trim());
}

export function parsePythonSteps(code: string): PythonStep[] {
  const sections: PythonStep[] = [];
  const lines = code.split('\n');
  let current: { desc?: string; lines: string[] } = { lines: [] };

  const flushCurrent = (nextDesc?: string) => {
    const normalized = normalizeSectionCode(current.lines);
    if (normalized) {
      sections.push({ desc: current.desc, code: normalized });
    }
    current = { desc: nextDesc, lines: [] };
  };

  for (const line of lines) {
    if (isSectionComment(line)) {
      if (current.lines.some(l => l.trim())) {
        flushCurrent(line.replace(/^#\s*/, ''));
      } else {
        const title = line.replace(/^#\s*/, '');
        current.desc = current.desc ? `${current.desc} · ${title}` : title;
      }
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.some(l => l.trim())) {
    const normalized = normalizeSectionCode(current.lines);
    if (normalized) {
      sections.push({ desc: current.desc, code: normalized });
    }
  }

  return sections;
}

export function parsePandasSectionCodes(code: string): string[] {
  const steps = parsePythonSteps(code);
  if (steps.length > 0) return steps.map(step => step.code);
  const fallback = stripImportLines(code).trim();
  return fallback ? [fallback] : [];
}
