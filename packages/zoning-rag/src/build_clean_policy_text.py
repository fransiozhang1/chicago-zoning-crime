"""
build_clean_policy_text.py — Generate clean policy text by merging cleaned PDF
body text with natural-language table descriptions.

Usage:
    python src/build_clean_policy_text.py \
      --pdf data/raw_documents/chicago-il-1.pdf \
      --tables outputs/tables/table_text_chunks.csv \
      --output-md outputs/clean_text/chicago_zoning_cleaned.md \
      --output-csv outputs/clean_text/clean_text_index.csv

Outputs:
    outputs/clean_text/chicago_zoning_cleaned.md   — page-by-page markdown
    outputs/clean_text/clean_text_index.csv        — structured index for LlamaIndex
"""

import argparse
import csv
import os
import re
import sys
from collections import defaultdict
from typing import Any


# ---------------------------------------------------------------------------
#  text cleaning
# ---------------------------------------------------------------------------

# Lines that are pure PDF-internal noise
PDF_GARBAGE_PATTERNS = re.compile(
    r"^\s*(endstream|endobj|stream|obj|xref|trailer|startxref)/?\d*\s*$",
    re.IGNORECASE,
)

# Lines consisting only of binary / substream markers
BINARY_MARKER = re.compile(
    r"^\s*(/Subtype\s+/Image|/FlateDecode|/XObject|/Type\s+/XObject"
    r"|/Filter|/Length|/Width|/Height|/BitsPerComponent"
    r"|/ColorSpace|/SMask|/DecodeParms|/Intent"
    r"|/Interpolate|/ImageMask|/ID\s*\[)"
    r".*",
    re.IGNORECASE,
)

# A line that is nothing but a few bytes of non-printable noise
PURE_NOISE = re.compile(r"^[\x00-\x08\x0b\x0c\x0e-\x1f%s]{5,}$")

# Lines that are just a single number (often page artifacts)
STANDALONE_NUMBER = re.compile(r"^\s*\d{1,4}\s*$")


def clean_pdf_text(raw_text: str) -> str:
    r"""
    Clean raw PDF-extracted text by removing binary garbage, repeated blank
    lines, and residue from table parsing.

    Does NOT delete real zoning ordinance content.
    """
    if not raw_text:
        return ""

    lines = raw_text.split("\n")
    cleaned: list[str] = []

    for line in lines:
        stripped = line.strip()

        # Skip empty lines (we'll re-add a controlled blank later)
        if not stripped:
            cleaned.append("")
            continue

        # Skip pure PDF binary garbage
        if PDF_GARBAGE_PATTERNS.match(stripped):
            continue

        # Skip substream markers
        if BINARY_MARKER.match(stripped):
            continue

        # Skip lines that are pure non-printable noise
        if PURE_NOISE.match(stripped):
            continue

        # Skip standalone page numbers (but keep them if they have context)
        if STANDALONE_NUMBER.match(stripped) and len(stripped) <= 4:
            continue

        cleaned.append(stripped)

    # Collapse runs of blank lines to at most 1
    out: list[str] = []
    prev_blank = False
    for line in cleaned:
        if line == "":
            if not prev_blank:
                out.append("")
                prev_blank = True
        else:
            out.append(line)
            prev_blank = False

    # Join, strip leading/trailing whitespace
    text = "\n".join(out).strip()

    # ---- fix common PDF extraction artifacts ----
    # Join hyphenated words broken across lines (word-\nword → wordword)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

    # Join sentences where PDF forced a line-break mid-sentence
    # (lowercase letter or digit at end of line, followed by lowercase at start of next)
    text = re.sub(r"([a-z0-9),;:])\n([a-z(])", r"\1 \2", text)

    return text


# ---------------------------------------------------------------------------
#  load tables CSV
# ---------------------------------------------------------------------------

