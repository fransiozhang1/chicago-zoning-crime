"""
table_to_text.py — Extract tables from a PDF, classify them, and convert each
row into natural-language text descriptions for downstream RAG retrieval.

Usage:
    python src/table_to_text.py \
      --input data/raw_documents/chicago-il-1.pdf \
      --output-dir outputs/tables

Outputs:
    outputs/tables/raw_tables.csv        — raw extracted table data
    outputs/tables/table_text_chunks.csv — one natural-language row per chunk
"""

import argparse
import csv
import json
import os
import re
from typing import Any, Optional


# ---------------------------------------------------------------------------
#  helpers
# ---------------------------------------------------------------------------

def _sanitize(val: Any) -> str:
    """None → '' , strip, collapse whitespace."""
    if val is None:
        return ""
    return " ".join(str(val).strip().split())


def _is_status_cell(cell: str) -> bool:
    """Check if a cell looks like a use-table status value."""
    c = cell.upper().replace(" ", "")
    return c in {"P", "S", "PD", "-", "P/S", "NOTALLOWED", "C", "L",
                 "P*", "S*", "PD*"}


def _status_to_phrase(status: str) -> str:
    """Map a short status code to a readable English phrase."""
    s = status.strip().upper().replace(" ", "")
    if s in {"P"}:
        return "permitted by-right"
    if s in {"S"}:
        return "requires special use approval"
    if s in {"PD"}:
        return "requires planned development approval"
    if s in {"-", "", "NOTALLOWED"}:
        return "not allowed"
    if s in {"P/S"}:
        return "permitted by-right or requires special use approval depending on conditions"
    if s in {"C"}:
        return "conditional use"
    if s in {"L"}:
        return "limited use"
    # fallback: keep original
    return status.strip()


# ---------------------------------------------------------------------------
#  extraction
# ---------------------------------------------------------------------------

def extract_tables_from_pdf(filepath: str) -> list[dict]:
    """
    Extract all tables from a single PDF file using pdfplumber.

    Returns a list of dicts with keys:
        table_id, source_file, page_number, table_index, table_data
    where table_data = {"headers": [...], "rows": [[...], ...]}
    """
    import pdfplumber

    fname = os.path.basename(filepath)
    records: list[dict] = []

    with pdfplumber.open(filepath) as pdf:
        total_pages = len(pdf.pages)

        for page_num, page_obj in enumerate(pdf.pages, start=1):
            try:
                tables_on_page = page_obj.extract_tables()
            except Exception:
                continue

            if not tables_on_page:
                continue

            for tab_idx, raw_table in enumerate(tables_on_page):
                if not raw_table or len(raw_table) < 2:
                    continue

                # Normalise every cell
                cleaned: list[list[str]] = []
                for row in raw_table:
                    cleaned.append([_sanitize(cell) for cell in row])

                # Drop fully-empty rows
                cleaned = [r for r in cleaned if any(c for c in r)]
                if len(cleaned) < 2:
                    continue

                headers = cleaned[0]
                data_rows = cleaned[1:]

                table_id = f"{fname}_p{page_num}_t{tab_idx + 1}"
                records.append({
                    "table_id": table_id,
                    "source_file": fname,
                    "page_number": page_num,
                    "table_index": tab_idx + 1,
                    "table_data": {
                        "headers": headers,
                        "rows": data_rows,
                    },
                })

    print(f"[EXTRACT]  {fname}  →  {len(records)} table(s) from {total_pages} page(s)")
    return records


# ---------------------------------------------------------------------------
#  classification
# ---------------------------------------------------------------------------

def _table_full_text(table_data: dict) -> str:
    """Flatten an entire table into a single lower-cased string for keyword matching."""
    parts = table_data.get("headers", []) + [
        cell for row in table_data.get("rows", []) for cell in row
    ]
    return " ".join(parts).lower()


