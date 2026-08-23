-- Clash Mode practice case library (seed via scripts/seed_clash_mock_cases.py)

CREATE TABLE IF NOT EXISTS public.clash_mock_cases (
  id text PRIMARY KEY,
  title text NOT NULL,
  summary text NOT NULL,
  facts text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at_clash_mock_cases()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clash_mock_cases_updated_at ON public.clash_mock_cases;
CREATE TRIGGER trg_clash_mock_cases_updated_at
BEFORE UPDATE ON public.clash_mock_cases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_clash_mock_cases();

CREATE INDEX IF NOT EXISTS idx_clash_mock_cases_active ON public.clash_mock_cases (active);
