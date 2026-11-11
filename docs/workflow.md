# Reproduce the zoning workflow

## 1. Choose an extraction path

Set up the two Python components separately to keep geospatial and embedding dependencies independent.

### Rule-based baseline

From `packages/zoning-tools`:

```sh
python -m pip install -r requirements.txt
python -m zoningcrime extract --input data/raw_documents/Chicago_Zoning_RS-3_sample.txt --output ../../.work/rule-parameters.csv
```

For a different ordinance snapshot, replace the sample with the relevant source file or directory. The baseline output already uses the spatial join schema.

### Table-aware RAG

From `packages/zoning-rag`:

```sh
python -m pip install -r requirements.txt
python -X utf8 src/table_to_text.py --input ../../data/ordinance.pdf --output-dir outputs/tables
python -X utf8 src/build_clean_policy_text.py --pdf ../../data/ordinance.pdf --tables outputs/tables/table_text_chunks.csv --output-md outputs/clean_text/chicago_zoning_cleaned.md --output-csv outputs/clean_text/clean_text_index.csv
python -X utf8 src/build_index.py --config config.yaml
python -X utf8 src/query_index.py --config config.yaml --query "RT-4 maximum floor area ratio"
```

To extract structured values, supply the configured model credential in the environment and run:

```sh
python -X utf8 src/extract_parameters.py --config config.yaml --zone-classes RT-4 --parameters max_far max_height min_lot_area front_setback parking_requirement --output ../../.work/rag-parameters.csv --evidence-output ../../.work/rag-retrieval-evidence.csv
```

Table reconstruction and index building need a local copy of the ordinance. The first index build may download the embedding model. Retrieval is local after installation and indexing. LLM extraction sends retrieved excerpts to the configured provider and may incur fees. For larger batch runs, the upstream `extract_all_parameters.py` additionally expects a district list and parameter definition CSV. See the [RAG component's README](../packages/zoning-rag/README.md) for those schemas and provider configuration.

## 2. Transfer and inspect

From the root:

```sh
python scripts/prepare_zoning_parameters.py .work/rag-parameters.csv --join-output .work/gis-parameters.csv --scenario-zone RT-4 --scenario-output .work/rt4-scenario.json
```

The converter accepts directly retrieved `found` results with a single numeric value, a recognized unit, a source file, a page, and quoted evidence. It skips inferred, unresolved and conflicting results. The GIS export covers FAR, height and parking per dwelling. The simulator also accepts minimum lot area and front setback. Inspect the retained evidence against the source edition and district rules before using the outputs. A source citation still requires checking the applicable conditions and year.

## 3. Overlay with census tracts

From `packages/zoning-tools`:

```sh
python -m zoningcrime spatial-join --zoning ../../data/zoning.geojson --tracts ../../data/tracts.geojson --params ../../.work/gis-parameters.csv --year 2026 --output ../../.work/tracts-2026.csv
```

Replace the example year with the year of the input zoning layer. Supply vector layers with a valid CRS, official district identifiers such as RT-4, and a stable tract identifier. The output includes land-use shares and area-weighted metrics, where available. See the [GIS component README](../packages/zoning-tools/README.md) for supported input columns.

## 4. Compare simulation scenarios

Open the platform, choose the tract and record the baseline. Upload the JSON scenario in **Policy Import** on desktop or mobile. The dialog displays existing and proposed values plus the source page. Apply the scenario and compare the output using the same simulation settings. Revert the current import before loading a different scenario. The simulator accepts districts in its bundled parameter catalog and values within its available control ranges. Conditional clauses and values outside the controls require a separate scenario definition.
