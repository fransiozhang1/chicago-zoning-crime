"""
table_extractor.py — Extract tables from PDF documents using pdfplumber.

Each extracted table is converted into a human-readable text representation
and a structured JSON row, then saved to outputs/tables/tables.csv.

Returns a list of table records ready to be wrapped as LlamaIndex Document objects.
"""

import csv
import json
import os
from typing import Any, Optional


def _sanitize(val: Any) -> str:
    """Convert None → empty string, strip whitespace, collapse newlines."""
    if val is None:
        return ""
    s = str(val).strip()
    s = " ".join(s.split())
    return s


def _build_table_text(
    source_file: str,
    page_number: int,
    table_index: int,
    headers: list[str],
    rows: list[list[str]],
) -> str:
    """Create a text representation of a table for embedding and display."""
    parts = [
        f"TABLE FROM {source_file} PAGE {page_number}",
    ]
    if headers:
        parts.append("Header: " + " / ".join(headers))
    for row in rows:
        parts.append("Row: " + " | ".join(row))
    return "\n".join(parts)


def extract_tables_from_pdf(
    filepath: str,
    output_dir: Optional[str] = None,
) -> list[dict]:
    """
    Extract all tables from a PDF file.

    Args:
        filepath: Path to the PDF file.
        output_dir: If provided, write tables.csv into this directory.

    Returns:
        List of table records with keys:
            table_id, source_file, page_number, table_index,
            table_text, raw_table_json
    """
    import pdfplumber

    fname = os.path.basename(filepath)
    table_records: list[dict] = []

    with pdfplumber.open(filepath) as pdf:
        total_pages = len(pdf.pages)
        table_count = 0

        for page_num, page_obj in enumerate(pdf.pages, start=1):
            try:
                tables_on_page = page_obj.extract_tables()
            except Exception:
                continue

            if not tables_on_page:
                continue

            for tab_idx, table_data in enumerate(tables_on_page):
                if not table_data or len(table_data) < 2:
                    # Skip tables with fewer than 2 rows (header + data)
                    continue

                # Normalize all cells
                cleaned: list[list[str]] = []
                for row in table_data:
                    cleaned.append([_sanitize(cell) for cell in row])

                # Remove fully empty rows
                cleaned = [r for r in cleaned if any(c for c in r)]

                if len(cleaned) < 2:
                    continue

                headers = cleaned[0]
                data_rows = cleaned[1:]

                table_id = f"{fname}_p{page_num}_t{tab_idx + 1}"
                table_text = _build_table_text(
                    fname, page_num, tab_idx + 1, headers, data_rows
                )
                raw_json = json.dumps(
                    {"headers": headers, "rows": data_rows},
                    ensure_ascii=False,
                )

                table_records.append({
                    "table_id": table_id,
                    "source_file": fname,
                    "page_number": page_num,
                    "table_index": tab_idx + 1,
                    "table_text": table_text,
                    "raw_table_json": raw_json,
                })
                table_count += 1

    print(f"  [TABLE] {fname}  →  {table_count} table(s) extracted  (from {total_pages} page(s))")

    # Save CSV if output_dir is provided
    if output_dir and table_records:
        os.makedirs(output_dir, exist_ok=True)
        csv_path = os.path.join(output_dir, "tables.csv")
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "table_id", "source_file", "page_number",
                    "table_index", "table_text", "raw_table_json",
                ],
            )
            writer.writeheader()
            writer.writerows(table_records)
        print(f"  [TABLE] Saved {len(table_records)} table(s) to {csv_path}")

    return table_records
