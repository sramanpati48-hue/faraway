-- Scam trend drafts: stage scrape results for admin approve → promote into mock_scams.

ALTER TABLE public.scam_trend_runs
  ADD COLUMN IF NOT EXISTS extracted_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.scam_trend_runs
  ADD COLUMN IF NOT EXISTS approved_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.scam_trend_runs
  ADD COLUMN IF NOT EXISTS promoted_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.scam_trend_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.scam_trend_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  description text,
  scam_type text,
  risk_level text,
  city text,
  lat double precision,
  lon double precision,
  embedding vector(768),
  similar_to_existing boolean NOT NULL DEFAULT false,
  similarity_score double precision NULL,
  promoted_mock_scam_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_trend_drafts_run
  ON public.scam_trend_drafts (run_id, seq);
CREATE INDEX IF NOT EXISTS idx_scam_trend_drafts_status
  ON public.scam_trend_drafts (run_id, status);
