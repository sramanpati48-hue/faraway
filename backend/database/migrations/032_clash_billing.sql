-- Clash Mode billing: plans, subscriptions, usage ledger, webhook idempotency

CREATE TABLE IF NOT EXISTS public.clash_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_paise int NOT NULL DEFAULT 0,
  monthly_session_limit int NULL,
  razorpay_plan_id text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clash_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.clash_plans(id),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'active', 'cancelled', 'past_due', 'expired')),
  razorpay_subscription_id text UNIQUE,
  razorpay_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clash_subscriptions_user
  ON public.clash_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_clash_subscriptions_status
  ON public.clash_subscriptions (user_id, status);

-- At most one active/past_due subscription per user (created checkouts may coexist briefly)
CREATE UNIQUE INDEX IF NOT EXISTS uq_clash_subscriptions_user_active
  ON public.clash_subscriptions (user_id)
  WHERE status IN ('active', 'past_due');

DROP TRIGGER IF EXISTS trg_clash_subscriptions_updated_at ON public.clash_subscriptions;
CREATE TRIGGER trg_clash_subscriptions_updated_at
BEFORE UPDATE ON public.clash_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.clash_session_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  mode text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clash_session_runs_user_created
  ON public.clash_session_runs (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clash_session_runs_session
  ON public.clash_session_runs (session_id);

CREATE TABLE IF NOT EXISTS public.clash_billing_events (
  id bigserial PRIMARY KEY,
  razorpay_event_id text NOT NULL UNIQUE,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.clash_plans (id, name, price_paise, monthly_session_limit, razorpay_plan_id, sort_order)
VALUES
  ('free', 'Free', 0, 2, NULL, 1),
  ('basic', 'Basic', 4900, 50, NULL, 2),
  ('fearless', 'Fearless', 59900, NULL, NULL, 3)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_paise = EXCLUDED.price_paise,
  monthly_session_limit = EXCLUDED.monthly_session_limit,
  sort_order = EXCLUDED.sort_order;
