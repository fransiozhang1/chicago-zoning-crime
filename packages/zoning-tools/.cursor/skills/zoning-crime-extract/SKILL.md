---
name: zoning-crime-extract
description: >-
  Rule-based extraction of zoning parameters (nightlife, lighting, setbacks,
  parking, buffers, and more) from PDF/DOCX/TXT/CSV using regex and keyword
  rules. Supports two modes: full-text legacy extraction and targeted
  zone-class-aware extraction from a ZONE_CLASS_stats.txt file. Use when
  parsing zoning ordinances or planning documents to extract structured,
  computable parameters for specific zone classes.
---

# Zoning Parameter Extractor

Extract numeric zoning parameters from raw documents (PDF, DOCX, TXT, CSV).

Two modes:
- **Legacy (no --zone-classes):** full-text parameter mining from the entire document
- **Targeted (with --zone-classes):** only query parameters for zone classes listed in a ZONE_CLASS stats file

## When to use

- Parsing zoning ordinances or planning documents
- Extracting nightlife, lighting, setback, parking, and buffer parameters for specific zone classes
- Batch processing a folder of documents into a single CSV
- GIS-driven workflow: first identify which ZONE_CLASS values appear in your study area, then extract only their parameters

## How to run

### Full-text extraction (legacy)

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents/zoning_1927.pdf \
  --output ./outputs/parameters/zoning_parameters_extracted.csv
```

### Targeted extraction (recommended for GIS workflows)

```bash
python -m zoningcrime extract \
  --input ./data/raw_documents/chicago-il-1.pdf \
  --zone-classes ./data/ZONE_CLASS_stats.txt \
  --output ./outputs/parameters/zone_class_parameters.csv
```

The `ZONE_CLASS_stats.txt` file contains one zone class per line, for example:

```
RT-4
B3-1
RS-3
C1-2
M1-2
PD 323
T
```

## API

```python
from zoningcrime.extractor import run_extractor

# Legacy mode
run_extractor(input_path, output_csv, file_type=None)

# Targeted mode
run_extractor(input_path, output_csv, file_type=None, zone_classes_path="./data/ZONE_CLASS_stats.txt")
```

## Parameters extracted in targeted mode

1. **Nightlife / alcohol / entertainment:** tavern_allowed, bar_allowed, liquor_sales_allowed, nightclub_allowed, entertainment_venue_allowed, adult_use_allowed, special_use_required_for_nightlife
2. **Lighting & visibility:** lighting_required, parking_lot_lighting_required, pedestrian_lighting_required, security_lighting_required, minimum_lighting_level
3. **Street interface / natural surveillance:** active_frontage_required, ground_floor_commercial_allowed, transparent_frontage_required, blank_wall_limit, window_requirement, entrance_spacing, front_setback, build_to_line
4. **Parking & open space management:** surface_parking_allowed, parking_lot_screening_required, parking_lot_lighting_required, parking_requirement, vacant_lot_maintenance_required, fence_required, landscaping_required, screening_required
5. **Distance / buffer restrictions:** distance_from_residential, distance_from_school, distance_from_church, distance_from_park, distance_between_liquor_uses, buffer_required, industrial_buffer_required, buffer_width

## Output schema (targeted mode)

| Column | Description |
|--------|-------------|
| source_file | Source document filename |
| source_page | Page number |
| zone_class | Zone class code (e.g. RT-4, B3-1, PD 323) |
| zone_family | Broad category (residential, business_commercial, manufacturing, downtown, open_space, transportation, planned_development) |
| parameter_name | Parameter name |
| parameter_value | Numeric value, range, or yes/no/conditional |
| unit | Standardised unit or boolean |
| value_type | numeric, boolean, special_use, planned_development, text, or missing |
| original_text | Source sentence for verification |
| confidence | high / medium / low |
| matched_section | Ordinance chapter (e.g. 17-2 Residential Districts) |

## PD (Planned Development) handling

PD zone classes (e.g. PD 323, PD 74) receive automatic rows:

- parameter_name = `requires_pd_ordinance_lookup`
- parameter_value = `yes`
- confidence = `high`

Because PD parameters are typically in separate PD ordinance documents rather than the main zoning code.

## Zone family mapping

| Zone prefix | zone_family |
|-------------|-------------|
| RS, RT, RM | residential |
| B, C | business_commercial |
| M, PMD | manufacturing |
| DX, DC, DR, DS | downtown |
| POS | open_space |
| T | transportation |
| PD | planned_development |

## Notes

- All regex/keyword based, no LLM
- Output: UTF-8-sig CSV
- PD zones trigger a synthetic row rather than keyword extraction
- ZONE_CLASS_stats.txt supports standard zone codes (RT-4, B3-1, C1-2, RM-4.5) and PD codes (PD 323)