def classify_table(table_data: dict) -> str:
    """
    Classify a table into one of:
        use_table, bulk_density_table, parking_table,
        landscaping_screening_table, zoning_conversion_table, unknown_table
    """
    txt = _table_full_text(table_data)

    # Use-table keywords (look for P / S / PD status cells + use-group words)
    # We count how many cells look like status cells to increase confidence.
    all_cells = [c.lower() for row in table_data.get("rows", []) for c in row]
    status_count = sum(1 for c in all_cells if _is_status_cell(c))
    use_keywords = ["permitted", "special use", "not allowed", "use category",
                    "zoning district", "use group", "accessory use",
                    "adult use", "amusement", "liquor"]
    use_hits = sum(1 for kw in use_keywords if kw in txt)

    if status_count >= 4 and use_hits >= 2:
        return "use_table"

    # Bulk / density
    bulk_kw = ["minimum lot area", "lot area per unit", "floor area ratio",
               "far", "max height", "setback", "yard", "density",
               "lot width", "lot coverage", "floor area"]
    if any(kw in txt for kw in bulk_kw):
        return "bulk_density_table"

    # Parking
    park_kw = ["parking", "loading", "spaces per", "per dwelling",
               "per unit", "seats", "berth"]
    if any(kw in txt for kw in park_kw):
        return "parking_table"

    # Landscaping / screening
    ls_kw = ["landscaping", "screening", "buffer", "fence", "planting",
             "landscape", "green"]
    if any(kw in txt for kw in ls_kw):
        return "landscaping_screening_table"

    # Zoning conversion
    conv_kw = ["existing district", "new district", "zoning district conversion",
               "conversion", "previous district"]
    if any(kw in txt for kw in conv_kw):
        return "zoning_conversion_table"

    # Fallback: re-check use table with looser criteria
    if status_count >= 2:
        return "use_table"

    return "unknown_table"


# ---------------------------------------------------------------------------
#  text conversion
# ---------------------------------------------------------------------------

def _convert_use_table(table_data: dict, table_id: str, source_file: str,
                       page_number: int, table_index: int) -> list[dict]:
    """
    Convert a use table.

    Expected structure:
      Header: [UseCategory, Dist1, Dist2, Dist3, ...]
      Row:    [UseType,     -,     P,     S,  ...]

    Produces one text_description per row, grouping districts by status.
    """
    headers = table_data["headers"]
    rows = table_data["rows"]
    if len(headers) < 2:
        return []

    district_headers = headers[1:]  # skip "Use"/"Use Category"
    results: list[dict] = []

    for row_idx, row in enumerate(rows):
        if len(row) < 2:
            continue
        use_type = row[0]
        if not use_type:
            continue
        values = row[1:]

        # Align to header length by padding or truncating
        if len(values) < len(district_headers):
            values += [""] * (len(district_headers) - len(values))
        else:
            values = values[:len(district_headers)]

        # Group districts by status
        groups: dict[str, list[str]] = {}  # status_phrase → [districts]
        for dist, val in zip(district_headers, values):
            if not dist or not dist.strip():
                continue
            phrase = _status_to_phrase(val)
            groups.setdefault(phrase, []).append(dist.strip())

        if not groups:
            continue

        # Build sentence
        parts = []
        # Sort groups so "not allowed" comes first, then more permissive
        group_order = sorted(groups.items(),
                             key=lambda x: (0 if "not allowed" in x[0]
                                            else 1 if "special use" in x[0]
                                            else 2))

        for status_phrase, districts in group_order:
            dist_list = human_join(districts)
            if status_phrase == "not allowed":
                parts.append(f"{use_type} is not allowed in {dist_list}")
            elif "special use" in status_phrase:
                parts.append(f"requires special use approval in {dist_list}")
            elif "planned development" in status_phrase:
                parts.append(f"requires planned development in {dist_list}")
            elif "depending on conditions" in status_phrase:
                parts.append(f"is permitted by-right or requires special use approval depending on conditions in {dist_list}")
            else:
                parts.append(f"is {status_phrase} in {dist_list}")

        sentence = f"{parts[0]}" if parts else ""
        if len(parts) > 1:
            # Replace first period with comma and join
            sentence = "; ".join(parts) + "."

        if not sentence:
            continue

        results.append({
            "table_id": table_id,
            "source_file": source_file,
            "page_number": page_number,
            "table_index": table_index,
            "table_type": "use_table",
            "row_id": f"{table_id}_r{row_idx + 1}",
            "text_description": sentence,
        })

    return results


