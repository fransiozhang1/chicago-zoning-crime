"""
server.py — Flask web server for the zoning policy search engine.

Usage:
    python src/server.py --config config.yaml

Then open http://127.0.0.1:5050 in your browser.
"""

import argparse
import os
import sys
import time

from flask import Flask, jsonify, request, send_from_directory

from llama_index.core import Settings, StorageContext, load_index_from_storage
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import load_config, resolve_path

# ---- globals (initialized after config load) ----
index = None
top_k = 8


def create_app(config_path: str) -> Flask:
    """Create and configure the Flask application."""
    global index, top_k

    # Resolve config path
    if not os.path.isabs(config_path):
        config_path = os.path.normpath(os.path.join(os.getcwd(), config_path))
    config = load_config(config_path)
    project_root = os.path.dirname(config_path)

    storage_dir = resolve_path(project_root, config["storage_dir"])
    embedding_model_name = config["embedding"]["model_name"]
    top_k = config["retrieval"]["top_k"]

    # ---- load index once ----
    index_file = os.path.join(storage_dir, "docstore.json")
    if not os.path.exists(index_file):
        print(f"[ERROR] No index found at {storage_dir}")
        print("        Run: python src/build_index.py --config config.yaml")
        sys.exit(1)

    print(f"[INFO] Loading embedding model: {embedding_model_name}")
    embed_model = HuggingFaceEmbedding(model_name=embedding_model_name)
    Settings.embed_model = embed_model

    print(f"[INFO] Loading index from: {storage_dir}")
    storage_context = StorageContext.from_defaults(persist_dir=storage_dir)
    index = load_index_from_storage(storage_context)
    print(f"[INFO] Index loaded. Ready for queries (top_k={top_k}).")

    # ---- Flask app ----
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    app = Flask(__name__, static_folder=static_dir, static_url_path="")

    @app.route("/")
    def index_page():
        return send_from_directory(static_dir, "index.html")

    @app.route("/api/query")
    def api_query():
        q = request.args.get("q", "").strip()
        if not q:
            return jsonify({"error": "Missing query parameter ?q=..."}), 400

        start = time.time()
        try:
            retriever = index.as_retriever(similarity_top_k=top_k)
            nodes = retriever.retrieve(q)
        except Exception as e:
            return jsonify({"error": f"Retrieval failed: {str(e)}"}), 500

        elapsed = round(time.time() - start, 3)

        results = []
        for rank, node in enumerate(nodes, start=1):
            metadata = node.metadata or {}
            content_type = metadata.get("content_type", "page_text")
            source_file = metadata.get("file_name", "unknown")
            page_number = str(metadata.get("page_number", ""))
            table_id = metadata.get("table_id", "")
            table_type = metadata.get("table_type", "")
            results.append({
                "rank": rank,
                "score": round(float(node.score or 0), 6),
                "content_type": content_type,
                "source_file": source_file,
                "page_number": page_number,
                "table_id": table_id,
                "table_type": table_type,
                "text": node.text.strip(),
            })

        return jsonify({
            "query": q,
            "elapsed_sec": elapsed,
            "total_results": len(results),
            "results": results,
        })

    return app


def main():
    parser = argparse.ArgumentParser(description="Start the zoning search engine web server.")
    parser.add_argument("--config", type=str, default="config.yaml",
                        help="Path to the YAML configuration file.")
    parser.add_argument("--port", type=int, default=5050,
                        help="Port to listen on (default: 5050).")
    parser.add_argument("--host", type=str, default="127.0.0.1",
                        help="Host to bind to (default: 127.0.0.1).")
    args = parser.parse_args()

    app = create_app(args.config)
    print(f"\n{'='*60}")
    print(f"  Zoning Policy Search Engine")
    print(f"  Open: http://{args.host}:{args.port}")
    print(f"{'='*60}\n")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
