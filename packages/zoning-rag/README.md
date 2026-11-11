# llamaindex-zoning-rag

A LlamaIndex-based zoning policy retrieval project for the Chicago Zoning Ordinance
and related policy documents. Uses semantic search to return relevant original text,
page numbers, and source filenames. **Now with table-aware retrieval** — PDF tables
are extracted separately and indexed as structured chunks.

---

## 1. Project Purpose

This project builds a **retrieval index** over zoning and policy PDFs (e.g., the
Chicago Zoning Ordinance). Given a natural-language query, it returns the top-k most
relevant text passages — *without* using an LLM to judge or extract parameters.

**Use case:** given a zoning parameter name (e.g. "RT-4 front setback"), find every
section in the ordinance that defines or constrains that parameter.

---

## 2. Current Phase

- **Phase 1 (current):** retrieval only.
  - No LLM calls.
  - No parameter-value extraction.
  - No batch queries.
  - No rules extraction.
  - No streetscape-variable queries.

The goal is to verify that LlamaIndex can surface relevant zoning / policy text.

---

## 3. Recommended End-to-End Pipeline

For the best retrieval results, run these steps in order:

```bash
# Step 1: Extract tables and convert to text
python src/table_to_text.py \
  --input data/raw_documents/chicago-il-1.pdf \
  --output-dir outputs/tables

# Step 2: Generate clean policy text (body text + table descriptions)
python src/build_clean_policy_text.py \
  --pdf data/raw_documents/chicago-il-1.pdf \
  --tables outputs/tables/table_text_chunks.csv \
  --output-md outputs/clean_text/chicago_zoning_cleaned.md \
  --output-csv outputs/clean_text/clean_text_index.csv

# Step 3: Rebuild the LlamaIndex index (auto-uses clean_text_index.csv)
Remove-Item -Recurse -Force .\storage\
python src/build_index.py --config config.yaml

# Step 4: Query
python src/query_index.py --query "RT4 floor area ratio" --config config.yaml

# Step 5: Batch parameter extraction (requires LLM API key)
python src/extract_parameters.py \
  --config config.yaml \
  --output outputs/results/zoning_parameter_results.csv \
  --evidence-output outputs/results/zoning_parameter_retrieval_evidence.csv

# Optional: Start web search interface
python src/server.py --config config.yaml --port 5050
```

---

## 4. Installation

```bash
cd llamaindex-zoning-rag
pip install -r requirements.txt
```

If you use a virtual environment:

```bash
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

---

## 5. Add Policy Documents

Place your **PDF**, **DOCX**, or **TXT** files into:

```
data/raw_documents/
```

Example:

```
data/raw_documents/chicago-il-1.pdf
```

The Chicago Zoning Ordinance covers:

- Residential Districts
- Business and Commercial Districts
- Downtown Districts
- Manufacturing Districts
- Special Purpose Districts
- Overlay Districts
- Planned Developments
- Use Regulations
- Parking and Loading
- Landscaping and Screening
- Signs
- Administration
- Terminology and Measurements

You can put multiple files here; all will be indexed together.

---

## 6. Build the Index

```bash
python src/build_index.py --config config.yaml
```

This will:

1. **Check for clean text first.** If `outputs/clean_text/clean_text_index.csv`
   exists, load documents from it (each row = one LlamaIndex Document with
   all source metadata).
2. If no clean text index is found, fall back to reading raw documents from
   `data/raw_documents/`, extracting both text pages and table chunks.
3. Embed all documents with `BAAI/bge-small-en-v1.5` (HuggingFace).
4. Build a `VectorStoreIndex`.
5. Persist the index to `storage/`.

**Force raw-document path:**

```bash
python src/build_index.py --config config.yaml --raw
```

**Output example (using clean_text_index.csv):**

```
  Using clean text index: outputs/clean_text/clean_text_index.csv
  Loaded rows:               677
  Skipped page_boundary rows: 275
  Skipped empty rows:         0
  Page text documents:        275
  Table text documents:       127
  Total documents indexed:    402

  Total documents indexed: 402  (page_text=275, table_text=127)
