"""
build_index.py — Build a VectorStoreIndex from policy documents.

Usage:
    python src/build_index.py --config config.yaml

Loading priority:
    1. If outputs/clean_text/clean_text_index.csv exists, load from it
       (each row = one Document, with metadata from CSV columns).
    2. Otherwise, fall back to reading raw PDF / TXT / DOCX from
       data/raw_documents/, extracting both text and tables.
"""

import argparse
import csv
import json
import os
import sys

from llama_index.core import Document, VectorStoreIndex, Settings
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import load_config, resolve_path
from src.table_extractor import extract_tables_from_pdf


# ---------------------------------------------------------------------------
#  cleaner path — load from clean_text_index.csv
# ---------------------------------------------------------------------------

def _load_from_clean_csv(csv_path: str) -> list[Document]:
    """Load documents from a pre-built clean_text_index.csv.

    Each row becomes one LlamaIndex Document.  For page_text rows we prefix
    the document text with a [PAGE_TEXT] header block; for table_text rows we
    prefix with [TABLE_TEXT] and include table_id + table_type.  This makes
    the content type visible to the embedding model and improves retrieval
    relevance.
    """
    docs: list[Document] = []
    total_rows = 0
    skipped_boundary = 0
    n_skipped_empty = 0
    n_page_text = 0
    n_table_text = 0

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1

            content_type = row.get("content_type", "page_text")
            source_file = row.get("source_file", "unknown")
            page_number = row.get("page_number", "")
            table_id = row.get("table_id", "")
            table_type = row.get("table_type", "")
            text = row.get("text", "").strip()

            # Skip page_boundary rows
            if content_type == "page_boundary":
                skipped_boundary += 1
                continue

            if not text:
                n_skipped_empty += 1
                continue

            pn = int(page_number) if page_number and page_number.isdigit() else ""

            # --- Build metadata-rich document text ---
            if content_type == "table_text":
                full_text = (
                    f"[TABLE_TEXT]\n"
                    f"Source file: {source_file}\n"
                    f"Page: {pn}\n"
                    f"Table ID: {table_id}\n"
                    f"Table Type: {table_type}\n"
                    f"\n"
                    f"{text}"
                )
                n_table_text += 1
            else:  # page_text (and any unexpected value)
                full_text = (
                    f"[PAGE_TEXT]\n"
                    f"Source file: {source_file}\n"
                    f"Page: {pn}\n"
                    f"\n"
                    f"{text}"
                )
                n_page_text += 1

            docs.append(Document(
                text=full_text,
                metadata={
                    "file_name": source_file,
                    "file_path": os.path.join(
                        os.path.dirname(csv_path), "..", "..",
                        "data", "raw_documents", source_file,
                    ),
                    "page_number": pn,
                    "content_type": content_type,
                    "table_id": table_id,
                    "table_type": table_type,
                },
            ))

    # ---- detailed stats ----
    print(f"\n  Using clean text index: {csv_path}")
    print(f"  Loaded rows:               {total_rows}")
    print(f"  Skipped page_boundary rows: {skipped_boundary}")
    print(f"  Skipped empty rows:         {n_skipped_empty}")
    print(f"  Page text documents:        {n_page_text}")
    print(f"  Table text documents:       {n_table_text}")
    print(f"  Total documents indexed:    {len(docs)}")

    return docs


# ---------------------------------------------------------------------------
#  legacy path — raw PDF / TXT / DOCX
# ---------------------------------------------------------------------------

def _load_pdf_text_pages(filepath: str) -> list:
    """Load a PDF page-by-page (text only, no tables)."""
    from pypdf import PdfReader
    docs = []
    fname = os.path.basename(filepath)
    reader = PdfReader(filepath)
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text()
        if text and text.strip():
            docs.append(Document(
                text=text.strip(),
                metadata={
                    "file_name": fname,
                    "file_path": filepath,
                    "page_number": i,
                    "content_type": "text",
                },
            ))
    print(f"  [TEXT]  {fname}  →  {len(docs)} page(s)")
    return docs


def _load_docx_text(filepath: str) -> list:
    """Load a DOCX file as a single Document with full text."""
    from docx import Document as DocxDoc
    fname = os.path.basename(filepath)
    doc = DocxDoc(filepath)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    text = "\n".join(paragraphs)
    if not text.strip():
        return []
    print(f"  [DOCX] {fname}  →  1 document")
    return [Document(
        text=text,
        metadata={
            "file_name": fname, "file_path": filepath,
            "page_number": "", "content_type": "text",
        },
    )]


