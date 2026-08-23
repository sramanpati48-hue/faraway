"""Deprecated: Pinecone has been removed. Vectors now live in Postgres pgvector."""
print(
    "Pinecone setup is no longer used.\n"
    "Embeddings use the Nyaysahayak API (https://130-211-122-175.sslip.io)\n"
    "and are stored in Postgres embedding columns.\n"
    "Run: python scripts/migrate_postgres.py\n"
    "Then: POST /api/admin/embeddings/regenerate or scripts/sync_lawyers_vectors.py"
)
raise SystemExit(1)