[INFO] Using embedding model: BAAI/bge-small-en-v1.5
[INFO] Building VectorStoreIndex ...
[DONE] Index saved to: ./storage
```

**Indexing strategy:**

Each Document is prefixed with a metadata header to help the embedding model
distinguish content types:

- **page_text** → `[PAGE_TEXT]\nSource file: ...\nPage: N\n\n{text}`
- **table_text** → `[TABLE_TEXT]\nSource file: ...\nPage: N\nTable ID: ...\nTable Type: ...\n\n{text}`

To force a rebuild if documents change, use:

```bash
python src/build_index.py --config config.yaml --reload
```

---

## 7. Table-to-Text Preprocessing

Extract all tables from a PDF, classify them by type, and convert each row
into natural-language text descriptions for downstream RAG retrieval.

```bash
python src/table_to_text.py \
  --input data/raw_documents/chicago-il-1.pdf \
  --output-dir outputs/tables
```

**What it does:**

| Step | Description |
|---|---|
| 1. Extract | Uses `pdfplumber` to pull every table from every page of the PDF. |
| 2. Save raw | Writes `raw_tables.csv` with `table_id`, `source_file`, `page_number`, `table_index`, `raw_table_json`. |
| 3. Classify | Auto-detects `table_type` from content keywords: `use_table`, `bulk_density_table`, `parking_table`, `landscaping_screening_table`, `zoning_conversion_table`, or `unknown_table`. |
| 4. Convert to text | Each row becomes a sentence like *"In RS1, the minimum lot area is 6,250 square feet."* or *"Multi-Unit Residential is permitted by-right in RT4, RM5, and RM6."* |
| 5. Save text | Writes `table_text_chunks.csv` with `table_id`, `source_file`, `page_number`, `table_index`, `table_type`, `row_id`, `text_description`. |

**Outputs:**

```
outputs/tables/raw_tables.csv          — 130 raw tables
outputs/tables/table_text_chunks.csv   — 1753 text chunks
```

**Typical distribution (Chicago Zoning Ordinance):**

| Table Type | Count |
|---|---|
| `bulk_density_table` | 30 |
| `use_table` | 20 |
| `parking_table` | 13 |
| `landscaping_screening_table` | 3 |
| `zoning_conversion_table` | 3 |
| `unknown_table` | 61 |

> **Note:** This is a first-pass extraction. Some tables are classified as `unknown_table`
> because their structure deviates from the expected patterns. Manual review and
> classification tuning is planned as a follow-up step.

### Table type conversion rules

**use_table** — One sentence per row, grouping districts by permit status:
```
"In [district group], [use type] is [status]."
Status: P→permitted by-right, S→special use, PD→planned development,
        -→not allowed, P/S→either permitted or special use.
```

**bulk_density_table** — One sentence per cell:
```
"In [district], the [parameter] is [value] [unit]."
```

**parking_table** — One sentence per row:
```
"For [use type], the parking requirement is [value]."
```

**landscaping_screening_table** — One sentence per row:
```
"[Subject] requires [requirement] according to this table."
```

**zoning_conversion_table** — One sentence per row:
```
"The previous zoning district [old] is converted to [new]."
```

---

## 8. Generate Clean Policy Text

Merge cleaned PDF body text with natural-language table descriptions into
a single, clean document optimized for RAG indexing.

```bash
python src/build_clean_policy_text.py \
  --pdf data/raw_documents/chicago-il-1.pdf \
  --tables outputs/tables/table_text_chunks.csv \
  --output-md outputs/clean_text/chicago_zoning_cleaned.md \
  --output-csv outputs/clean_text/clean_text_index.csv
```

**What it does:**

| Step | Description |
|---|---|
| 1. Extract body text | Reads every page via `pypdf`, cleans binary garbage, fixes line breaks. |
| 2. Load table descriptions | Groups `table_text_chunks.csv` by `(page_number, table_id)`. |
| 3. Merge per page | For each page: outputs cleaned body text, then reconstructed table text (bullet list). |
| 4. Write markdown | `chicago_zoning_cleaned.md` with `# Page N` headers. |
| 5. Write CSV index | `clean_text_index.csv` — one row per page text block and per table block. |

