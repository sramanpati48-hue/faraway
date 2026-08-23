-- Persist SCR keyword-fetch sessions so the admin UI can show nested PDFs under each keyword.

CREATE TABLE IF NOT EXISTS public.scr_fetch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL,
  keyword text NOT NULL,
  search_opt text NOT NULL DEFAULT 'PHRASE',
  from_date text NULL,
  to_date text NULL,
  max_results integer NOT NULL DEFAULT 100,
  language text NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'awaiting_captcha',
  found integer NOT NULL DEFAULT 0,
  downloaded integer NOT NULL DEFAULT 0,
  skipped_duplicates integer NOT NULL DEFAULT 0,
  failed_downloads integer NOT NULL DEFAULT 0,
  remaining integer NOT NULL DEFAULT 0,
  message text NULL,
  error text NULL
);

CREATE INDEX IF NOT EXISTS idx_scr_fetch_sessions_created_at
  ON public.scr_fetch_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scr_fetch_sessions_keyword
  ON public.scr_fetch_sessions (keyword);

ALTER TABLE public.scr_downloaded_cases
  ADD COLUMN IF NOT EXISTS scr_fetch_session_id uuid NULL
    REFERENCES public.scr_fetch_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scr_downloaded_cases_fetch
  ON public.scr_downloaded_cases (scr_fetch_session_id);

ALTER TABLE public.rag_ingest_sessions
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'upload';

ALTER TABLE public.rag_ingest_sessions
  ADD COLUMN IF NOT EXISTS scr_fetch_session_id uuid NULL
    REFERENCES public.scr_fetch_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rag_ingest_sessions_source_kind
  ON public.rag_ingest_sessions (source_kind);

CREATE INDEX IF NOT EXISTS idx_rag_ingest_sessions_scr_fetch
  ON public.rag_ingest_sessions (scr_fetch_session_id);
