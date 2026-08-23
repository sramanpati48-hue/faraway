-- Scam trend drafts: record the reported date and the evidence quote the model
-- used, so admins can verify a staged trend is a real, recent incident.

ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS reported_on date NULL;
ALTER TABLE public.scam_trend_drafts
  ADD COLUMN IF NOT EXISTS evidence text NULL;
