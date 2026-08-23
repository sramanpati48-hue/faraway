-- AI model config, usage analytics, and unified 768-d pgvector columns

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id bigserial PRIMARY KEY,
  task text NOT NULL,
  model text NOT NULL,
  provider text NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON public.ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_task ON public.ai_usage_logs (task);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model ON public.ai_usage_logs (model);

-- Align mock_scams embeddings with Nyaysahayak API (768-d).
-- Clear prior 760-d vectors; regenerate via admin embeddings endpoint.
DROP INDEX IF EXISTS public.idx_mock_scams_embedding;
ALTER TABLE public.mock_scams DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.mock_scams ADD COLUMN embedding vector(768);
CREATE INDEX IF NOT EXISTS idx_mock_scams_embedding
  ON public.mock_scams USING hnsw (embedding vector_cosine_ops);

-- Lawyer semantic search via pgvector
ALTER TABLE public.lawyers
  ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS idx_lawyers_embedding
  ON public.lawyers USING hnsw (embedding vector_cosine_ops);

-- City scam reports previously stored in Pinecone namespace "scams"
CREATE TABLE IF NOT EXISTS public.scam_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  description text NOT NULL,
  city text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(768) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scam_reports_city ON public.scam_reports (city);
CREATE INDEX IF NOT EXISTS idx_scam_reports_created_at ON public.scam_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_reports_embedding
  ON public.scam_reports USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_lawyers(
  query_embedding vector(768),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  lawyer_id text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.id AS lawyer_id,
    (1 - (l.embedding <=> query_embedding))::float AS similarity
  FROM public.lawyers l
  WHERE l.embedding IS NOT NULL
  ORDER BY l.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;

CREATE OR REPLACE FUNCTION public.match_scam_reports(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  filter_city text DEFAULT NULL
)
RETURNS TABLE (
  report_row jsonb,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_jsonb(sr) AS report_row,
    (1 - (sr.embedding <=> query_embedding))::float AS similarity
  FROM public.scam_reports sr
  WHERE sr.embedding IS NOT NULL
    AND (filter_city IS NULL OR lower(sr.city) = lower(filter_city))
  ORDER BY sr.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;

-- Seed default model / embedding config
INSERT INTO public.system_config (key, value) VALUES
(
  'graph_node_models',
  '{
    "chat_agent": {
      "supervisor": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "cyber": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "civil": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "domestic": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "scam": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "document": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "sahayak": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "legal_moderator": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "lawyer_forwarder": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "question_processor": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "report_generator": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "nodal_guide": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "sexual_offense": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"}
    },
    "clash_agent": {
      "preprocess": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "prosecution": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "defence": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "defence_cross_answer": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "judge_round": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "final_judge": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
      "incorporate_answer": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"}
    }
  }'::jsonb
),
(
  'ai_embeddings',
  '{
    "provider": "nyaysahayak",
    "model": "krutrim-ai-labs/Vyakyarth",
    "external_embedding_url": "https://130-211-122-175.sslip.io"
  }'::jsonb
),
(
  'sql_generation',
  '{
    "provider": "openrouter",
    "openrouter_model": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "gemini_model": "gemini-2.5-flash"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
