-- Improvise Policies Studio: semantic context catalog + versioned policy documents.

CREATE TABLE IF NOT EXISTS public.policy_context_embeddings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL,
  ref_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(768) NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_context_kind
  ON public.policy_context_embeddings (kind);
CREATE INDEX IF NOT EXISTS idx_policy_context_embedding
  ON public.policy_context_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_policy_context(
  query_embedding vector(768),
  match_count int DEFAULT 8,
  filter_kind text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  kind text,
  ref_id text,
  title text,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.kind,
    p.ref_id,
    p.title,
    p.content,
    p.metadata,
    (1 - (p.embedding <=> query_embedding))::float AS similarity
  FROM public.policy_context_embeddings p
  WHERE p.embedding IS NOT NULL
    AND (filter_kind IS NULL OR p.kind = filter_kind)
  ORDER BY p.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;

CREATE TABLE IF NOT EXISTS public.policy_documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  policy_text text NOT NULL DEFAULT '',
  change_set jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk text NOT NULL DEFAULT 'low',
  status text NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_documents_status
  ON public.policy_documents (status);
CREATE INDEX IF NOT EXISTS idx_policy_documents_created_at
  ON public.policy_documents (created_at DESC);
