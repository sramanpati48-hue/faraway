-- Dynamic LangGraph registry, runs, and node traces

CREATE TABLE IF NOT EXISTS public.langgraph_graph_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id text NOT NULL,
  version text NOT NULL,
  display_name text NOT NULL,
  module_path text NOT NULL,
  graph_attr text NOT NULL,
  entry_node text,
  topology jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (graph_id, version)
);

CREATE TABLE IF NOT EXISTS public.langgraph_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id text NOT NULL,
  graph_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  query text,
  initial_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_state jsonb,
  topology_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  path jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_langgraph_runs_graph_created
  ON public.langgraph_runs (graph_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_langgraph_runs_status ON public.langgraph_runs (status);

CREATE TABLE IF NOT EXISTS public.langgraph_node_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.langgraph_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('start', 'end', 'error', 'transition')),
  status text,
  input_payload jsonb,
  output_payload jsonb,
  error text,
  duration_ms double precision,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence_no int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_langgraph_node_events_run
  ON public.langgraph_node_events (run_id, sequence_no);

CREATE TABLE IF NOT EXISTS public.langgraph_transitions (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.langgraph_runs(id) ON DELETE CASCADE,
  source_node text,
  target_node text,
  conditional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.langgraph_query_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id text NOT NULL,
  name text NOT NULL,
  query text NOT NULL,
  initial_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_table text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
