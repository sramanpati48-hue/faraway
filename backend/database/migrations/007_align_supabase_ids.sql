-- Align ID types with production Supabase (UUID text ids)

ALTER TABLE public.mock_scams
  ALTER COLUMN id DROP DEFAULT;

ALTER TABLE public.mock_scams
  ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.nodal_guides
  ALTER COLUMN id DROP DEFAULT;

ALTER TABLE public.nodal_guides
  ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.routing_rules
  ALTER COLUMN id DROP DEFAULT;

ALTER TABLE public.routing_rules
  ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.routing_rules
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
