-- One row per moderator review session: structured agent vs moderator comparison.

CREATE TABLE IF NOT EXISTS public.moderator_updatation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id text NOT NULL,
  case_id text,
  session_id text,
  langgraph_run_id text,
  moderator_id text,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  review_started_at timestamptz NOT NULL DEFAULT now(),
  review_completed_at timestamptz,

  agent_summary text,
  agent_chat_response text,
  agent_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_suggested_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_pdf_url text,

  moderator_summary text,
  moderator_chat_response text,
  moderator_report jsonb,
  moderator_suggested_actions jsonb,
  moderator_suggested_links jsonb,
  moderator_flags jsonb,
  moderator_pdf_url text,
  moderator_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderator_updatation_intervention
  ON public.moderator_updatation (intervention_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderator_updatation_session
  ON public.moderator_updatation (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_moderator_updatation_status
  ON public.moderator_updatation (status, review_started_at DESC);

DROP TRIGGER IF EXISTS trg_moderator_updatation_updated_at ON public.moderator_updatation;
CREATE TRIGGER trg_moderator_updatation_updated_at
BEFORE UPDATE ON public.moderator_updatation
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.moderator_updatation ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE ON public.moderator_updatation TO authenticated;
    EXECUTE $p$
      CREATE POLICY moderator_updatation_authenticated_all
        ON public.moderator_updatation
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
