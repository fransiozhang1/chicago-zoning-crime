"""Spatial overlay of zoning polygons on census tracts."""

from __future__ import annotations

import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.errors import GEOSException

PROJECTED_CRS = "EPSG:3435"

AREA_CATEGORIES = ["residential", "commercial", "industrial", "mixed_use", "unknown"]

PARAM_METRICS: dict[str, str] = {
    "avg_max_height": "max_height",
    "avg_far": "FAR",
    "avg_parking_requirement": "parking_requirement",
}

REQUIRED_PARAM_COLUMNS = ["zoning_district", "parameter_name", "parameter_value"]

TRACT_ID_CANDIDATES = [
    "census_tract", "GEOID10", "geoid10", "NAME10", "name10", "TRACTCE10", "tractce10", "GEOID", "geoid",
]

ZONING_FIELD_CANDIDATES = [
    "zoning_district", "ZONE_CLASS", "zone_class", "ZONING", "zoning",
    "ZONE", "zone", "district", "DISTRICT", "ZONE_DESC", "zone_desc",
]

# Zone classification rules (first match wins) → broad category for spatial join.
ZONE_TYPE_RULES: list[tuple[str, list[re.Pattern[str]]]] = [
    ("mixed_use", [
        re.compile(r"\bDX\b"), re.compile(r"\bDR\b"), re.compile(r"\bDC\b"), re.compile(r"\bPD\b"),
        re.compile(r"\bmixed[\s-]?use\b", re.I), re.compile(r"\bplanned\s+development\b", re.I),
    ]),
    ("industrial", [
        re.compile(r"\bM-?\d\b", re.I), re.compile(r"\bPMD\b"),
        re.compile(r"\bmanufacturing\b", re.I), re.compile(r"\bindustrial\b", re.I),
    ]),
    ("commercial", [
        re.compile(r"\bB-?\d", re.I), re.compile(r"\bC-?\d", re.I),
        re.compile(r"\bbusiness\b", re.I), re.compile(r"\bcommercial\b", re.I),
    ]),
    ("residential", [
        re.compile(r"\bRM-?\d", re.I), re.compile(r"\bRS-?\d", re.I), re.compile(r"\bRT-?\d", re.I),
        re.compile(r"\bR[1-8]\b"), re.compile(r"\bresidence\b", re.I), re.compile(r"\bresidential\b", re.I),
        re.compile(r"\bapartment\b", re.I), re.compile(r"\bdwelling\b", re.I),
    ]),
]

USE_PARAM_TO_ZONE: dict[str, str] = {
    "use_allowed_residential": "residential",
    "use_allowed_commercial": "commercial",
    "use_allowed_industrial": "industrial",
    "mixed_use_allowed": "mixed_use",
}

OUTPUT_COLUMNS = [
    "year", "census_tract", "tract_area",
    "residential_area", "commercial_area", "industrial_area", "mixed_use_area", "unknown_area",
    "residential_ratio", "commercial_ratio", "industrial_ratio", "mixed_use_ratio", "unknown_ratio",
    "dominant_zone_type",
    "avg_max_height", "avg_far", "avg_parking_requirement",
]


def _ensure_parent(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def classify_zone_from_text(text: str) -> str:
    """Classify a zoning district or sentence into a broad zone category."""
    if not str(text).strip():
        return "unknown"
    for zone_type, patterns in ZONE_TYPE_RULES:
        if any(p.search(text) for p in patterns):
            return zone_type
    return "unknown"


def classify_district_row(district: str, group: pd.DataFrame) -> str:
    """Infer broad zone type from district code and related parameter rows."""
    district = str(district).strip()
    context = district
    if "original_text" in group.columns:
        context = f"{district} " + " ".join(group["original_text"].astype(str).head(5))

    zone = classify_zone_from_text(context)

    if zone == "unknown" and "parameter_name" in group.columns:
        for param, cat in USE_PARAM_TO_ZONE.items():
            if (group["parameter_name"] == param).any():
                return cat

    return zone


def read_vector(path: Path) -> gpd.GeoDataFrame:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path, dtype=str, low_memory=False)
        geom_col = next(
            (c for c in ("the_geom", "geometry", "WKT", "wkt") if c in df.columns),
            None,
        )
        if geom_col:
            from shapely import wkt

            geometry = df[geom_col].apply(lambda s: wkt.loads(s) if pd.notna(s) and str(s).strip() else None)
            gdf = gpd.GeoDataFrame(df.drop(columns=[geom_col]), geometry=geometry, crs="EPSG:4326")
            gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
            if gdf.empty:
                raise ValueError(f"CSV has no valid WKT geometries: {path}")
            return gdf

    try:
        gdf = gpd.read_file(path)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Could not read vector file {path}: {exc}") from exc
    if gdf.empty:
        raise ValueError(f"Vector file contains no features: {path}")
    if gdf.geometry.isna().all():
        raise ValueError(f"Vector file has no valid geometries: {path}")
    return gdf


