"""Prepare evidence-linked zoning parameters for GIS and the simulator."""

import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path


UNITS = {
    "max_far": ("ratio", {"", "ratio", "far", "dimensionless"}),
    "max_height": ("ft", {"ft", "ft.", "foot", "feet"}),
    "min_lot_area": ("sq ft", {"sq ft", "sq. ft.", "ft2", "ft²", "square feet", "sf"}),
    "front_setback": ("ft", {"ft", "ft.", "foot", "feet"}),
    "parking_requirement": (
        "spaces/unit",
        {"spaces/unit", "space/unit", "spaces per unit", "space per unit",
         "spaces per dwelling unit", "space per dwelling unit", "spaces/dwelling unit"},
    ),
}
JOIN_FIELDS = {
    "max_far": "FAR",
    "max_height": "max_height",
    "parking_requirement": "parking_requirement",
}
INPUT_COLUMNS = {
    "zone_class", "parameter", "value", "unit", "status", "evidence", "source_file", "page_number",
}
CSV_COLUMNS = (
    "zoning_district", "parameter_name", "parameter_value", "unit",
    "source_file", "page_number", "table_id", "original_text",
)


def normalize_district(text):
    text = re.sub(r"\s+", "", text.upper()).replace("–", "-").replace("—", "-")
    match = re.fullmatch(r"(RS|RT|RM|POS|PD)(\d+)", text)
    return f"{match[1]}-{match[2]}" if match else text


def candidates(source):
    grouped = {}
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = INPUT_COLUMNS.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"RAG CSV missing columns: {', '.join(sorted(missing))}")
        for line_number, row in enumerate(reader, start=2):
            fields = {key: (value or "").strip() for key, value in row.items() if key}
            name = fields["parameter"].lower()
            if name not in UNITS:
                continue
            unit, accepted_units = UNITS[name]
            district = normalize_district(fields["zone_class"])
            method = fields.get("extraction_method", "")
            if (fields["status"].lower() != "found" or method not in {"", "rag_found"}
                    or fields["unit"].lower() not in accepted_units):
                print(f"Skipped row {line_number}: unresolved evidence or unsupported unit", file=sys.stderr)
                continue
            value_text = fields["value"]
            if not re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", value_text):
                print(f"Skipped row {line_number}: expected a single nonnegative number", file=sys.stderr)
                continue
            value = float(value_text.replace(",", ""))
            page = fields["page_number"]
            if (not math.isfinite(value) or not district or not page.isascii() or not page.isdigit()
                    or len(page) > 7 or int(page) < 1 or not fields["source_file"] or not fields["evidence"]):
                print(f"Skipped row {line_number}: incomplete provenance or invalid value", file=sys.stderr)
                continue
            grouped.setdefault((district, name), []).append({
                "name": name, "value": value, "unit": unit, "sourceFile": fields["source_file"],
                "page": int(page), "evidence": fields["evidence"], "tableId": fields.get("table_id", ""),
            })

    for (district, name), rows in sorted(grouped.items()):
        if len({row["value"] for row in rows}) > 1:
            print(f"Skipped {district} / {name}: conflicting values require review", file=sys.stderr)
            continue
        yield district, rows[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="RAG extraction results CSV")
    parser.add_argument("--join-output", type=Path, help="CSV for zoningcrime spatial-join")
    parser.add_argument("--scenario-output", type=Path, help="JSON for the simulator's policy import")
    parser.add_argument("--scenario-zone", help="Single district to include in the simulator scenario")
    args = parser.parse_args()
    if not args.join_output and not args.scenario_output:
        parser.error("Choose --join-output, --scenario-output, or both.")
    if bool(args.scenario_output) != bool(args.scenario_zone):
        parser.error("--scenario-output and --scenario-zone must be used together.")
    paths = [path.resolve() for path in (args.input, args.join_output, args.scenario_output) if path]
    if len(set(paths)) != len(paths):
        parser.error("Use a different path for each input and output.")

    try:
        rows = list(candidates(args.input))
        join_rows = [
            (district, JOIN_FIELDS[row["name"]], row["value"], row["unit"],
             row["sourceFile"], row["page"], row["tableId"], row["evidence"])
            for district, row in rows if row["name"] in JOIN_FIELDS
        ]
        zone = normalize_district(args.scenario_zone or "")
        scenario_rows = [row for district, row in rows if district == zone]
        if args.join_output and not join_rows:
            raise ValueError("No usable FAR, height, or parking values for the spatial join.")
        if args.scenario_output and not scenario_rows:
            raise ValueError(f"No usable evidence-linked parameters for {zone}.")
        if args.join_output:
            args.join_output.parent.mkdir(parents=True, exist_ok=True)
            with args.join_output.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(CSV_COLUMNS)
                writer.writerows(join_rows)
            print(f"{len(join_rows)} spatial join rows written to {args.join_output}")
        if args.scenario_output:
            args.scenario_output.parent.mkdir(parents=True, exist_ok=True)
            scenario = {"schemaVersion": 1, "zoneClass": zone, "parameters": scenario_rows}
            args.scenario_output.write_text(json.dumps(scenario, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{len(scenario_rows)} scenario parameters written to {args.scenario_output}")
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
