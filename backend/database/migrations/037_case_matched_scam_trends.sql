-- Persist live mock_scams vector matches onto the stored case.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS matched_scam_trends jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cases_matched_scam_trends
  ON public.cases USING GIN (matched_scam_trends);