def detect_column(columns: list[str], candidates: list[str], label: str) -> str:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    lower_map = {col.lower(): col for col in columns}
    for candidate in candidates:
        if candidate.lower() in lower_map:
            return lower_map[candidate.lower()]
    raise ValueError(
        f"Could not detect {label} column. Tried: {', '.join(candidates)}. "
        f"Available: {', '.join(columns)}"
    )


def ensure_projected(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        raise ValueError(f"{label} has no CRS. Please define a CRS before running.")
    return gdf.to_crs(PROJECTED_CRS)


def parse_numeric(value: object) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_params(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")
    missing = [col for col in REQUIRED_PARAM_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(
            f"Parameters CSV missing columns: {', '.join(missing)}. Found: {list(df.columns)}"
        )
    return df


def build_district_lookups(params: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    districts = params.copy()
    districts["zoning_district"] = districts["zoning_district"].str.strip()
    districts = districts[
        (districts["zoning_district"] != "") & (districts["zoning_district"].str.lower() != "unknown")
    ]
    if districts.empty:
        raise ValueError("No usable zoning_district values in parameters CSV.")

    zone_rows: list[dict[str, str]] = []
    param_rows: list[dict[str, object]] = []

    for district, group in districts.groupby("zoning_district"):
        broad = classify_district_row(district, group)
        zone_rows.append({"zoning_district": district, "broad_zone_type": broad})

        record: dict[str, object] = {"zoning_district": district}
        for out_col, param_name in PARAM_METRICS.items():
            values = group.loc[group["parameter_name"] == param_name, "parameter_value"]
            nums = [v for v in (parse_numeric(x) for x in values) if v is not None]
            record[out_col.replace("avg_", "param_")] = float(pd.Series(nums).median()) if nums else None
        param_rows.append(record)

    return pd.DataFrame(zone_rows), pd.DataFrame(param_rows)


def dominant_category(area_by_cat: dict[str, float]) -> str:
    best_cat, best_area = "unknown", -1.0
    for category in AREA_CATEGORIES:
        if area_by_cat.get(category, 0.0) > best_area:
            best_area = area_by_cat[category]
            best_cat = category
    return best_cat


def weighted_average(values: pd.Series, weights: pd.Series) -> float | None:
    mask = values.notna() & weights.notna() & (weights > 0)
    if not mask.any():
        return None
    v, w = values[mask].astype(float), weights[mask].astype(float)
    return float((v * w).sum() / w.sum())


def run_spatial_join(
    zoning_file: str | Path,
    tract_file: str | Path,
    params_csv: str | Path,
    year: str | int,
    output_csv: str | Path,
    tract_field: str | None = None,
    zoning_field: str | None = None,
) -> Path:
    """Overlay zoning polygons on census tracts and write tract-level indicators."""
    zoning_path = Path(zoning_file).expanduser().resolve()
    tracts_path = Path(tract_file).expanduser().resolve()
    params_path = Path(params_csv).expanduser().resolve()
    output_path = _ensure_parent(Path(output_csv).expanduser().resolve())

    for path, label in ((zoning_path, "Zoning file"), (tracts_path, "Tract file"), (params_path, "Params CSV")):
        if not path.exists():
            raise FileNotFoundError(f"{label} not found: {path}")

    zoning = read_vector(zoning_path)
    tracts = read_vector(tracts_path)
    params = load_params(params_path)

    tract_col = tract_field or detect_column(list(tracts.columns), TRACT_ID_CANDIDATES, "census tract")
    zone_col = zoning_field or detect_column(list(zoning.columns), ZONING_FIELD_CANDIDATES, "zoning district")
    district_zone, district_params = build_district_lookups(params)

    zoning = zoning.copy()
    zoning["zoning_district"] = zoning[zone_col].astype(str).str.strip()
    zoning = zoning.merge(district_zone, on="zoning_district", how="left")
    zoning["broad_zone_type"] = zoning["broad_zone_type"].fillna(
        zoning["zoning_district"].map(classify_zone_from_text)
    ).fillna("unknown")
    zoning = zoning.merge(district_params, on="zoning_district", how="left")

    tracts = tracts.copy()
    tracts["census_tract"] = tracts[tract_col].astype(str).str.strip()

    zoning_proj = ensure_projected(zoning, "Zoning layer")
    tracts_proj = ensure_projected(tracts, "Census tract layer")

    tract_areas = tracts_proj[["census_tract", "geometry"]].copy()
    tract_areas["tract_area"] = tract_areas.geometry.area

    try:
        overlay = gpd.overlay(
            zoning_proj, tracts_proj[["census_tract", "geometry"]],
            how="intersection", keep_geom_type=False,
        )
    except GEOSException as exc:
        raise ValueError(f"Spatial overlay failed: {exc}") from exc
    if overlay.empty:
        raise ValueError("Overlay produced no intersections. Check CRS and layer extents.")

    overlay["piece_area"] = overlay.geometry.area
    area_pivot = (
        overlay.groupby(["census_tract", "broad_zone_type"], as_index=False)["piece_area"].sum()
        .pivot(index="census_tract", columns="broad_zone_type", values="piece_area").fillna(0.0)
    )
    for category in AREA_CATEGORIES:
        if category not in area_pivot.columns:
            area_pivot[category] = 0.0
    area_pivot = area_pivot[AREA_CATEGORIES]

    metric_cols = [c.replace("avg_", "param_") for c in PARAM_METRICS]
    for col in metric_cols:
        if col not in overlay.columns:
            overlay[col] = None

    avg_metrics: dict[str, dict[str, float | None]] = {m: {} for m in PARAM_METRICS}
    for tract_id, group in overlay.groupby("census_tract"):
        for out_name, param_col in zip(PARAM_METRICS, metric_cols):
            avg_metrics[out_name][tract_id] = weighted_average(group[param_col], group["piece_area"])

    rows: list[dict[str, object]] = []
    for _, tract_row in tract_areas.iterrows():
        tract_id = tract_row["census_tract"]
        tract_area = float(tract_row["tract_area"])
        area_by_cat = (
            {cat: float(area_pivot.loc[tract_id, cat]) for cat in AREA_CATEGORIES}
            if tract_id in area_pivot.index
            else {cat: 0.0 for cat in AREA_CATEGORIES}
        )
        zoned_area = sum(area_by_cat.values())
        if zoned_area < tract_area:
            area_by_cat["unknown"] += tract_area - zoned_area
        ratios = {cat: (area_by_cat[cat] / tract_area if tract_area > 0 else 0.0) for cat in AREA_CATEGORIES}
        rows.append({
            "year": str(year),
            "census_tract": tract_id,
            "tract_area": tract_area,
            **{f"{cat}_area": area_by_cat[cat] for cat in AREA_CATEGORIES},
            **{f"{cat}_ratio": ratios[cat] for cat in AREA_CATEGORIES},
            "dominant_zone_type": dominant_category(area_by_cat),
            "avg_max_height": avg_metrics["avg_max_height"].get(tract_id),
            "avg_far": avg_metrics["avg_far"].get(tract_id),
            "avg_parking_requirement": avg_metrics["avg_parking_requirement"].get(tract_id),
        })

    result = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)
    result.to_csv(output_path, index=False, encoding="utf-8-sig")

    print(f"Census tracts:   {len(tracts_proj)}")
    print(f"Zoning polygons: {len(zoning_proj)}")
    print(f"Overlay pieces:  {len(overlay)}")
    print(f"Output rows:     {len(result)}")
    print(f"Output: {output_path}")
    return output_path
