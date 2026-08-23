-- Local justice metadata on nodal guides + ₹49 NyaySahayak on-ground bookings.

ALTER TABLE public.nodal_guides
  ADD COLUMN IF NOT EXISTS institution_type text;
ALTER TABLE public.nodal_guides
  ADD COLUMN IF NOT EXISTS institution_name text;
ALTER TABLE public.nodal_guides
  ADD COLUMN IF NOT EXISTS regional_name text;
ALTER TABLE public.nodal_guides
  ADD COLUMN IF NOT EXISTS city text;

CREATE INDEX IF NOT EXISTS idx_nodal_guides_state
  ON public.nodal_guides (lower(btrim(state)));

CREATE TABLE IF NOT EXISTS public.nyaysahayak_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  session_id text,
  case_id text,
  sahayak_uid text,
  sahayak_name text,
  area text,
  amount_paise int NOT NULL DEFAULT 4900,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  razorpay_order_id text,
  razorpay_payment_id text,
  thread_id text,
  sahayak_case_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nyaysahayak_bookings_user
  ON public.nyaysahayak_bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nyaysahayak_bookings_order
  ON public.nyaysahayak_bookings (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nyaysahayak_bookings_session
  ON public.nyaysahayak_bookings (session_id)
  WHERE session_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_nyaysahayak_bookings_updated_at ON public.nyaysahayak_bookings;
CREATE TRIGGER trg_nyaysahayak_bookings_updated_at
BEFORE UPDATE ON public.nyaysahayak_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
