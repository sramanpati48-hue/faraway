-- Directories, scam heatmap, legal RAG, clash cases

CREATE TABLE IF NOT EXISTS public.mock_scams (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  description text,
  scam_type text,
  risk_level text,
  city text,
  lat double precision,
  lon double precision,
  embedding vector(760),
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mock_scams_city_ts ON public.mock_scams (city, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mock_scams_embedding
  ON public.mock_scams USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.legal_documents (
  id bigserial PRIMARY KEY,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  document_name text NOT NULL,
  act_name text NOT NULL,
  category text NOT NULL,
  year_introduced integer NULL,
  year_amendment integer NULL,
  section_number text NULL,
  subsection_text text NULL,
  title text NOT NULL,
  content text NOT NULL,
  summary text NULL,
  authority text NOT NULL,
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
  embedding vector(768) NULL,
  language text NULL DEFAULT 'en',
  created_by text NULL,
  notes text NULL
);

DROP TRIGGER IF EXISTS trg_legal_documents_updated_at ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_updated_at
BEFORE UPDATE ON public.legal_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_legal_documents_category ON public.legal_documents (category);
CREATE INDEX IF NOT EXISTS idx_legal_documents_act_name ON public.legal_documents (act_name);
CREATE INDEX IF NOT EXISTS idx_legal_documents_authority ON public.legal_documents (authority);
CREATE INDEX IF NOT EXISTS idx_legal_documents_section_number ON public.legal_documents (section_number);
CREATE INDEX IF NOT EXISTS idx_legal_documents_embedding
  ON public.legal_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_legal_documents_keywords ON public.legal_documents USING gin (keywords);

CREATE OR REPLACE FUNCTION public.match_legal_documents(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (
  document_row jsonb,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_jsonb(ld) AS document_row,
    (1 - (ld.embedding <=> query_embedding))::float AS similarity
  FROM public.legal_documents ld
  WHERE ld.embedding IS NOT NULL
    AND (filter_category IS NULL OR ld.category = filter_category)
  ORDER BY ld.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;

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
DROP TRIGGER IF EXISTS trg_clash_mock_cases_updated_at ON public.clash_mock_cases;
CREATE TRIGGER trg_clash_mock_cases_updated_at
BEFORE UPDATE ON public.clash_mock_cases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_clash_mock_cases_active ON public.clash_mock_cases (active);

CREATE TABLE IF NOT EXISTS public.nodal_guides (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  state text,
  location text,
  occupation text,
  bio text,
  avatar text,
  contact_number text,
  email text,
  availability text,
  rating numeric,
  cases_resolved int DEFAULT 0,
  languages text[] DEFAULT '{}',
  lat_min double precision,
  lat_max double precision,
  lon_min double precision,
  lon_max double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routing_rules (
  id bigserial PRIMARY KEY,
  state_name text,
  issue_type text NOT NULL,
  primary_forum text,
  secondary_forum text,
  legal_aid_support text,
  legal_aid_level text,
  reason text,
  routing_message text,
  action_links jsonb DEFAULT '[]'::jsonb,
  priority int DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_lookup
  ON public.routing_rules (issue_type, state_name, active, priority);

CREATE TABLE IF NOT EXISTS public.female_lawyers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text,
  contact_number text,
  location text,
  state text,
  city text,
  bio text,
  avatar text,
  availability text,
  rating numeric,
  cases_resolved int DEFAULT 0,
  languages text[] DEFAULT '{}',
  specialization text,
  bar_registration text,
  experience_years int,
  consultation_fee text,
  verified boolean DEFAULT true,
  lat double precision,
  lon double precision,
  lat_min double precision,
  lat_max double precision,
  lon_min double precision,
  lon_max double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.female_nyayguides (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text,
  contact_number text,
  location text,
  state text,
  city text,
  bio text,
  avatar text,
  availability text,
  rating numeric,
  cases_resolved int DEFAULT 0,
  languages text[] DEFAULT '{}',
  specialization text,
  verified boolean DEFAULT true,
  lat double precision,
  lon double precision,
  lat_min double precision,
  lat_max double precision,
  lon_min double precision,
  lon_max double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy alias table used as fallback in older code paths
CREATE TABLE IF NOT EXISTS public.female_counsellors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text,
  contact_number text,
  location text,
  state text,
  city text,
  bio text,
  avatar text,
  availability text,
  rating numeric,
  cases_resolved int DEFAULT 0,
  languages text[] DEFAULT '{}',
  specialization text,
  verified boolean DEFAULT true,
  lat double precision,
  lon double precision,
  lat_min double precision,
  lat_max double precision,
  lon_min double precision,
  lon_max double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
