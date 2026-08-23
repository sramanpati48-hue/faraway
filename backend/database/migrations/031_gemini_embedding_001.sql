-- Switch query/document embeddings to Google gemini-embedding-001 (Vertex).
-- output_dimensionality 768 matches existing pgvector(768) columns (Matryoshka).
-- After apply: deploy backend that honors provider, then Admin → Regenerate embeddings.

INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'ai_embeddings',
  '{
    "provider": "vertex",
    "model": "gemini-embedding-001",
    "output_dimensionality": 768,
    "external_embedding_url": "https://130-211-122-175.sslip.io"
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value = public.system_config.value || jsonb_build_object(
        'provider', 'vertex',
        'model', 'gemini-embedding-001',
        'output_dimensionality', 768
      ),
      updated_at = now();
