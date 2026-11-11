"""
query_index.py — Query a persisted VectorStoreIndex and return top-k results.

Usage:
    python src/query_index.py --query "RT-4 front setback" --config config.yaml

Output:
    outputs/retrieval/single_query_results.csv
    Columns: query, rank, score, content_type, source_file, page_number,
             table_id, table_type, text
"""

import argparse
import csv
import os
import sys

from llama_index.core import Settings, StorageContext, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import load_config, resolve_path


def main():
    parser = argparse.ArgumentParser(
        description="Query the zoning-policy index and return top-k retrieved passages."
    )
    parser.add_argument(
        "--query", type=str, required=True,
        help="Natural-language query (e.g. 'RT-4 front setback')."
    )
    parser.add_argument(
        "--config", type=str, default="config.yaml",
        help="Path to the YAML configuration file."
    )
    args = parser.parse_args()

    # ---- load config ----
    config_path = args.config
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.getcwd(), config_path)

    config = load_config(config_path)
    project_root = os.path.dirname(config_path)

    storage_dir = resolve_path(project_root, config["storage_dir"])
    embedding_model_name = config["embedding"]["model_name"]
    top_k = config["retrieval"]["top_k"]
    output_csv = resolve_path(project_root, config["outputs"]["retrieval_csv"])

    # ---- check index exists ----
    index_file = os.path.join(storage_dir, "docstore.json")
    if not os.path.exists(index_file):
        print(f"[ERROR] No index found at {storage_dir}")
        print("        Run build_index.py first.")
        sys.exit(1)

    # ---- configure embedding model ----
    print(f"[INFO] Loading embedding model: {embedding_model_name}")
    embed_model = HuggingFaceEmbedding(model_name=embedding_model_name)
    Settings.embed_model = embed_model

    # ---- load index ----
    print(f"[INFO] Loading index from: {storage_dir}")
    storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
    index = load_index_from_storage(storage_context)

    # ---- retrieve ----
    print(f"[INFO] Query: {args.query}")
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(args.query)

    print(f"[INFO] Retrieved {len(nodes)} result(s).")

    # ---- format results ----
    os.makedirs(os.path.dirname(output_csv), exist_ok=True)

    rows = []
    for rank, node in enumerate(nodes, start=1):
        metadata = node.metadata or {}
        content_type = metadata.get("content_type", "page_text")
        source_file = metadata.get("file_name", "unknown")
        page_number = str(metadata.get("page_number", ""))
        table_id = metadata.get("table_id", "")
        table_type = metadata.get("table_type", "")
        score = round(node.score or 0.0, 6)
        text = node.text.strip()

        rows.append({
            "query": args.query,
            "rank": rank,
            "score": score,
            "content_type": content_type,
            "source_file": source_file,
            "page_number": page_number,
            "table_id": table_id,
            "table_type": table_type,
            "text": text,
        })

        # ---- print summary with content-type tag ----
        if content_type == "table_text":
            tag = "[TABLE_TEXT RESULT]"
        else:
            tag = "[PAGE_TEXT RESULT]"

        extra = ""
        if table_id:
            extra = f"  table_id={table_id}  table_type={table_type}"
        # Encode to ASCII, replacing non-ASCII chars to avoid terminal encoding issues
        preview = text[:150].encode("ascii", errors="replace").decode("ascii")
        print(f"  [{rank}] {tag} score={score:.4f}  file={source_file}  page={page_number}{extra}")
        print(f"      {preview}...")
        print()

    with open(output_csv, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "query", "rank", "score", "content_type",
                "source_file", "page_number", "table_id", "table_type", "text",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"[DONE] Results saved to: {output_csv}")


if __name__ == "__main__":
    main()