**Outputs:**

```
outputs/clean_text/chicago_zoning_cleaned.md    — 275 pages, ~30K lines
outputs/clean_text/clean_text_index.csv          — 677 rows
```

**CSV columns:**

| Column | Description |
|---|---|
| `section_id` | Page or table identifier |
| `source_file` | Source PDF filename |
| `page_number` | Page number |
| `content_type` | `page_text`, `table_text`, or `page_boundary` |
| `table_id` | Table identifier (empty for page_text) |
| `table_type` | Table classification (empty for page_text) |
| `text` | Full text content |

**`build_index.py` loading priority:**

If `outputs/clean_text/clean_text_index.csv` exists, `build_index.py`
will automatically use it instead of raw PDF/DOCX/TXT. To force the
raw-document path, use:

```bash
python src/build_index.py --config config.yaml --raw
```

---

## 9. Run a Single Query

```bash
python src/query_index.py --query "RT-4 front setback" --config config.yaml
```

**Output example:**

```
[INFO] Query: RT4 floor area ratio
[INFO] Retrieved 8 result(s).
  [1] [PAGE_TEXT RESULT] score=0.7307  file=chicago-il-1.pdf  page=245
      ...
  [2] [TABLE_TEXT RESULT] score=0.7000  file=chicago-il-1.pdf  page=13
      table_id=chicago-il-1.pdf_p13_t2  table_type=bulk_density_table
      ...
[DONE] Results saved to: ./outputs/retrieval/single_query_results.csv
```

**CSV columns:**

| Column | Description |
|---|---|
| `query` | The original query string |
| `rank` | Result rank (1 = most relevant) |
| `score` | Similarity score |
| `content_type` | `"page_text"` or `"table_text"` |
| `source_file` | Filename of the source document |
| `page_number` | Page number in the PDF |
| `table_id` | Table identifier (empty for page_text) |
| `table_type` | Table classification (empty for page_text) |
| `text` | Full retrieved passage text |

Results are saved to:

```
outputs/retrieval/single_query_results.csv
```

---

### Verified Query Results (clean_text_index.csv)

| Query | page_text hits | table_text hits | Top table type |
|---|---|---|---|
| `RT4 floor area ratio` | 8 | 0 | — |
| `RS3 minimum lot area` | 6 | 2 (rank 2,3) | `bulk_density_table` |
| `RT4 front setback 15 feet` | 8 | 0 | — |
| `B3-1 allowed uses table` | 3 | 5 (rank 2,4–7) | `use_table` |
| `non-accessory parking permitted special use` | 8 | 0 | — |
| `residential districts maximum height` | 8 | 0 | — |
| `parking requirement dwelling unit` | 5 | 3 (rank 4,5,7) | `parking_table` |
| `pedestrian street transparency requirement` | 8 | 0 | — |

---

## 9b. Web Search Interface

Start the web server:

```bash
python src/server.py --config config.yaml --port 5050
```

Then open **http://127.0.0.1:5050** in your browser.

The web UI provides:
- A search box with Enter-to-search
- 12 example query buttons
- Color-coded similarity scores (green ≥ 0.75, yellow ≥ 0.60)
- Table result badges (orange "Table" chip)
- `content_type` labels (`text` / `table`) per result
- Search term highlighting
- URL-persisted queries (shareable links)

---

## 9c. Parameter Extraction

Batch extract zoning parameters from the RAG index using an LLM.

```bash
python src/extract_parameters.py \
  --config config.yaml \
  --output outputs/results/zoning_parameter_results.csv \
  --evidence-output outputs/results/zoning_parameter_retrieval_evidence.csv
```

**What it does:**

