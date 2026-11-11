---
name: zoning-crime-spatial-join
description: >-
  Overlay zoning polygons on census tracts with geopandas; compute area ratios
  and weighted zoning parameters per tract. Zone classification (residential,
  commercial, industrial, mixed_use, unknown) is built in — no separate
  normalizer step needed.
---

# Zoning Spatial Join

Overlay zoning district polygons onto census tract boundaries and compute
tract-level zoning indicators with area ratios and weighted parameter averages.

## When to use

- Joining zoning maps to census tract boundaries
- Computing per-tract zoning compositions (area ratios by zone type)
- Calculating weighted averages of zoning parameters (height, FAR, parking)
- Preparing tract-level zoning indicators for downstream analysis

## How to run

```bash
python -m zoningcrime spatial-join \
  --zoning ./data/zoning_maps/zoning_2026.geojson \
  --tracts ./data/census_tracts/tracts.geojson \
  --params ./outputs/parameters/zoning_parameters_extracted.csv \
  --year 2026 \
  --output ./outputs/spatial/zoning_indicators_by_tract_2026.csv
```

## API

```python
from zoningcrime.spatial_join import run_spatial_join
run_spatial_join(zoning_file, tract_file, params_csv, year, output_csv)
```

## Inputs

- **Zoning layer:** geojson, shapefile, gpkg, or CSV with WKT column (`the_geom`). Auto-detects district code column from `ZONE_CLASS`, `zoning_district`, `ZONING`, `zone`, `district`, etc.
- **Tracts:** auto-detects tract ID from `GEOID10`, `NAME10`, `census_tract`, `TRACTCE10`, etc.
- **Params:** extractor output CSV (`zoning_parameters_extracted.csv`)

## Output schema

| Column | Description |
|--------|-------------|
| year | Analysis year |
| census_tract | Tract identifier |
| tract_area | Total tract area (sq meters, EPSG:3435) |
| residential_area | Zoned residential area |
| commercial_area | Zoned commercial area |
| industrial_area | Zoned industrial area |
| mixed_use_area | Zoned mixed-use area |
| unknown_area | Unmatched/unknown area |
| residential_ratio | residential_area / tract_area |
| commercial_ratio | commercial_area / tract_area |
| industrial_ratio | industrial_area / tract_area |
| mixed_use_ratio | mixed_use_area / tract_area |
| unknown_ratio | unknown_area / tract_area |
| dominant_zone_type | Zone type with largest area |
| avg_max_height | Area-weighted average max height |
| avg_far | Area-weighted average FAR |
| avg_parking_requirement | Area-weighted average parking |

## Zone classification rules (built-in)

District codes are classified as:
- **residential:** R, RS, RM, RT, plus keyword matches
- **commercial:** B, C, business, commercial
- **industrial:** M, PMD, manufacturing, industrial
- **mixed_use:** DX, DR, DC, PD, planned development
- **unknown:** everything else

## Notes

- Reprojects to EPSG:3435 for area calculations
- Both layers must have valid CRS and geographic overlap
- No separate normalizer step — classification is internal
- Uses geopandas `overlay(intersection)` for spatial join
- Output: UTF-8-sig CSV