def load_table_chunks(csv_path: str) -> dict[int, dict[str, list[dict]]]:
    """
    Load table_text_chunks.csv and group by (page_number, table_id).

    Returns: {page_number: {table_id: [row_dict, ...], ...}, ...}
    Each row_dict has keys: table_id, source_file, page_number, table_index,
                             table_type, row_id, text_description
    """
    grouped: dict[int, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                pn = int(row["page_number"])
            except (ValueError, KeyError):
                continue
            tid = row.get("table_id", "")
            if not tid:
                continue
            grouped[pn][tid].append(row)

    return grouped


# ---------------------------------------------------------------------------
#  build markdown
# ---------------------------------------------------------------------------

def build_page_boundary_section(source_file: str, page_number: int) -> dict:
    """Create a page-boundary entry for the CSV index."""
    return {
        "section_id": f"page_boundary_{page_number}",
        "source_file": source_file,
        "page_number": page_number,
        "content_type": "page_boundary",
        "table_id": "",
        "table_type": "",
        "text": f"--- PAGE {page_number} ---",
    }


def build_clean_document(
    pdf_path: str,
    table_csv_path: str,
    output_md: str,
    output_csv: str,
):
    """Main pipeline: produce markdown + CSV index."""
    from pypdf import PdfReader

    fname = os.path.basename(pdf_path)
    tables_by_page = load_table_chunks(table_csv_path)

    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)

    os.makedirs(os.path.dirname(output_md), exist_ok=True)
    os.makedirs(os.path.dirname(output_csv), exist_ok=True)

    csv_rows: list[dict] = []
    md_lines: list[str] = [
        f"# Chicago Zoning Ordinance — Clean Policy Text",
        f"",
        f"**Source:** `{fname}`",
        f"**Generated by:** `src/build_clean_policy_text.py`",
        f"**Total pages:** {total_pages}",
        f"",
        f"---",
        f"",
    ]

    n_text_pages = 0
    n_pages_with_tables = 0
    n_table_blocks = 0

    for page_num in range(1, total_pages + 1):
        page = reader.pages[page_num - 1]

        # ---- extract & clean page text ----
        raw_text = page.extract_text() or ""
        cleaned = clean_pdf_text(raw_text)

        # ---- fetch tables for this page ----
        page_tables = tables_by_page.get(page_num, {})

        # ---- build markdown ----
        md_lines.append(f"# Page {page_num}")
        md_lines.append("")

        has_text = bool(cleaned)
        has_tables = bool(page_tables)

        if has_text:
            md_lines.append("## Extracted Text")
            md_lines.append("")
            md_lines.append(cleaned)
            md_lines.append("")
            n_text_pages += 1

            # Add page_text to CSV index
            csv_rows.append({
                "section_id": f"page_text_{page_num}",
                "source_file": fname,
                "page_number": page_num,
                "content_type": "page_text",
                "table_id": "",
                "table_type": "",
                "text": cleaned,
            })

        # Page boundary entry (always)
        csv_rows.append(build_page_boundary_section(fname, page_num))

        if has_tables:
            if has_text:
                md_lines.append("")
            md_lines.append("## Reconstructed Tables")
            md_lines.append("")
            n_pages_with_tables += 1

            for table_id in sorted(page_tables.keys()):
                rows = page_tables[table_id]
                if not rows:
                    continue
                table_type = rows[0].get("table_type", "unknown_table")

                md_lines.append(f"### Table {table_id}: {table_type}")
                md_lines.append("")

                # Merge all text_descriptions into bullet points
                bullet_lines: list[str] = []
                for row in rows:
                    desc = row.get("text_description", "").strip()
                    if desc:
                        bullet_lines.append(f"- {desc}")

                block_text = "\n".join(bullet_lines)
                md_lines.append(block_text)
                md_lines.append("")

                # CSV row for this table block
                csv_rows.append({
                    "section_id": table_id,
                    "source_file": fname,
                    "page_number": page_num,
                    "content_type": "table_text",
                    "table_id": table_id,
                    "table_type": table_type,
                    "text": block_text,
                })
                n_table_blocks += 1

        md_lines.append("---")
        md_lines.append("")

    # ---- write markdown ----
    with open(output_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))
    print(f"[MD]  Wrote markdown to: {output_md}")
    print(f"      Pages with text:   {n_text_pages}")
    print(f"      Pages with tables: {n_pages_with_tables}")
    print(f"      Table blocks:      {n_table_blocks}")

    # ---- write CSV index ----
    with open(output_csv, "w", newline="", encoding="utf-8-sig") as f:
        fieldnames = [
            "section_id", "source_file", "page_number",
            "content_type", "table_id", "table_type", "text",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f"[CSV] Wrote CSV index to: {output_csv}")
    print(f"      Total rows: {len(csv_rows)}  "
          f"(page_text + page_boundary + table_text)")


# ---------------------------------------------------------------------------
#  CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate clean policy text from PDF + table descriptions."
    )
    parser.add_argument(
        "--pdf", type=str, required=True,
        help="Path to the source PDF file."
    )
    parser.add_argument(
        "--tables", type=str, required=True,
        help="Path to table_text_chunks.csv."
    )
    parser.add_argument(
        "--output-md", type=str, default="outputs/clean_text/chicago_zoning_cleaned.md",
        help="Path for the output Markdown file."
    )
    parser.add_argument(
        "--output-csv", type=str, default="outputs/clean_text/clean_text_index.csv",
        help="Path for the output CSV index."
    )
    args = parser.parse_args()

    if not os.path.isfile(args.pdf):
        print(f"[ERROR] PDF not found: {args.pdf}")
        sys.exit(1)
    if not os.path.isfile(args.tables):
        print(f"[ERROR] Table CSV not found: {args.tables}")
        sys.exit(1)

    build_clean_document(args.pdf, args.tables, args.output_md, args.output_csv)


if __name__ == "__main__":
    main()