| Step | Description |
|---|---|
| 1. Build queries | Generates a natural-language query per (zone_class, parameter) pair. |
| 2. RAG retrieval | Fetches top-k relevant contexts from the LlamaIndex index. |
| 3. LLM extraction | Passes contexts + prompt to an LLM to extract the parameter value. |
| 4. Save results | Writes `zoning_parameter_results.csv` (one row per combo). |
| 5. Save evidence | Writes `zoning_parameter_retrieval_evidence.csv` (one row per context). |

**Default zone classes (6):**  RT4, RS3, RM5, B3-1, C1-2, M1-2  
**Default parameters (14):**  allowed_use_status, max_far, min_lot_area, lot_area_per_unit,
max_height, front_setback, parking_requirement, landscaping_required, screening_required,
buffer_required, transparency_requirement, entrance_requirement, special_use_required,
planned_development_required

**Results CSV columns:**

| Column | Description |
|---|---|
| `zone_class` | Zoning district (e.g. RT4) |
| `parameter` | Parameter name (e.g. max_far) |
| `query` | Generated retrieval query |
| `value` | Extracted value (e.g. "1.20") |
| `unit` | Unit (e.g. "ratio", "square feet") |
| `status` | `found` / `not_found` / `ambiguous` / `not_applicable` / `error` |
| `evidence` | Short quote from retrieved context |
| `source_file` | Source document filename |
| `page_number` | Page number |
| `content_type` | `page_text` or `table_text` |
| `table_id` | Table identifier |
| `confidence` | `high` / `medium` / `low` |
| `notes` | Conditions, caveats, or error details |

**LLM provider:** Configured in `config.yaml`:

```yaml
llm:
  provider: deepseek
  model: deepseek-chat
  api_key_env: DEEPSEEK_API_KEY
  base_url: https://api.deepseek.com
```

DeepSeek uses an OpenAI-compatible API. You can also use OpenAI:

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
  api_key_env: OPENAI_API_KEY
```

**DeepSeek setup:**

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY = "your-deepseek-api-key"
```

```bash
# Run with DeepSeek (default in config.yaml)
python src/extract_parameters.py \
  --config config.yaml \
  --output outputs/results/zoning_parameter_results_deepseek.csv \
  --evidence-output outputs/results/zoning_parameter_retrieval_evidence_deepseek.csv

# Small-scale test first (recommended)
python src/extract_parameters.py \
  --config config.yaml \
  --llm-provider deepseek \
  --llm-model deepseek-chat \
  --zone-classes RT4 RS3 \
  --parameters max_far min_lot_area front_setback allowed_use_status \
  --top-k 10 \
  --output outputs/results/test_deepseek_results.csv \
  --evidence-output outputs/results/test_deepseek_evidence.csv
```

**CLI options:**

```bash
# Custom zone classes and parameters
python src/extract_parameters.py --config config.yaml \
  --zone-classes RT4 RS3 B1-1 \
  --parameters max_far min_lot_area max_height

# Dry-run (no LLM calls, generates queries and retrieves evidence only)
python src/extract_parameters.py --config config.yaml --dry-run

# Custom top-k
python src/extract_parameters.py --config config.yaml --top-k 12
```

**Outputs:**

```
outputs/results/zoning_parameter_results.csv           — 84 rows (6 × 14)
outputs/results/zoning_parameter_retrieval_evidence.csv — 840 rows (84 × 10 contexts)
```

---

## 10. Recommended Queries (Chicago Zoning Ordinance)

### A. Parameters that *are* in the ordinance

#### Zoning / Use Permission

- `zone_family`
- `allowed_use_status`
- `special_use_required`
- `planned_development_required`
- `residential_use_allowed`
- `commercial_use_allowed`
- `manufacturing_use_allowed`
- `non_accessory_parking_allowed`

#### Bulk & Density

- `min_lot_area`
- `lot_area_per_unit`
- `max_far`
- `front_setback`
- `max_height`

#### Parking & Loading

- `parking_requirement`
- `parking_standard`
- `parking_location_restriction`
- `non_accessory_parking_allowed`

