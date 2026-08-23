-- RAG funnel: PDF -> LLM chunking -> staging review -> promote into legal_documents.

CREATE TABLE IF NOT EXISTS public.rag_ingest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL,
  document_name text NOT NULL,
  act_name text NULL,
  source_filename text NULL,
  source_pdf_url text NULL,
  source_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  total_pages integer NOT NULL DEFAULT 0,
  processed_pages integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 0,
  promoted_count integer NOT NULL DEFAULT 0,
  quality jsonb NULL,
  error text NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_ingest_sessions_created_at
  ON public.rag_ingest_sessions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.rag_ingest_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.rag_ingest_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  page_start integer NULL,
  page_end integer NULL,
  status text NOT NULL DEFAULT 'draft',
  document_name text NULL,
  act_name text NULL,
  category text NULL,
  year_introduced integer NULL,
  year_amendment integer NULL,
  section_number text NULL,
  subsection_text text NULL,
  title text NULL,
  content text NULL,
  summary text NULL,
  authority text NULL,
  jurisdiction text NULL DEFAULT 'India',
  legal_status text NULL,
  related_acts text[] NULL,
  keywords text[] NULL,
  severity_level text NULL,
  applicable_sections text[] NULL,
  punishments text NULL,
  source_url text NULL,
  source_type text NULL,
  pdf_page_reference text NULL,
  version text NULL DEFAULT '1.0',
  language text NULL DEFAULT 'en',
  embedding vector(768) NULL,
  quality jsonb NULL,
  promoted_document_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_ingest_chunks_session
  ON public.rag_ingest_chunks (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_rag_ingest_chunks_status
  ON public.rag_ingest_chunks (session_id, status);

-- Seed default RAG funnel config (per-run request overrides these).
INSERT INTO public.system_config (key, value) VALUES
(
  'rag_funnel',
  '{
    "provider": "openrouter",
    "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "pages_per_batch": 2,
    "chunk_target_length": 1200,
    "quality_sample_count": 5
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
