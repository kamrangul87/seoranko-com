#!/usr/bin/env python3
"""Union two _sources.md files: dedupe by (URL, requirement), keep verified-on, renumber."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROW_RE = re.compile(
    r"^\|\s*(\d+|\—|-)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$"
)


def parse_rows(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.splitlines():
        m = ROW_RE.match(line.strip())
        if not m:
            continue
        num = m.group(1)
        if num in ("#",) or m.group(2).lower() == "source":
            continue
        # skip separator rows like |---|
        if set(m.group(2)) <= {"-", " "}:
            continue
        rows.append(
            {
                "source": m.group(2).strip(),
                "section": m.group(3).strip(),
                "requirement": m.group(4).strip(),
                "verified": m.group(5).strip(),
                "used_by": m.group(6).strip(),
            }
        )
    return rows


def key(row: dict) -> tuple[str, str]:
    return (row["source"], row["requirement"])


def merge_used_by(a: str, b: str) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for chunk in (a + ", " + b).split(","):
        item = chunk.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        parts.append(item)
    return ", ".join(parts)


def prefer_verified(a: str, b: str) -> str:
    """Keep the later verified-on date when both look like dates."""
    def parse(d: str) -> str:
        return d.strip()

    a, b = parse(a), parse(b)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", b):
        return max(a, b)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a):
        return a
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", b):
        return b
    return a or b


def union_rows(left: list[dict], right: list[dict]) -> list[dict]:
    # Preserve left order, then append new from right
    out: list[dict] = []
    index: dict[tuple[str, str], int] = {}
    for row in left + right:
        k = key(row)
        if k in index:
            i = index[k]
            existing = out[i]
            existing["used_by"] = merge_used_by(existing["used_by"], row["used_by"])
            existing["verified"] = prefer_verified(existing["verified"], row["verified"])
            # Prefer non-empty section
            if not existing["section"] and row["section"]:
                existing["section"] = row["section"]
        else:
            index[k] = len(out)
            out.append(dict(row))
    return out


def render(rows: list[dict], trailer: str) -> str:
    lines = [
        "# Source register",
        "",
        "Every threshold in a dossier must trace to a row here. When a source changes,",
        "this file identifies which strategies are now suspect.",
        "",
        "| # | Source | Section | Requirement | Date verified | Used by |",
        "|---|--------|---------|-------------|---------------|---------|",
    ]
    for i, row in enumerate(rows, start=1):
        lines.append(
            f"| {i} | {row['source']} | {row['section']} | {row['requirement']} | {row['verified']} | {row['used_by']} |"
        )
    lines.append("")
    if trailer.strip():
        lines.append(trailer.strip())
        lines.append("")
    return "\n".join(lines)


def extract_trailer(text: str) -> str:
    """Keep non-table prose after the table (hygiene flags, cadence notes)."""
    lines = text.splitlines()
    # Find last table row
    last_table = -1
    for i, line in enumerate(lines):
        if ROW_RE.match(line.strip()) and not line.strip().startswith("|---"):
            last_table = i
    if last_table < 0:
        return ""
    rest = "\n".join(lines[last_table + 1 :]).strip()
    # Drop conflict markers if any
    rest = re.sub(r"^<<<<<<<.*$", "", rest, flags=re.M)
    rest = re.sub(r"^=======.*$", "", rest, flags=re.M)
    rest = re.sub(r"^>>>>>>>.*$", "", rest, flags=re.M)
    return rest.strip()


def union_trailers(a: str, b: str) -> str:
    chunks: list[str] = []
    seen: set[str] = set()
    for t in (a, b):
        t = t.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        chunks.append(t)
    return "\n\n".join(chunks)


def main() -> None:
    if len(sys.argv) not in (3, 4):
        print(
            "Usage: union_sources.py <ours.md> <theirs.md> [out.md]",
            file=sys.stderr,
        )
        sys.exit(2)
    ours = Path(sys.argv[1]).read_text()
    theirs = Path(sys.argv[2]).read_text()
    out_path = Path(sys.argv[3]) if len(sys.argv) == 4 else Path(sys.argv[1])
    rows = union_rows(parse_rows(ours), parse_rows(theirs))
    trailer = union_trailers(extract_trailer(ours), extract_trailer(theirs))
    out_path.write_text(render(rows, trailer))
    print(f"Wrote {len(rows)} rows -> {out_path}")


if __name__ == "__main__":
    main()
