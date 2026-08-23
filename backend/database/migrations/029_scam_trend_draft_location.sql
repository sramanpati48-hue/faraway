-- Scam trend drafts: keep the model's own reading of where a scam happened,
-- plus the article it came from, so admins can audit the location before promote.

ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS state text NULL;
ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS location_source text NULL;
ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS location_basis text NULL;
ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS source_url text NULL;
