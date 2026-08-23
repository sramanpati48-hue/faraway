-- Moderator exclusive queue, SLA/delay/respect, agent vs moderator payload audit

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS assigned_moderator_id text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS delay_score int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_interventions_assigned_moderator
  ON public.interventions (assigned_moderator_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_interventions_sla_pending
  ON public.interventions (status, assigned_at)
  WHERE status = 'pending' AND assigned_moderator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.moderator_performance (
  moderator_id text PRIMARY KEY,
  respect_score numeric NOT NULL DEFAULT 100,
  delay_score_total int NOT NULL DEFAULT 0,
  cases_resolved int NOT NULL DEFAULT 0,
  cases_breached int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderator_case_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id text NOT NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  case_id text,
  agent_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_report jsonb,
  moderator_payload jsonb,
  moderator_id text,
  status text NOT NULL DEFAULT 'agent_created'
    CHECK (status IN ('agent_created', 'moderator_updated', 'resolved')),
  search_text text,
  embedding vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderator_revisions_intervention
  ON public.moderator_case_revisions (intervention_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderator_revisions_case
  ON public.moderator_case_revisions (case_id)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_moderator_revisions_status
  ON public.moderator_case_revisions (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderator_revisions_search
  ON public.moderator_case_revisions USING gin (to_tsvector('english', coalesce(search_text, '')));

CREATE INDEX IF NOT EXISTS idx_moderator_revisions_embedding
  ON public.moderator_case_revisions
  USING hnsw (embedding vector_cosine_ops);

DROP TRIGGER IF EXISTS trg_moderator_case_revisions_updated_at ON public.moderator_case_revisions;
CREATE TRIGGER trg_moderator_case_revisions_updated_at
BEFORE UPDATE ON public.moderator_case_revisions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'moderator_queue',
  '{
    "cases_per_hour": 5,
    "sla_minutes": 60,
    "delay_tick_minutes": 5,
    "respect_penalty_per_tick": 1
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