#### Overlay / Pedestrian Street

- `pedestrian_street_overlay`
- `transparency_requirement`
- `entrance_requirement`
- `parking_location_restriction`
- `driveway_access_restriction`

#### Landscaping, Screening, Buffers

- `landscaping_required`
- `screening_required`
- `buffer_required`

### Example queries

Residential / density:

```
"RT-4 front setback"
"RS-3 minimum lot area"
"RT4 floor area ratio table"
"RT4 minimum lot area per unit table"
"RS3 minimum lot area table"
```

Business / commercial:

```
"B3-1 use table permitted special use"
"C1-2 allowed uses table"
"B1-1 parking standard"
"Parking Non-Accessory P/S residential district"
```

Manufacturing:

```
"M1-2 allowed uses"
```

Overlay:

```
"pedestrian street transparency requirement"
"pedestrian street entrance requirement"
```

Landscaping / screening:

```
"landscaping and screening parking lot"
```

**Table-oriented queries** (test table-aware retrieval):

```
"RT4 floor area ratio table"
"RT4 minimum lot area per unit table"
"RS3 minimum lot area table"
"B3-1 use table permitted special use"
"C1-2 allowed uses table"
"Parking Non-Accessory P/S residential district"
"pedestrian street transparency requirement"
```

### B. NOT suitable for the Zoning Ordinance (streetscape observations)

These are observations from street-level imagery, not ordinance text:

- `actual_street_lighting_visible`
- `actual_ground_floor_commercial`
- `actual_active_frontage`
- `actual_blank_wall_ratio`
- `actual_window_ratio`
- `actual_surface_parking`
- `actual_vacant_lot`
- `actual_fence_presence`
- `actual_landscaping_presence`
- `actual_building_setback`
- `actual_sidewalk_visibility`

### C. Requires external codes / regulations

- `liquor_license_related`
- `public_place_of_amusement_license`
- `adult_use_license_related`
- `security_lighting_standard`
- `vacant_lot_maintenance_rule`

---

## 11. Configuration (config.yaml)

```yaml
documents_dir: ./data/raw_documents   # input documents
storage_dir: ./storage                 # persisted index

retrieval:
  top_k: 8                             # number of results per query

embedding:
  model_name: BAAI/bge-small-en-v1.5  # HuggingFace embedding model

llm:
  provider: deepseek                   # deepseek | openai | huggingface
  model: deepseek-chat                 # deepseek-chat | gpt-4o-mini
  api_key_env: DEEPSEEK_API_KEY        # env var for API key
  base_url: https://api.deepseek.com   # API endpoint

outputs:
  retrieval_csv: ./outputs/retrieval/single_query_results.csv
  tables_dir: ./outputs/tables         # extracted tables CSV
```

---

## 12. Project Structure

```
llamaindex-zoning-rag/
├── data/
│   └── raw_documents/        # Put PDF / DOCX / TXT files here
├── outputs/
│   ├── retrieval/            # single_query_results.csv
│   ├── results/              # reserved for future results
│   ├── tables/               # raw_tables.csv, table_text_chunks.csv
│   └── clean_text/           # chicago_zoning_cleaned.md, clean_text_index.csv
├── storage/                  # persisted VectorStoreIndex
├── src/
│   ├── __init__.py
│   ├── build_index.py        # Build the index (prefers clean_text_index.csv)
│   ├── build_clean_policy_text.py  # Merge text + table descriptions
│   ├── query_index.py        # Query the index, save CSV
│   ├── server.py             # Flask web server
│   ├── table_extractor.py    # Extract tables from PDF via pdfplumber
│   ├── table_to_text.py      # Table-to-text preprocessing pipeline
│   ├── extract_parameters.py  # Batch parameter extraction via LLM
│   ├── prompts.py            # Prompt templates (retrieval + extraction)
│   ├── utils.py              # Config loading, path helpers
│   └── static/
│       └── index.html        # Search engine web UI
├── config.yaml
├── requirements.txt
├── README.md
└── .gitignore
```
