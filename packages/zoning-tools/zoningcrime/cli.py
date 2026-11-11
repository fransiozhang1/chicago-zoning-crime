"""CLI for zoning parameter extraction and spatial join."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from zoningcrime.extractor import run_extractor
from zoningcrime.spatial_join import run_spatial_join


def cmd_extract(args: argparse.Namespace) -> None:
    path = Path(args.input).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Input not found: {path}")
    run_extractor(
        args.input, args.output,
        file_type=args.type,
        zone_classes_path=args.zone_classes,
    )


def cmd_spatial_join(args: argparse.Namespace) -> None:
    for label, p in (
        ("Zoning file", args.zoning),
        ("Tract file", args.tracts),
        ("Parameters CSV", args.params),
    ):
        if not Path(p).expanduser().resolve().exists():
            raise FileNotFoundError(f"{label} not found: {p}")
    run_spatial_join(args.zoning, args.tracts, args.params, args.year, args.output)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="zoningcrime",
        description="Zoning parameter extraction and spatial join.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_extract = sub.add_parser("extract", help="Extract zoning parameters from documents")
    p_extract.add_argument("--input", required=True, help="File or folder path")
    p_extract.add_argument("--output", required=True, help="Output CSV path")
    p_extract.add_argument("--type", default=None, help="Optional: pdf, docx, txt, csv")
    p_extract.add_argument(
        "--zone-classes", default=None,
        help="Optional: path to ZONE_CLASS_stats.txt for targeted extraction",
    )
    p_extract.set_defaults(func=cmd_extract)

    p_spatial = sub.add_parser("spatial-join", help="Overlay zoning on census tracts")
    p_spatial.add_argument("--zoning", required=True)
    p_spatial.add_argument("--tracts", required=True)
    p_spatial.add_argument("--params", required=True)
    p_spatial.add_argument("--year", required=True)
    p_spatial.add_argument("--output", required=True)
    p_spatial.set_defaults(func=cmd_spatial_join)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
        return 0
    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
