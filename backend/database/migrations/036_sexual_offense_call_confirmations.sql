-- Sexual-offence confirmation calls (moderator-only) + Nyay Guide canvas kind.

ALTER TABLE public.sahayak_cases
  ADD COLUMN IF NOT EXISTS guide_kind text NOT NULL DEFAULT 'nyayguide';

CREATE INDEX IF NOT EXISTS idx_sahayak_cases_guide_kind
  ON public.sahayak_cases (guide_kind, assigned_sahayak_id, status);

CREATE TABLE IF NOT EXISTS public.sexual_offense_call_confirmations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  case_id text,
  session_id text,
  user_id text,
  victim_name text,
  victim_phone text,
  structured_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_summary text,
  status text NOT NULL DEFAULT 'pending_call'
    CHECK (status IN ('pending_call', 'call_done', 'call_not_done', 'assigned')),
  assigned_nyayguide_id text,
  assigned_nyayguide_name text,
  sahayak_case_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  call_confirmed_at timestamptz,
  confirmed_by text
);

CREATE INDEX IF NOT EXISTS idx_so_call_status
  ON public.sexual_offense_call_confirmations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_so_call_session
  ON public.sexual_offense_call_confirmations (session_id);

DROP TRIGGER IF EXISTS trg_so_call_confirmations_updated_at ON public.sexual_offense_call_confirmations;
CREATE TRIGGER trg_so_call_confirmations_updated_at
BEFORE UPDATE ON public.sexual_offense_call_confirmations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
