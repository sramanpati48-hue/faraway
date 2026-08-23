-- LinkedIn-style lawyer profile fields + victim↔lawyer textual chat

ALTER TABLE public.lawyers
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS about text,
  ADD COLUMN IF NOT EXISTS practice_areas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS courts_practiced text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS availability_hours text,
  ADD COLUMN IF NOT EXISTS consultation_modes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS cover_image text,
  ADD COLUMN IF NOT EXISTS profile_extras jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill practice_areas from specialization when empty
UPDATE public.lawyers
SET practice_areas = ARRAY[specialization]
WHERE specialization IS NOT NULL
  AND btrim(specialization) <> ''
  AND (practice_areas IS NULL OR cardinality(practice_areas) = 0);

UPDATE public.lawyers
SET about = bio
WHERE (about IS NULL OR btrim(about) = '')
  AND bio IS NOT NULL
  AND btrim(bio) <> '';

CREATE INDEX IF NOT EXISTS idx_lawyers_practice_areas ON public.lawyers USING GIN (practice_areas);

CREATE TABLE IF NOT EXISTS public.lawyer_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  victim_user_id text NOT NULL,
  lawyer_user_id text NOT NULL,
  lawyer_case_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lawyer_threads_pair UNIQUE (victim_user_id, lawyer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_lawyer_threads_victim ON public.lawyer_threads (victim_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lawyer_threads_lawyer ON public.lawyer_threads (lawyer_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lawyer_threads_case ON public.lawyer_threads (lawyer_case_id)
  WHERE lawyer_case_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_lawyer_threads_updated_at ON public.lawyer_threads;
CREATE TRIGGER trg_lawyer_threads_updated_at
BEFORE UPDATE ON public.lawyer_threads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.lawyer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.lawyer_threads(id) ON DELETE CASCADE,
  sender_user_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lawyer_messages_thread
  ON public.lawyer_messages (thread_id, created_at ASC);
