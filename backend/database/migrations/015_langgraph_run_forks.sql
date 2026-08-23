-- Preserve immutable run snapshots while allowing checkpoint time-travel forks.

ALTER TABLE public.langgraph_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.langgraph_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fork_node_id text,
  ADD COLUMN IF NOT EXISTS checkpoint_config jsonb;

CREATE INDEX IF NOT EXISTS idx_langgraph_runs_parent
  ON public.langgraph_runs (parent_run_id, created_at DESC);
