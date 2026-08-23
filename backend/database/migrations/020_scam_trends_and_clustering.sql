-- Scam trends scraper runs, case clustering embeddings, classifier runs,
-- and PDF URL columns for lawyer/sahayak forward paths.

-- ── Scam trend scrape runs (admin RAG funnel "Scam Trends" tab) ─────────────
CREATE TABLE IF NOT EXISTS public.scam_trend_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL,
  target_date date NOT NULL DEFAULT CURRENT_DATE,
  areas jsonb NOT NULL DEFAULT '["India"]'::jsonb,
  requested_count integer NOT NULL DEFAULT 10,
  stored_count integer NOT NULL DEFAULT 0,
  searched_count integer NOT NULL DEFAULT 0,
  provider text NULL,
  model text NULL,
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  message text NULL,
  error text NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scam_trend_runs_created_at
  ON public.scam_trend_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_trend_runs_status
  ON public.scam_trend_runs (status);

-- ── Case embedding + clustering columns ────────────────────────────────────
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS scam_cluster_id text;
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS clustered_at timestamptz;

DROP INDEX IF EXISTS public.idx_cases_embedding;
CREATE INDEX IF NOT EXISTS idx_cases_embedding
  ON public.cases USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_cases(
  query_embedding vector(768),
  match_count int DEFAULT 10,
  exclude_id text DEFAULT NULL,
  similarity_threshold float DEFAULT 0.0
)
RETURNS TABLE (
  case_row jsonb,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_jsonb(c) - 'embedding' AS case_row,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.cases c
  WHERE c.embedding IS NOT NULL
    AND (exclude_id IS NULL OR c.id <> exclude_id)
    AND (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;

-- ── Scam case classifier runs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scam_classifier_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL,
  trigger_source text NOT NULL DEFAULT 'schedule',
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  cases_scanned integer NOT NULL DEFAULT 0,
  clusters_found integer NOT NULL DEFAULT 0,
  clusters_registered integer NOT NULL DEFAULT 0,
  message text NULL,
  error text NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scam_classifier_runs_created_at
  ON public.scam_classifier_runs (created_at DESC);

-- ── PDF URL on forward tables ──────────────────────────────────────────────
ALTER TABLE public.lawyer_cases
  ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE public.lawyer_cases
  ADD COLUMN IF NOT EXISTS user_name text;

ALTER TABLE public.sahayak_cases
  ADD COLUMN IF NOT EXISTS pdf_url text;

-- ── system_config seed for classifier ──────────────────────────────────────
INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'scam_classifier',
  '{
    "enabled": true,
    "interval_hours": 12,
    "similarity_threshold": 0.82,
    "min_same_case_count": 5,
    "lookback_days": 30,
    "last_run_at": null
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Default model binding for scam_classifier.classifier (selfhost Qwen)
UPDATE public.system_config
SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
  'scam_classifier',
  COALESCE(value->'scam_classifier', '{}'::jsonb) || jsonb_build_object(
    'classifier',
    jsonb_build_object(
      'provider', 'selfhost',
      'model', 'Qwen2.5-3B-Instruct'
    )
  )
),
updated_at = now()
WHERE key = 'graph_node_models';
