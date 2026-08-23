-- Migration: 041_case_ai_verification.sql
-- Description: Add AI verification fields to public.cases for per-case verification gating of ₹49 NyaySahayak booking.

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS ai_verification_status text DEFAULT 'pending';
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS ai_verification_confidence float;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS verification_source text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS verification_updated_at timestamptz;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS ai_verification_reason text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS ai_verification_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Index for querying cases by ai_verification_status
CREATE INDEX IF NOT EXISTS idx_cases_ai_verification_status ON public.cases (ai_verification_status);
CREATE INDEX IF NOT EXISTS idx_cases_verification_updated_at ON public.cases (verification_updated_at);