def _convert_bulk_density_table(table_data: dict, table_id: str, source_file: str,
                                 page_number: int, table_index: int) -> list[dict]:
    """
    Convert a bulk/density table.

    Two common structures:
      A) Header: [District, MinLotArea, MaxFAR, MaxHeight, ...]
         Rows:   [RT-4,    2500,       1.2,    45,       ...]
      B) Header: [Parameter, Value, Unit] or simple key-value
    """
    headers = [h.lower() for h in table_data["headers"]]
    rows = table_data["rows"]
    if not headers or not rows:
        return []

    # Detect district column (first column containing known district pattern)
    district_col = 0  # assume first col is district or label
    dist_pattern = re.compile(
        r"^(R[SMT]\s*-?\s*\d|B\d|C\d|M\d|D(?:C|X|T|P)|P[DOS]|POS|DR|"
        r"dash\s*\d)", re.IGNORECASE
    )
    # Check if first column looks like a district in most rows
    first_col_district_count = 0
    for row in rows[:10]:
        if row and dist_pattern.match(row[0]):
            first_col_district_count += 1

    results: list[dict] = []

    if first_col_district_count >= 2:
        # Structure A: [District | param1 | param2 | ...]
        for row_idx, row in enumerate(rows):
            if not row or not row[0].strip():
                continue
            district = row[0]
            for col_idx in range(1, min(len(row), len(headers))):
                val = row[col_idx].strip()
                if not val or val in {"-", "--", "N/A", "n/a", "NA"}:
                    continue
                param = headers[col_idx].strip()
                sentence = (
                    f"In {district}, the {param} is {val}. "
                    f"(Source: {source_file}, page {page_number})"
                )
                results.append({
                    "table_id": table_id,
                    "source_file": source_file,
                    "page_number": page_number,
                    "table_index": table_index,
                    "table_type": "bulk_density_table",
                    "row_id": f"{table_id}_r{row_idx + 1}_c{col_idx + 1}",
                    "text_description": sentence,
                })
    else:
        # Structure B: generic key-value
        for row_idx, row in enumerate(rows):
            if len(row) < 2:
                continue
            key = row[0].strip()
            val = " / ".join(c.strip() for c in row[1:] if c.strip())
            if not key or not val:
                continue
            sentence = (
                f"In this table from {source_file} page {page_number}, "
                f"{key} is {val}."
            )
            results.append({
                "table_id": table_id,
                "source_file": source_file,
                "page_number": page_number,
                "table_index": table_index,
                "table_type": "bulk_density_table",
                "row_id": f"{table_id}_r{row_idx + 1}",
                "text_description": sentence,
            })

    return results


def _convert_parking_table(table_data: dict, table_id: str, source_file: str,
                            page_number: int, table_index: int) -> list[dict]:
    """Convert a parking table."""
    headers = table_data["headers"]
    rows = table_data["rows"]
    results: list[dict] = []

    for row_idx, row in enumerate(rows):
        if not row or not row[0].strip():
            continue
        use_or_category = row[0]
        # Try to build "For X, parking requirement is Y."
        values = [c.strip() for c in row[1:] if c.strip()]
        if not values:
            continue
        val_str = ", ".join(values[:3])  # first few non-empty values
        sentence = (
            f"For {use_or_category}, the parking requirement is {val_str}. "
            f"(Source: {source_file}, page {page_number})"
        )
        results.append({
            "table_id": table_id,
            "source_file": source_file,
            "page_number": page_number,
            "table_index": table_index,
            "table_type": "parking_table",
            "row_id": f"{table_id}_r{row_idx + 1}",
            "text_description": sentence,
        })

    return results


def _convert_landscaping_table(table_data: dict, table_id: str, source_file: str,
                                page_number: int, table_index: int) -> list[dict]:
    """Convert a landscaping/screening table."""
    rows = table_data["rows"]
    results: list[dict] = []

    for row_idx, row in enumerate(rows):
        if not row or not row[0].strip():
            continue
        subject = row[0]
        rest = [c.strip() for c in row[1:] if c.strip()]
        detail = ", ".join(rest[:3]) if rest else "specific landscaping or screening measures"
        sentence = (
            f"{subject} requires {detail} according to this table. "
            f"(Source: {source_file}, page {page_number})"
        )
        results.append({
            "table_id": table_id,
            "source_file": source_file,
            "page_number": page_number,
            "table_index": table_index,
            "table_type": "landscaping_screening_table",
            "row_id": f"{table_id}_r{row_idx + 1}",
            "text_description": sentence,
        })

    return results


def _convert_conversion_table(table_data: dict, table_id: str, source_file: str,
                               page_number: int, table_index: int) -> list[dict]:
    """Convert a zoning conversion table (old → new)."""
    rows = table_data["rows"]
    results: list[dict] = []

    for row_idx, row in enumerate(rows):
        old = row[0].strip() if len(row) > 0 else ""
        new = row[1].strip() if len(row) > 1 else ""
        if not old and not new:
            continue
        if not old:
            old = "an unspecified district"
        if not new:
            new = "an unspecified district"
        sentence = (
            f"The previous zoning district {old} is converted to {new}. "
            f"(Source: {source_file}, page {page_number})"
        )
        results.append({
            "table_id": table_id,
            "source_file": source_file,
            "page_number": page_number,
            "table_index": table_index,
            "table_type": "zoning_conversion_table",
            "row_id": f"{table_id}_r{row_idx + 1}",
            "text_description": sentence,
        })

    return results


