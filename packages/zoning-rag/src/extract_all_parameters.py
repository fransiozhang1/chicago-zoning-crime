"""
extract_all_parameters.py — Full-parameter extraction for all zone classes from Boundaries_Zoning_filtered.

Two-phase pipeline:
  Phase 1: RAG retrieval + LLM extraction for every (zone_class, parameter) combo.
  Phase 2: Inference pass — for every "not_found" result, infer the most likely
            value by examining patterns from same-family zones.

Reads zone classes from zone_classes.txt and parameter definitions from
zoning_parameters_for_extraction.csv.

Usage:
    $env:DEEPSEEK_API_KEY = "your-key"
    python src/extract_all_parameters.py --config config.yaml
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from typing import Any, Optional

from llama_index.core import Settings, StorageContext, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import load_config, resolve_path
from src.prompts import PARAMETER_EXTRACTION_PROMPT, INFERENCE_PROMPT


# ---------------------------------------------------------------------------
#  Zone family classification
# ---------------------------------------------------------------------------

def get_zone_family(zone_class: str) -> str:
    """Return the zone family (B, C, M, R, PD, POS, T)."""
    z = zone_class.strip()
    if z.startswith("B"):
        return "B"
    if z.startswith("C"):
        return "C"
    if z.startswith("M"):
        return "M"
    if z.startswith("RM") or z.startswith("RS") or z.startswith("RT"):
        return "R"
    if z.startswith("PD"):
        return "PD"
    if z.startswith("POS"):
        return "POS"
    if z == "T":
        return "T"
    # fallback: first letter prefix
    prefix = z.split("-")[0].split(" ")[0].rstrip("0123456789")
    return prefix


# ---------------------------------------------------------------------------
#  Parameter definitions from CSV
# ---------------------------------------------------------------------------

def load_parameter_defs(param_csv_path: str) -> list[dict]:
    """Load parameter definitions from zoning_parameters_for_extraction.csv."""
    defs: list[dict] = []
    with open(param_csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("parameter_name", "").strip()
            if not name:
                continue
            defs.append({
                "parameter_name": name,
                "chinese_name": row.get("chinese_name", "").strip(),
                "category": row.get("category", "").strip(),
                "expected_value_type": row.get("expected_value_type", "").strip(),
                "unit": row.get("unit", "").strip(),
                "extraction_query_template": row.get("extraction_query_template", "").strip(),
                "priority": row.get("priority", "").strip(),
                "notes": row.get("notes", "").strip(),
            })
    return defs


def load_zone_classes(txt_path: str) -> list[str]:
    """Load zone classes from zone_classes.txt (one per line)."""
    with open(txt_path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


# ---------------------------------------------------------------------------
#  Query builder
# ---------------------------------------------------------------------------

def build_query(zone_class: str, param_def: dict) -> str:
    """Build a retrieval query from zone class and parameter definition template."""
    template = param_def.get("extraction_query_template", "")
    if template and "{zone_class}" in template:
        return template.replace("{zone_class}", zone_class)
    # fallback
    readable = param_def["parameter_name"].replace("_", " ")
    return f"{zone_class} {readable} Chicago Zoning Ordinance"


# ---------------------------------------------------------------------------
#  RAG retrieval
# ---------------------------------------------------------------------------

def retrieve_contexts(index, query: str, top_k: int) -> list[dict]:
    """Retrieve top_k contexts from the LlamaIndex."""
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(query)

    results: list[dict] = []
    for rank, node in enumerate(nodes, start=1):
        meta = node.metadata or {}
        results.append({
            "rank": rank,
            "score": round(float(node.score or 0), 6),
            "source_file": meta.get("file_name", "unknown"),
            "page_number": str(meta.get("page_number", "")),
            "content_type": meta.get("content_type", "page_text"),
            "table_id": meta.get("table_id", ""),
            "table_type": meta.get("table_type", ""),
            "text": node.text.strip(),
        })
    return results


# ---------------------------------------------------------------------------
#  LLM client factory
# ---------------------------------------------------------------------------

def _init_llm_client(provider: str, model: str, api_key_env: str, base_url: str):
    provider = provider.lower()

    if provider in ("openai", "deepseek"):
        api_key = os.environ.get(api_key_env)
        if not api_key:
            print(f"[ERROR] Environment variable {api_key_env} is not set.")
            sys.exit(1)

        from openai import OpenAI as OpenAIClient
        client = OpenAIClient(api_key=api_key, base_url=base_url)

        class _Wrapper:
            def __init__(self, inner_client, model_name):
                self._client = inner_client
                self._model = model_name

            def complete(self, prompt: str) -> str:
                resp = self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {"role": "system",
                         "content": "You are a precise zoning regulation data extractor."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.0,
                )
                return resp.choices[0].message.content or ""

        return _Wrapper(client, model)

    elif provider == "huggingface":
        from llama_index.llms.huggingface_api import HuggingFaceInferenceAPI
        return HuggingFaceInferenceAPI(model_name=model, temperature=0.0)

    else:
        print(f"[ERROR] Unknown LLM provider: {provider}")
        sys.exit(1)


# ---------------------------------------------------------------------------
#  Prompt formatting & JSON parsing
# ---------------------------------------------------------------------------

def _format_contexts_for_prompt(retrieved: list[dict]) -> str:
    parts: list[str] = []
    for r in retrieved:
        tag = "[TABLE_TEXT RESULT]" if r["content_type"] == "table_text" else "[PAGE_TEXT RESULT]"
        meta = f"Source: {r['source_file']}, Page: {r['page_number']}"
        if r["content_type"] == "table_text" and r.get("table_id"):
            meta += f", Table ID: {r['table_id']}, Table Type: {r.get('table_type','')}"
        parts.append(f"{tag}\n{meta}\n\n{r['text']}")
    return "\n\n---\n\n".join(parts)


def _parse_json_response(raw: str) -> dict | None:
    raw = raw.strip()
    if not raw:
        return None

    # Strategy 1: direct
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Strategy 2: strip fences
    try:
        cleaned = re.sub(r"^```(?:json)?\s*\n", "", raw).removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Strategy 3: fence block
    m = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Strategy 4: first balanced-brace block
    start = raw.find("{")
    if start != -1:
        depth = 0
        for i in range(start, len(raw)):
            if raw[i] == "{":
                depth += 1
            elif raw[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start:i + 1])
                    except json.JSONDecodeError:
                        break

    # Strategy 5: last balanced-brace block
    end = raw.rfind("}")
    if end != -1:
        depth = 0
        for i in range(end, -1, -1):
            if raw[i] == "}":
                depth += 1
            elif raw[i] == "{":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[i:end + 1])
                    except json.JSONDecodeError:
                        break

    return None


# ---------------------------------------------------------------------------
#  Phase 1: RAG extraction
# ---------------------------------------------------------------------------

def extract_parameter_with_llm(
    zone_class: str,
    parameter: str,
    retrieved_contexts: list[dict],
    llm,
) -> dict:
    """Use an LLM to extract a parameter value from retrieved contexts."""
    context_block = _format_contexts_for_prompt(retrieved_contexts)
    prompt = PARAMETER_EXTRACTION_PROMPT.format(
        context=context_block,
        zone_class=zone_class,
        parameter=parameter,
    )

    try:
        raw_response = str(llm.complete(prompt)).strip()
    except Exception as exc:
        return {
            "value": "", "unit": "",
            "status": "error",
            "evidence": "", "source_file": "", "page_number": "",
            "content_type": "", "table_id": "",
            "confidence": "",
            "notes": f"LLM call failed: {exc}",
        }

    data = _parse_json_response(raw_response)

    if data is None:
        return {
            "value": "", "unit": "",
            "status": "error",
            "evidence": "", "source_file": "", "page_number": "",
            "content_type": "", "table_id": "",
            "confidence": "",
            "notes": f"Non-JSON response (first 400 chars): {raw_response[:400]}",
        }

    return {
        "value":           str(data.get("value", "")).strip(),
        "unit":            str(data.get("unit", "")).strip(),
        "status":          str(data.get("status", "not_found")).strip().lower(),
        "evidence":        str(data.get("evidence", "")).strip(),
        "source_file":     str(data.get("source_file", "")).strip(),
        "page_number":     str(data.get("page_number", "")).strip(),
        "content_type":    str(data.get("content_type", "")).strip(),
        "table_id":        str(data.get("table_id", "")).strip(),
        "confidence":      str(data.get("confidence", "")).strip(),
        "notes":           str(data.get("notes", "")).strip(),
    }


# ---------------------------------------------------------------------------
#  Phase 2: Inference for not_found parameters
# ---------------------------------------------------------------------------

def _format_known_values(results: list[dict], target_zone: str, target_param: str,
                         family: str, zone_family_map: dict[str, str]) -> str:
    """Build a summary of known values for same-family zones."""
    parts: list[str] = []

    for row in results:
        if row["parameter"] != target_param:
            continue
        zone = row["zone_class"]
        fam = zone_family_map.get(zone, "?")
        if fam != family:
            continue
        if zone == target_zone:
            continue
        if row["status"] not in ("found", "ambiguous", "inferred"):
            continue
        if not row["value"]:
            continue

        parts.append(
            f"  - {zone} ({fam}-family): value=\"{row['value']}\""
            f"{' ' + row.get('unit','') if row.get('unit') else ''}"
            f" (status={row['status']}, confidence={row.get('confidence','')})"
        )

    if not parts:
        # try broader: same top-level family (B, C, M, R)
        broader = family.split("-")[0] if "-" in family else family
        for row in results:
            if row["parameter"] != target_param:
                continue
            zone = row["zone_class"]
            fam = zone_family_map.get(zone, "?")
            if fam == family:
                continue
            if not fam.startswith(broader):
                continue
            if row["status"] not in ("found", "ambiguous", "inferred"):
                continue
            if not row["value"]:
                continue
            parts.append(
                f"  - {zone} ({fam}-family, broader): value=\"{row['value']}\""
                f"{' ' + row.get('unit','') if row.get('unit') else ''}"
            )

    if not parts:
        return "(No known values from any same-family zones.)"

    return "\n".join(parts)


def infer_parameter(
    zone_class: str,
    parameter: str,
    param_def: dict,
    all_results: list[dict],
    zone_family_map: dict[str, str],
    llm,
) -> dict:
    """Infer a parameter value from patterns in related zones."""
    family = zone_family_map.get(zone_class, "?")

    known_values = _format_known_values(
        all_results, zone_class, parameter, family, zone_family_map
    )

    if "(No known values" in known_values:
        return {
            "value": "",
            "unit": "",
            "status": "not_inferrable",
            "confidence": "",
            "notes": "No known values from same-family zones to base inference on.",
        }

    param_desc = f"{param_def.get('chinese_name','')} ({param_def.get('expected_value_type','')})"
    if param_def.get("unit"):
        param_desc += f" — unit: {param_def['unit']}"

    prompt = INFERENCE_PROMPT.format(
        zone_class=zone_class,
        parameter=parameter,
        parameter_desc=param_desc,
        known_values=known_values,
    )

    try:
        raw_response = str(llm.complete(prompt)).strip()
    except Exception as exc:
        return {
            "value": "", "unit": "",
            "status": "error",
            "confidence": "",
            "notes": f"Inference LLM call failed: {exc}",
        }

    data = _parse_json_response(raw_response)

    if data is None:
        # fallback: if JSON parsing fails, record raw response
        return {
            "value": "",
            "unit": "",
            "status": "not_inferrable",
            "confidence": "",
            "notes": f"Inference JSON parse failed. Raw: {raw_response[:300]}",
        }

    return {
        "value":      str(data.get("value", "")).strip(),
        "unit":       str(data.get("unit", "")).strip(),
        "status":     str(data.get("status", "not_inferrable")).strip().lower(),
        "confidence": str(data.get("confidence", "")).strip(),
        "notes":      str(data.get("notes", "")).strip(),
    }


# ---------------------------------------------------------------------------
#  Main pipeline
# ---------------------------------------------------------------------------

def _summarize_results(rows: list[dict]) -> None:
    """Print summary statistics."""
    total = len(rows)
    by_status: dict[str, int] = defaultdict(int)
    by_method: dict[str, int] = defaultdict(int)
    for r in rows:
        s = r.get("status", "unknown")
        m = r.get("extraction_method", "unknown")
        by_status[s] += 1
        by_method[m] += 1

    print("\n" + "=" * 60)
    print("EXTRACTION SUMMARY")
    print("=" * 60)
    print(f"  Total (zone × parameter) combos: {total}")
    print()
    print("  By extraction method:")
    for m in ["rag_found", "inferred", "not_found", "not_inferrable", "not_applicable", "error", "dry_run"]:
        cnt = by_method.get(m, 0)
        if cnt:
            pct = cnt / total * 100
            print(f"    {m:22s}  {cnt:5d}  ({pct:5.1f}%)")
    print()
    print("  By status:")
    for s, cnt in sorted(by_status.items(), key=lambda x: -x[1]):
        pct = cnt / total * 100
        print(f"    {s:20s}  {cnt:5d}  ({pct:5.1f}%)")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Full-parameter extraction for all zone classes with inference fallback."
    )
    parser.add_argument("--config", type=str, default="config.yaml")
    parser.add_argument("--output", type=str,
                        default="outputs/results/all_zone_parameter_results.csv")
    parser.add_argument("--evidence-output", type=str,
                        default="outputs/results/all_zone_parameter_retrieval_evidence.csv")
    parser.add_argument("--param-csv", type=str,
                        default="zoning_parameters_for_extraction.csv")
    parser.add_argument("--zone-txt", type=str,
                        default="zone_classes.txt")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--llm-model", type=str, default=None)
    parser.add_argument("--llm-provider", type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-inference", action="store_true",
                        help="Skip the inference pass for not_found results.")
    args = parser.parse_args()

    # ---- load config ----
    config_path = args.config
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.getcwd(), config_path)
    config = load_config(config_path)
    project_root = os.path.dirname(config_path)

    storage_dir = resolve_path(project_root, config["storage_dir"])
    embedding_model_name = config["embedding"]["model_name"]

    # ---- load zone classes and parameter definitions ----
    zone_classes = load_zone_classes(os.path.join(project_root, args.zone_txt))
    param_defs = load_parameter_defs(os.path.join(project_root, args.param_csv))

    # ---- LLM setup ----
    llm_cfg = config.get("llm", {})
    llm_provider = args.llm_provider or llm_cfg.get("provider", "openai")
    llm_model    = args.llm_model    or llm_cfg.get("model", "gpt-4o-mini")
    api_key_env  = llm_cfg.get("api_key_env", "OPENAI_API_KEY")
    base_url     = llm_cfg.get("base_url", "")

    if llm_provider == "deepseek":
        if "api_key_env" not in llm_cfg:
            api_key_env = "DEEPSEEK_API_KEY"
        if "base_url" not in llm_cfg:
            base_url = "https://api.deepseek.com"
        if not args.llm_model and "model" not in llm_cfg:
            llm_model = "deepseek-chat"

    total_combos = len(zone_classes) * len(param_defs)

    print(f"[INFO] LLM provider:  {llm_provider}")
    print(f"[INFO] LLM model:     {llm_model}")
    print(f"[INFO] API key env:   {api_key_env}")
    if base_url:
        print(f"[INFO] Base URL:      {base_url}")
    print(f"[INFO] Zone classes:  {len(zone_classes)}")
    print(f"[INFO] Parameters:    {len(param_defs)}")
    print(f"[INFO] Total combos:  {total_combos}")
    print(f"[INFO] Top-k:         {args.top_k}")
    print()

    # ---- load index ----
    index_file = os.path.join(storage_dir, "docstore.json")
    if not os.path.exists(index_file):
        print(f"[ERROR] No index found at {storage_dir}")
        sys.exit(1)

    print(f"[INFO] Loading embedding model: {embedding_model_name}")
    embed_model = HuggingFaceEmbedding(model_name=embedding_model_name)
    Settings.embed_model = embed_model

    print(f"[INFO] Loading index from: {storage_dir}")
    storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
    index = load_index_from_storage(storage_context)

    # ---- init LLM ----
    llm = None
    if not args.dry_run:
        llm = _init_llm_client(llm_provider, llm_model, api_key_env, base_url)
        print("[INFO] LLM ready.")
    else:
        print("[INFO] Dry-run mode — skipping LLM calls.")
    print()

    # ---- output setup ----
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    os.makedirs(os.path.dirname(args.evidence_output), exist_ok=True)

    zone_family_map: dict[str, str] = {z: get_zone_family(z) for z in zone_classes}

    # ---- Phase 1: RAG extraction for all combos ----
    result_rows: list[dict] = []
    evidence_rows: list[dict] = []

    done = 0
    print("=" * 60)
    print("PHASE 1: RAG + LLM Extraction")
    print("=" * 60)

    for zone in zone_classes:
        for pdef in param_defs:
            param_name = pdef["parameter_name"]
            query = build_query(zone, pdef)
            retrieved = retrieve_contexts(index, query, top_k=args.top_k)

            # save evidence
            for r in retrieved:
                evidence_rows.append({
                    "zone_class": zone,
                    "parameter": param_name,
                    "query": query,
                    "rank": r["rank"],
                    "score": r["score"],
                    "source_file": r["source_file"],
                    "page_number": r["page_number"],
                    "content_type": r["content_type"],
                    "table_id": r["table_id"],
                    "table_type": r["table_type"],
                    "text": r["text"],
                })

            if args.dry_run:
                extracted = {
                    "value": "", "unit": "",
                    "status": "dry_run",
                    "evidence": "", "source_file": "", "page_number": "",
                    "content_type": "", "table_id": "",
                    "confidence": "",
                    "notes": f"Query: {query}",
                }
            else:
                extracted = extract_parameter_with_llm(zone, param_name, retrieved, llm)

            extraction_method = "rag_found" if extracted["status"] in ("found", "ambiguous") else extracted["status"]
            if extracted["status"] in ("error",):
                extraction_method = "error"

            result_rows.append({
                "zone_class": zone,
                "zone_family": zone_family_map[zone],
                "parameter": param_name,
                "parameter_category": pdef["category"],
                "query": query,
                "value": extracted["value"],
                "unit": extracted["unit"],
                "status": extracted["status"],
                "evidence": extracted["evidence"],
                "source_file": extracted["source_file"],
                "page_number": extracted["page_number"],
                "content_type": extracted["content_type"],
                "table_id": extracted["table_id"],
                "confidence": extracted["confidence"],
                "notes": extracted["notes"],
                "extraction_method": extraction_method,
            })

            done += 1
            print(f"  [{done}/{total_combos}] {zone:8s} / {param_name:30s}  "
                  f"status={extracted['status']:20s}  "
                  f"value=\"{extracted['value'][:50]}\"")

    print()
    print(f"[Phase 1 DONE] {done} combos processed.")
    print()

    # ---- Phase 2: Inference for not_found ----
    if not args.dry_run and not args.skip_inference:
        not_found_indices = [
            i for i, row in enumerate(result_rows)
            if row["status"] in ("not_found",)
        ]
        if not_found_indices:
            print("=" * 60)
            print(f"PHASE 2: Inference for {len(not_found_indices)} not_found results")
            print("=" * 60)

            infer_done = 0
            for idx in not_found_indices:
                row = result_rows[idx]
                zone = row["zone_class"]
                param_name = row["parameter"]

                # find the parameter definition
                pdef = next((p for p in param_defs if p["parameter_name"] == param_name), None)
                if pdef is None:
                    continue

                inferred = infer_parameter(zone, param_name, pdef, result_rows, zone_family_map, llm)

                row["value"] = inferred["value"]
                row["unit"] = inferred.get("unit", row.get("unit", ""))
                row["status"] = inferred["status"] if inferred["status"] != "error" else "not_found"
                row["confidence"] = inferred.get("confidence", row.get("confidence", ""))
                row["notes"] = (inferred.get("notes", "") + " [inferred from same-family zones]").strip()
                row["extraction_method"] = "inferred" if inferred["status"] == "inferred" else "not_inferrable"

                infer_done += 1
                print(f"  [{infer_done}/{len(not_found_indices)}] {zone:8s} / {param_name:30s}  "
                      f"inferred_as={row['extraction_method']:15s}  "
                      f"value=\"{inferred['value'][:50]}\"")

            print()
            print(f"[Phase 2 DONE] {infer_done} inferred.")
        else:
            print("[Phase 2 SKIPPED] No not_found results to infer.")
    else:
        if args.dry_run:
            print("[Phase 2 SKIPPED] Dry-run mode.")
        elif args.skip_inference:
            print("[Phase 2 SKIPPED] --skip-inference flag set.")

    print()

    # ---- write CSVs ----
    fieldnames = [
        "zone_class", "zone_family", "parameter", "parameter_category",
        "query", "value", "unit", "status", "evidence",
        "source_file", "page_number", "content_type", "table_id",
        "confidence", "notes", "extraction_method",
    ]

    with open(args.output, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(result_rows)
    print(f"[DONE] Results saved to: {args.output}")

    ev_fieldnames = [
        "zone_class", "parameter", "query",
        "rank", "score", "source_file", "page_number",
        "content_type", "table_id", "table_type", "text",
    ]
    with open(args.evidence_output, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=ev_fieldnames)
        w.writeheader()
        w.writerows(evidence_rows)
    print(f"[DONE] Evidence saved to: {args.evidence_output}")

    # ---- summary ----
    _summarize_results(result_rows)


if __name__ == "__main__":
    main()
