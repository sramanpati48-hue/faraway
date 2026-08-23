-- Track guides who declined a help-queue case so it leaves their pending list
-- while remaining available to other notified guides.
ALTER TABLE public.sahayak_cases
  ADD COLUMN IF NOT EXISTS declined_user_ids text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sahayak_cases_declined
  ON public.sahayak_cases USING GIN (declined_user_ids);
