"""
extract_parameters.py — Extract zoning parameters from retrieved RAG contexts using an LLM.

For each (zone_class, parameter) pair:
    1. Build a natural-language query.
    2. Retrieve top-k relevant contexts from the LlamaIndex index.
    3. Ask an LLM (OpenAI / DeepSeek / HuggingFace) to extract the parameter value.
    4. Save extraction results + full retrieval evidence to CSVs.

Supports: OpenAI, DeepSeek (OpenAI-compatible), HuggingFace Inference API.

Usage:
    # DeepSeek (default in config.yaml)
    python src/extract_parameters.py \
      --config config.yaml \
      --output outputs/results/zoning_parameter_results.csv \
      --evidence-output outputs/results/zoning_parameter_retrieval_evidence.csv

    # OpenAI override
    python src/extract_parameters.py \
      --config config.yaml \
      --llm-provider openai \
      --llm-model gpt-4o-mini

    # Small-scale test
    python src/extract_parameters.py \
      --config config.yaml \
      --llm-provider deepseek \
      --zone-classes RT4 RS3 \
      --parameters max_far min_lot_area
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from typing import Any, Optional

from llama_index.core import Settings, StorageContext, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import load_config, resolve_path
from src.prompts import PARAMETER_EXTRACTION_PROMPT


# ---------------------------------------------------------------------------
#  built-in zoning classes & parameter list (first version)
# ---------------------------------------------------------------------------

DEFAULT_ZONE_CLASSES = [
    "RT4", "RS3", "RM5",
    "B3-1", "C1-2", "M1-2",
]

DEFAULT_PARAMETERS = [
    "allowed_use_status",
    "special_use_required",
    "planned_development_required",
    "max_far",
    "min_lot_area",
    "lot_area_per_unit",
    "max_height",
    "front_setback",
    "parking_requirement",
    "landscaping_required",
    "screening_required",
    "buffer_required",
    "transparency_requirement",
    "entrance_requirement",
]


# ---------------------------------------------------------------------------
#  query builder
# ---------------------------------------------------------------------------

PARAM_QUERY_MAP: dict[str, str] = {
    "allowed_use_status":           "{zone} allowed uses permitted special use use table",
    "special_use_required":         "{zone} special use required use table S",
    "planned_development_required": "{zone} planned development required PD use table",
    "max_far":                      "{zone} floor area ratio maximum FAR bulk table",
    "min_lot_area":                 "{zone} minimum lot area square feet bulk table",
    "lot_area_per_unit":            "{zone} lot area per unit dwelling unit bulk table",
    "max_height":                   "{zone} maximum building height feet bulk table",
    "front_setback":                "{zone} front setback minimum feet lot depth",
    "parking_requirement":          "{zone} parking requirement spaces per dwelling unit parking standard",
    "landscaping_required":         "{zone} landscaping required parking lot landscaping screening",
    "screening_required":           "{zone} screening requirement manufacturing residential buffer",
    "buffer_required":              "{zone} buffer requirement manufacturing residential district",
    "transparency_requirement":     "{zone} pedestrian street transparency requirement percent facade",
    "entrance_requirement":         "{zone} pedestrian street entrance requirement",
}


def build_query(zone_class: str, parameter: str) -> str:
    """Build a retrieval query from a zone class and parameter name."""
    template = PARAM_QUERY_MAP.get(parameter)
    if template:
        return template.format(zone=zone_class)
    readable = parameter.replace("_", " ")
    return f"{zone_class} {readable} Chicago Zoning Ordinance"


# ---------------------------------------------------------------------------
#  RAG retrieval helper
# ---------------------------------------------------------------------------

def retrieve_contexts(index, query: str, top_k: int) -> list[dict]:
    """Retrieve top_k contexts from the index."""
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
#  LLM client factory — unified OpenAI / DeepSeek / HuggingFace
# ---------------------------------------------------------------------------

def _init_llm_client(provider: str, model: str, api_key_env: str, base_url: str):
    """Create an LLM client that exposes .complete(prompt) -> str."""
    provider = provider.lower()

    if provider in ("openai", "deepseek"):
        api_key = os.environ.get(api_key_env)
        if not api_key:
            print(f"[ERROR] Environment variable {api_key_env} is not set.")
            print(f"        Set it with: $env:{api_key_env} = \"your-api-key\"")
            sys.exit(1)

        from openai import OpenAI as OpenAIClient
        client = OpenAIClient(api_key=api_key, base_url=base_url)

        class _Wrapper:
            """Thin wrapper providing .complete(prompt) -> str."""
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
        print(f"        Supported: openai, deepseek, huggingface")
        sys.exit(1)


# ---------------------------------------------------------------------------
#  prompt formatting & JSON parsing
# ---------------------------------------------------------------------------

def _format_contexts_for_prompt(retrieved: list[dict]) -> str:
    """Format retrieved contexts into a prompt-ready string."""
    parts: list[str] = []
    for r in retrieved:
        tag = "[TABLE_TEXT RESULT]" if r["content_type"] == "table_text" else "[PAGE_TEXT RESULT]"
        meta = f"Source: {r['source_file']}, Page: {r['page_number']}"
        if r["content_type"] == "table_text" and r.get("table_id"):
            meta += f", Table ID: {r['table_id']}, Table Type: {r.get('table_type','')}"
        parts.append(f"{tag}\n{meta}\n\n{r['text']}")
    return "\n\n---\n\n".join(parts)


def _parse_json_response(raw: str) -> dict | None:
    """
    Multi-strategy JSON parser for LLM responses.

    Tries (in order):
      1. Direct json.loads
      2. Strip ```json fences then json.loads
      3. Extract the first balanced-brace JSON block
      4. Extract the last balanced-brace JSON block
    Returns parsed dict or None.
    """
    raw = raw.strip()
    if not raw:
        return None

    strategies: list[str] = [
        raw,
        re.sub(r"^```(?:json)?\s*\n", "", raw).removesuffix("```").strip(),
        (m.group(1).strip() if (m := re.search(
            r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)) else ""),
    ]

    for candidate in strategies:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    # Balanced-brace extraction: first { ... } block
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

    # Last { ... } block
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
#  extraction function
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

    # Call LLM
    try:
        raw_response = str(llm.complete(prompt)).strip()
    except Exception as exc:
        return {
            "value": "", "unit": "",
            "status": "error",
            "evidence": "",
            "source_file": "", "page_number": "",
            "content_type": "", "table_id": "",
            "confidence": "",
            "notes": f"LLM call failed: {exc}",
        }

    # Parse JSON
    data = _parse_json_response(raw_response)

    if data is None:
        return {
            "value": "", "unit": "",
            "status": "error",
            "evidence": "",
            "source_file": "", "page_number": "",
            "content_type": "", "table_id": "",
            "confidence": "",
            "notes": f"LLM returned non-JSON (first 400 chars): {raw_response[:400]}",
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
#  main pipeline
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Extract zoning parameters from RAG contexts using an LLM."
    )
    parser.add_argument("--config", type=str, default="config.yaml")
    parser.add_argument("--output", type=str,
                        default="outputs/results/zoning_parameter_results.csv")
    parser.add_argument("--evidence-output", type=str,
                        default="outputs/results/zoning_parameter_retrieval_evidence.csv")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--llm-model", type=str, default=None)
    parser.add_argument("--llm-provider", type=str, default=None)
    parser.add_argument("--zone-classes", type=str, nargs="*")
    parser.add_argument("--parameters", type=str, nargs="*")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    # ---- load config ----
    config_path = args.config
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.getcwd(), config_path)
    config = load_config(config_path)
    project_root = os.path.dirname(config_path)

    storage_dir = resolve_path(project_root, config["storage_dir"])
    embedding_model_name = config["embedding"]["model_name"]

    zone_classes = args.zone_classes if args.zone_classes else DEFAULT_ZONE_CLASSES
    parameters = args.parameters if args.parameters else DEFAULT_PARAMETERS

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

    print(f"[INFO] LLM provider: {llm_provider}")
    print(f"[INFO] LLM model:    {llm_model}")
    print(f"[INFO] API key env:  {api_key_env}")
    if base_url:
        print(f"[INFO] Base URL:     {base_url}")
    print(f"[INFO] Zones:        {len(zone_classes)}")
    print(f"[INFO] Parameters:   {len(parameters)}")
    print(f"[INFO] Total combos: {len(zone_classes) * len(parameters)}")
    print(f"[INFO] Top-k:        {args.top_k}")
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
        print(f"[INFO] LLM ready.")
    else:
        print("[INFO] Dry-run mode -- skipping LLM calls.")
    print()

    # ---- output setup ----
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    os.makedirs(os.path.dirname(args.evidence_output), exist_ok=True)

    result_rows: list[dict] = []
    evidence_rows: list[dict] = []

    total = len(zone_classes) * len(parameters)
    done = 0

    for zone in zone_classes:
        for param in parameters:
            query = build_query(zone, param)
            retrieved = retrieve_contexts(index, query, top_k=args.top_k)

            for r in retrieved:
                evidence_rows.append({
                    "zone_class": zone, "parameter": param, "query": query,
                    "rank": r["rank"], "score": r["score"],
                    "source_file": r["source_file"], "page_number": r["page_number"],
                    "content_type": r["content_type"], "table_id": r["table_id"],
                    "table_type": r["table_type"], "text": r["text"],
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
                extracted = extract_parameter_with_llm(zone, param, retrieved, llm)

            result_rows.append({
                "zone_class": zone, "parameter": param, "query": query,
                "value": extracted["value"], "unit": extracted["unit"],
                "status": extracted["status"], "evidence": extracted["evidence"],
                "source_file": extracted["source_file"],
                "page_number": extracted["page_number"],
                "content_type": extracted["content_type"],
                "table_id": extracted["table_id"],
                "confidence": extracted["confidence"],
                "notes": extracted["notes"],
            })

            done += 1
            print(f"  [{done}/{total}] {zone} / {param:30s}  "
                  f"status={extracted['status']:16s}  "
                  f"value=\"{extracted['value'][:40]}\"")

    # ---- write CSVs ----
    with open(args.output, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "zone_class", "parameter", "query", "value", "unit", "status",
            "evidence", "source_file", "page_number",
            "content_type", "table_id", "confidence", "notes",
        ])
        w.writeheader()
        w.writerows(result_rows)
    print(f"\n[DONE] Results saved to: {args.output}")

    with open(args.evidence_output, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "zone_class", "parameter", "query",
            "rank", "score", "source_file", "page_number",
            "content_type", "table_id", "table_type", "text",
        ])
        w.writeheader()
        w.writerows(evidence_rows)
    print(f"[DONE] Evidence saved to: {args.evidence_output}")


if __name__ == "__main__":
    main()
