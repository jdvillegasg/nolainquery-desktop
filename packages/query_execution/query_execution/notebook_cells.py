"""Shared cell parser — must stay in sync with pythonNotebook.ts / parsePythonSteps."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class PythonCell:
    desc: Optional[str]
    code: str


def _is_section_comment(line: str) -> bool:
    """True for top-level `# ...` headers that delimit notebook cells."""
    if not line.strip():
        return False
    stripped = line.lstrip(" \t")
    return stripped.startswith("#") and len(line) == len(stripped)


def _is_import_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    return bool(re.match(r"^(?:import\b|from\s+[\w.]+\s+import\b)", stripped))


def _strip_import_lines(code: str) -> str:
    return "\n".join(line for line in code.split("\n") if not _is_import_line(line))


def _collapse_extra_blank_lines(code: str) -> str:
    """Collapse consecutive blank lines (common in LLM output) to a single newline."""
    return re.sub(r"\n(?:[ \t]*\n)+", "\n", code)


def _normalize_section_code(lines: List[str]) -> str:
    return _collapse_extra_blank_lines(_strip_import_lines("\n".join(lines)).strip())


def parse_python_steps(code: str) -> List[PythonCell]:
    sections: List[PythonCell] = []
    current_desc: Optional[str] = None
    current_lines: List[str] = []

    def flush(next_desc: Optional[str] = None) -> None:
        nonlocal current_desc, current_lines
        normalized = _normalize_section_code(current_lines)
        if normalized:
            sections.append(PythonCell(desc=current_desc, code=normalized))
        current_desc = next_desc
        current_lines = []

    for line in code.split("\n"):
        if _is_section_comment(line):
            comment = line.strip()[1:].strip()
            if any(l.strip() for l in current_lines):
                flush(comment)
            else:
                current_desc = f"{current_desc} · {comment}" if current_desc else comment
        else:
            current_lines.append(line)

    if any(l.strip() for l in current_lines):
        normalized = _normalize_section_code(current_lines)
        if normalized:
            sections.append(PythonCell(desc=current_desc, code=normalized))

    return sections
