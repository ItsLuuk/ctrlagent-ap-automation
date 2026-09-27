#!/usr/bin/env python3
"""Lightweight PDF layout benchmark for the three-invoice research corpus.

Measures coordinate extraction and table/line-item reconstruction quality for
pdfplumber and PyMuPDF. This is a research harness, not a production parser.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".desktop-builds" / "research-python"))

import fitz  # type: ignore  # noqa: E402
import pdfplumber  # type: ignore  # noqa: E402

CASES = [
    (ROOT / "corpus" / "research-three", "Invoice-RAX3IIUH-0002.pdf"),
    (ROOT / "corpus" / "research-three", "factuur_2607551285.pdf"),
    (ROOT / "corpus" / "telic-reporting", "Superdoos.nl invoice.pdf"),
]


def norm(value: object) -> str:
    text = str(value or "").casefold()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def money_tokens(value: float) -> set[str]:
    value = abs(float(value))
    return {f"{value:.2f}".replace(".", ","), f"{value:.2f}", f"{value:g}", str(value)}


def score_line_items(rows: list[list[object]], expected: list[dict[str, object]]) -> dict[str, object]:
    normalized_rows = [norm(" | ".join(str(cell or "") for cell in row)) for row in rows]
    outcomes: list[dict[str, object]] = []
    for item in expected:
        description = norm(item.get("description"))
        amount = float(item.get("amount", 0))
        amount_forms = money_tokens(amount)
        matched = False
        for row in normalized_rows:
            # A complete table row contains the description and the amount, but
            # they need not be adjacent columns.
            if description and description in row and any(form in row.replace(" ", "") or form in row for form in amount_forms):
                matched = True
                break
        outcomes.append({"description": item.get("description"), "amount": amount, "matched": matched})
    return {
        "expected": len(expected),
        "matched": sum(1 for row in outcomes if row["matched"]),
        "items": outcomes,
    }


def pdfplumber_tables(page: object) -> list[list[list[object]]]:
    strategies = [
        ("lines", {}),
        ("text", {"text_strategy": "text", "intersection_tolerance": 5}),
    ]
    all_rows: list[list[list[object]]] = []
    for _, options in strategies:
        try:
            tables = page.extract_tables(options)  # type: ignore[attr-defined]
            all_rows.extend(table for table in tables if table)
        except Exception:
            pass
    # Preserve rows while removing exact duplicates across strategies.
    seen: set[str] = set()
    unique: list[list[list[object]]] = []
    for table in all_rows:
        for row in table:
            key = norm(" | ".join(str(cell or "") for cell in row))
            if key and key not in seen:
                seen.add(key)
                unique.append(row)
    return unique


def pymupdf_tables(page: object) -> list[list[list[object]]]:
    try:
        finder = page.find_tables()  # type: ignore[attr-defined]
        return [table.extract() for table in finder.tables]
    except Exception:
        return []


def main() -> None:
    sidecars: dict[Path, list[dict[str, object]]] = {}
    report: list[dict[str, object]] = []
    for folder, filename in CASES:
        sidecar_path = folder / "expected.json"
        if folder not in sidecars:
            sidecars[folder] = json.loads(sidecar_path.read_text(encoding="utf-8"))
        expected = next(entry for entry in sidecars[folder] if entry["file"] == filename)
        path = folder / filename
        started = time.perf_counter()
        plumber_rows: list[list[object]] = []
        plumber_words = 0
        plumber_pages = 0
        plumber_error = None
        try:
            with pdfplumber.open(path) as pdf:
                plumber_pages = len(pdf.pages)
                for page in pdf.pages:
                    plumber_words += len(page.extract_words())
                    plumber_rows.extend(pdfplumber_tables(page))
        except Exception as exc:
            plumber_error = f"{type(exc).__name__}: {exc}"
        plumber_ms = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        fitz_rows: list[list[object]] = []
        fitz_words = 0
        fitz_pages = 0
        fitz_error = None
        try:
            document = fitz.open(path)
            fitz_pages = document.page_count
            for page in document:
                fitz_words += len(page.get_text("words"))
                fitz_rows.extend(pymupdf_tables(page))
            document.close()
        except Exception as exc:
            fitz_error = f"{type(exc).__name__}: {exc}"
        fitz_ms = (time.perf_counter() - started) * 1000

        expected_items = expected.get("lineItems", [])
        report.append({
            "file": str(path.relative_to(ROOT)),
            "expected": expected,
            "pdfplumber": {
                "pages": plumber_pages,
                "words": plumber_words,
                "rows": len(plumber_rows),
                "elapsedMs": round(plumber_ms, 1),
                "lineItems": score_line_items(plumber_rows, expected_items),
                "error": plumber_error,
                "rowsSample": plumber_rows[:20],
            },
            "pymupdf": {
                "pages": fitz_pages,
                "words": fitz_words,
                "rows": len(fitz_rows),
                "elapsedMs": round(fitz_ms, 1),
                "lineItems": score_line_items(fitz_rows, expected_items),
                "error": fitz_error,
                "rowsSample": fitz_rows[:20],
            },
        })

    output = {
        "runAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "cases": report,
    }
    output_path = ROOT / "corpus" / "pdf-layout-research.json"
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in report:
        print(f"\n{case['file']}")
        for engine in ("pdfplumber", "pymupdf"):
            result = case[engine]
            score = result["lineItems"]
            print(
                f"  {engine:10} {result['elapsedMs']:7.1f} ms  "
                f"pages={result['pages']} words={result['words']} rows={result['rows']} "
                f"line-items={score['matched']}/{score['expected']} error={result['error']}"
            )
    print(f"\nReport written to {output_path}")


if __name__ == "__main__":
    main()
