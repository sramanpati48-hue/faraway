-- Push assignment + location intake support

ALTER TABLE public.sahayak_profiles
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text;

ALTER TABLE public.sahayak_cases
  ADD COLUMN IF NOT EXISTS location jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notified_user_ids text[] DEFAULT '{}';

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS notified_user_ids text[] DEFAULT '{}';

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS location jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sahayak_profiles_state_city
  ON public.sahayak_profiles (state, city);

CREATE INDEX IF NOT EXISTS idx_sahayak_cases_notified
  ON public.sahayak_cases USING GIN (notified_user_ids);

CREATE INDEX IF NOT EXISTS idx_interventions_notified
  ON public.interventions USING GIN (notified_user_ids);
