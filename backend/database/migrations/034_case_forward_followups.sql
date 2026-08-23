-- Queue forwarding metadata on the user case, plus follow-up statements
-- appended after a case is sent to moderator / lawyer / Nyay Guide / nodal guide.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS forwarded_role text;
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS forwarded_target_id text;
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS queue_status text;

CREATE INDEX IF NOT EXISTS idx_cases_session_forward
  ON public.cases (session_id, timestamp DESC)
  WHERE forwarded_role IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  user_id text,
  case_id text,
  target_role text NOT NULL
    CHECK (target_role IN ('moderator', 'lawyer', 'sahayak', 'nodal_guide')),
  target_id text,
  statement text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_followups_session
  ON public.case_followups (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_followups_target
  ON public.case_followups (target_role, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_followups_case
  ON public.case_followups (case_id, created_at ASC)
  WHERE case_id IS NOT NULL;

ALTER TABLE public.case_followups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE ON public.case_followups TO authenticated;
    EXECUTE $p$
      CREATE POLICY case_followups_authenticated_all
        ON public.case_followups
        FOR ALL
        TO authenticated
        USING (true)
        WITH CHECK (true)
    $p$;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