def _load_txt_text(filepath: str) -> list:
    """Load a TXT file as a single Document."""
    fname = os.path.basename(filepath)
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return []
    print(f"  [TXT]  {fname}  →  1 document")
    return [Document(
        text=text,
        metadata={
            "file_name": fname, "file_path": filepath,
            "page_number": "", "content_type": "text",
        },
    )]


def load_all_documents(documents_dir: str, tables_output_dir: str | None = None) -> list:
    """Load all supported files from a directory and extract tables from PDFs."""
    all_docs: list[Document] = []
    supported_exts = {".pdf", ".docx", ".txt"}

    for filename in sorted(os.listdir(documents_dir)):
        filepath = os.path.join(documents_dir, filename)
        if not os.path.isfile(filepath):
            continue
        ext = os.path.splitext(filename)[1].lower()
        if ext not in supported_exts:
            continue

        if ext == ".pdf":
            text_docs = _load_pdf_text_pages(filepath)
        elif ext == ".docx":
            text_docs = _load_docx_text(filepath)
        elif ext == ".txt":
            text_docs = _load_txt_text(filepath)
        else:
            continue

        all_docs.extend(text_docs)

        if ext == ".pdf":
            table_records = extract_tables_from_pdf(filepath, output_dir=tables_output_dir)
            fname = os.path.basename(filepath)
            for rec in table_records:
                all_docs.append(Document(
                    text=rec["table_text"],
                    metadata={
                        "file_name": fname,
                        "file_path": filepath,
                        "page_number": rec["page_number"],
                        "content_type": "table",
                        "table_id": rec["table_id"],
                    },
                ))

    return all_docs


# ---------------------------------------------------------------------------
#  main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build a zoning-policy VectorStoreIndex.")
    parser.add_argument(
        "--config", type=str, default="config.yaml",
        help="Path to the YAML configuration file."
    )
    parser.add_argument(
        "--reload", action="store_true",
        help="Force re-creation of the index even if storage/ already exists."
    )
    parser.add_argument(
        "--raw", action="store_true",
        help="Force using raw PDF/DOCX/TXT path, ignoring clean_text_index.csv."
    )
    args = parser.parse_args()

    # ---- load config ----
    config_path = args.config
    if not os.path.isabs(config_path):
        config_path = os.path.join(os.getcwd(), config_path)

    config = load_config(config_path)
    project_root = os.path.dirname(config_path)

    documents_dir = resolve_path(project_root, config["documents_dir"])
    storage_dir = resolve_path(project_root, config["storage_dir"])
    embedding_model_name = config["embedding"]["model_name"]
    tables_dir = resolve_path(project_root, config.get("outputs", {}).get("tables_dir", "./outputs/tables"))

    # ---- check input documents ----
    if not os.path.isdir(documents_dir):
        print(f"[ERROR] Documents directory not found: {documents_dir}")
        sys.exit(1)

    # ---- skip if index already exists (unless --reload) ----
    index_file = os.path.join(storage_dir, "docstore.json")
    if os.path.exists(index_file) and not args.reload:
        print(f"[SKIP] Index already exists at {storage_dir}")
        print("       Use --reload to force rebuild.")
        return

    # ---- decide which source to use ----
    clean_csv = os.path.join(project_root, "outputs", "clean_text", "clean_text_index.csv")

    if not args.raw and os.path.isfile(clean_csv):
        # Preferred path: clean text CSV
        print(f"[INFO] Using pre-processed clean text: {clean_csv}")
        documents = _load_from_clean_csv(clean_csv)
    else:
        # Fallback: raw documents
        if args.raw:
            print(f"[INFO] --raw flag set: loading from raw documents: {documents_dir}")
        else:
            print(f"[INFO] Clean text index not found. Loading from raw documents: {documents_dir}")
        documents = load_all_documents(documents_dir, tables_output_dir=tables_dir)

    if not documents:
        print("[ERROR] No documents found.")
        sys.exit(1)

    n_page = sum(1 for d in documents if d.metadata.get("content_type") in ("text", "page_text"))
    n_table = sum(1 for d in documents if d.metadata.get("content_type") in ("table", "table_text"))
    print(f"\n  Total documents indexed: {len(documents)}  "
          f"(page_text={n_page}, table_text={n_table})")

    # ---- configure embedding model ----
    print(f"[INFO] Using embedding model: {embedding_model_name}")
    embed_model = HuggingFaceEmbedding(model_name=embedding_model_name)
    Settings.embed_model = embed_model

    # ---- build index ----
    print("[INFO] Building VectorStoreIndex ...")
    index = VectorStoreIndex.from_documents(documents, show_progress=True)

    # ---- persist index ----
    os.makedirs(storage_dir, exist_ok=True)
    index.storage_context.persist(persist_dir=storage_dir)

    print(f"[DONE] Index saved to: {storage_dir}")


if __name__ == "__main__":
    main()
