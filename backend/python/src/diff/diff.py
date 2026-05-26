#!/usr/bin/env python3
"""Diff Utility"""

from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Diff:
    added: List[str]
    removed: List[str]
    changed: List[Tuple[str, str]]

def compute_diff(old_lines, new_lines):
    added = [l for l in new_lines if l not in old_lines]
    removed = [l for l in old_lines if l not in new_lines]
    return Diff(added=added, removed=removed, changed=[])

old = ["a", "b", "c"]
new = ["a", "b", "d", "e"]
diff = compute_diff(old, new)
print(f"Added: {diff.added}, Removed: {diff.removed}")