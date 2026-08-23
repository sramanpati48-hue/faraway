"""Deprecated: Pinecone ingestion removed. Use scripts/ingest_legal_documents.py + Postgres."""
print(
    "store_offences.py used Pinecone and is retired.\n"
    "Ingest offences via scripts/ingest_legal_documents.py into Postgres legal_documents."
)
raise SystemExit(1)
