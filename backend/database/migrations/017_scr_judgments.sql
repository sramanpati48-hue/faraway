-- SCR Supreme Court judgment fetcher: dedup ledger of downloaded case PDFs.
-- case_path is the durable unique key (e.g. 2025_5_275_330); keyword(s) track
-- which searches found it so the same PDF is never downloaded twice.

CREATE TABLE IF NOT EXISTS public.scr_downloaded_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_path text NOT NULL,
  neutral_citation text NULL,
  citation_year text NULL,
  title text NULL,
  keyword text NULL,
  keywords text[] NULL,
  language_codes text[] NULL,
  source_pdf_url text NULL,
  rag_session_id uuid NULL REFERENCES public.rag_ingest_sessions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'downloaded',
  created_by text NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scr_downloaded_cases_path
  ON public.scr_downloaded_cases (case_path);

CREATE INDEX IF NOT EXISTS idx_scr_downloaded_cases_keyword
  ON public.scr_downloaded_cases (keyword);

CREATE INDEX IF NOT EXISTS idx_scr_downloaded_cases_downloaded_at
  ON public.scr_downloaded_cases (downloaded_at DESC);
