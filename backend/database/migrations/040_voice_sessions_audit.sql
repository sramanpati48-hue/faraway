-- 040_voice_sessions_audit.sql
-- Durable Voice Sessions persistence with full transcript, confidence score history, and agent decision log.

CREATE TABLE IF NOT EXISTS public.voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  user_id text,
  session_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  full_transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_status text NOT NULL DEFAULT 'in_progress'
    CHECK (resolution_status IN ('in_progress', 'verified', 'escalate', 'completed')),
  escalation_reason text,
  agent_decision_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  threat_level text,
  escalated boolean NOT NULL DEFAULT false,
  confidence_score float,
  conversation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_packet jsonb NOT NULL DEFAULT '{}'::jsonb,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure all columns exist for existing tables
ALTER TABLE public.voice_sessions
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS full_transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_score_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS escalation_reason text,
  ADD COLUMN IF NOT EXISTS agent_decision_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS threat_level text,
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_score float,
  ADD COLUMN IF NOT EXISTS conversation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS handoff_packet jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS transcript jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Indexes for efficient case-scoped and audit queries
CREATE INDEX IF NOT EXISTS idx_voice_sessions_case_id
  ON public.voice_sessions (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id
  ON public.voice_sessions (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_status
  ON public.voice_sessions (resolution_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_started_at
  ON public.voice_sessions (started_at DESC);

-- Automatic updated_at trigger
DROP TRIGGER IF EXISTS trg_voice_sessions_updated_at ON public.voice_sessions;
CREATE TRIGGER trg_voice_sessions_updated_at
BEFORE UPDATE ON public.voice_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.voice_sessions IS 'Durable voice moderator sessions with full transcript, confidence score history, and agent decision audit log';
