-- Allow runs that pause for user answers (question_processor, clash turns, etc.)
ALTER TABLE public.langgraph_runs
  DROP CONSTRAINT IF EXISTS langgraph_runs_status_check;

ALTER TABLE public.langgraph_runs
  ADD CONSTRAINT langgraph_runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'awaiting_input'));