def _convert_unknown_table(table_data: dict, table_id: str, source_file: str,
                            page_number: int, table_index: int) -> list[dict]:
    """Generic key-value conversion for unknown table types."""
    headers = table_data["headers"]
    rows = table_data["rows"]
    results: list[dict] = []

    for row_idx, row in enumerate(rows):
        cells = [c.strip() for c in row if c.strip()]
        if not cells:
            continue

        # Use first cell as key, rest as value; or fall back to a flat join
        if len(cells) >= 2:
            key = cells[0]
            val = " / ".join(cells[1:])
            text = (
                f"In this table from {source_file} page {page_number}, "
                f"{key} is {val}."
            )
        else:
            text = (
                f"Table entry from {source_file} page {page_number}: "
                f"{' | '.join(cells)}"
            )

        results.append({
            "table_id": table_id,
            "source_file": source_file,
            "page_number": page_number,
            "table_index": table_index,
            "table_type": "unknown_table",
            "row_id": f"{table_id}_r{row_idx + 1}",
            "text_description": text,
        })

    return results


def human_join(items: list[str], conjunction: str = "and") -> str:
    """Join a list with commas and a final conjunction: 'A, B, and C'."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} {conjunction} {items[1]}"
    return f"{', '.join(items[:-1])}, {conjunction} {items[-1]}"


# ---------------------------------------------------------------------------
#  main pipeline
# ---------------------------------------------------------------------------

def pipeline(input_pdf: str, output_dir: str):
    """
    Run the full table-to-text pipeline on a single PDF.

    1. Extract tables.
    2. Save raw_tables.csv.
    3. Classify each table.
    4. Convert each row to text.
    5. Save table_text_chunks.csv.
    """
    os.makedirs(output_dir, exist_ok=True)

    # ---- 1. extract ----
    tables = extract_tables_from_pdf(input_pdf)

    if not tables:
        print("[DONE] No tables found.")
        return

    # ---- 2. save raw_tables.csv ----
    raw_path = os.path.join(output_dir, "raw_tables.csv")
    raw_rows = []
    for t in tables:
        raw_rows.append({
            "table_id": t["table_id"],
            "source_file": t["source_file"],
            "page_number": t["page_number"],
            "table_index": t["table_index"],
            "raw_table_json": json.dumps(t["table_data"], ensure_ascii=False),
        })
    with open(raw_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "table_id", "source_file", "page_number", "table_index", "raw_table_json",
        ])
        w.writeheader()
        w.writerows(raw_rows)
    print(f"[RAW]     Saved {len(raw_rows)} tables to {raw_path}")

    # ---- 3. classify & convert ----
    type_counts: dict[str, int] = {}
    all_text_rows: list[dict] = []

    for t in tables:
        td = t["table_data"]
        if not td or not td.get("rows"):
            continue

        table_type = classify_table(td)
        type_counts[table_type] = type_counts.get(table_type, 0) + 1

        # Dispatch to the correct converter
        converters = {
            "use_table": _convert_use_table,
            "bulk_density_table": _convert_bulk_density_table,
            "parking_table": _convert_parking_table,
            "landscaping_screening_table": _convert_landscaping_table,
            "zoning_conversion_table": _convert_conversion_table,
            "unknown_table": _convert_unknown_table,
        }

        converter = converters.get(table_type, _convert_unknown_table)
        try:
            rows = converter(
                td, t["table_id"], t["source_file"],
                t["page_number"], t["table_index"],
            )
            all_text_rows.extend(rows)
        except Exception as exc:
            print(f"  [WARN] Conversion failed for {t['table_id']}: {exc}")
            # Fallback: save as unknown
            fallback = _convert_unknown_table(
                td, t["table_id"], t["source_file"],
                t["page_number"], t["table_index"],
            )
            all_text_rows.extend(fallback)

    # ---- 4. save table_text_chunks.csv ----
    text_path = os.path.join(output_dir, "table_text_chunks.csv")
    fieldnames = [
        "table_id", "source_file", "page_number", "table_index",
        "table_type", "row_id", "text_description",
    ]
    with open(text_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(all_text_rows)
    print(f"[TEXT]    Saved {len(all_text_rows)} text chunks to {text_path}")

    # ---- summary ----
    print(f"\n{'='*55}")
    print("  Table Type Distribution")
    print(f"{'='*55}")
    for typ in sorted(type_counts.keys()):
        print(f"  {typ:35s} {type_counts[typ]:4d}")
    print(f"{'='*55}\n")


# ---------------------------------------------------------------------------
#  CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Extract tables from a PDF, classify them, and produce text descriptions."
    )
    parser.add_argument(
        "--input", type=str, required=True,
        help="Path to the input PDF file."
    )
    parser.add_argument(
        "--output-dir", type=str, default="outputs/tables",
        help="Directory to write raw_tables.csv and table_text_chunks.csv."
    )
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"[ERROR] Input file not found: {args.input}")
        return

    pipeline(args.input, args.output_dir)


if __name__ == "__main__":
    main()
