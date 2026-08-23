-- Backing tables for sidebar sections: legal rights, document templates,
-- case filing guides, and generic site content (About Us, etc.)

CREATE TABLE IF NOT EXISTS public.legal_rights (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  action_prompt text NOT NULL,
  category text,
  icon_key text,
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_legal_rights_updated_at ON public.legal_rights;
CREATE TRIGGER trg_legal_rights_updated_at
BEFORE UPDATE ON public.legal_rights
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_legal_rights_active ON public.legal_rights (active, sort_order);

CREATE TABLE IF NOT EXISTS public.document_templates (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  body text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  format text NOT NULL DEFAULT 'markdown',
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_document_templates_updated_at ON public.document_templates;
CREATE TRIGGER trg_document_templates_updated_at
BEFORE UPDATE ON public.document_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_document_templates_category ON public.document_templates (category);
CREATE INDEX IF NOT EXISTS idx_document_templates_active ON public.document_templates (active, sort_order);

CREATE TABLE IF NOT EXISTS public.case_filing_templates (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_docs text[] NOT NULL DEFAULT '{}',
  estimated_time text,
  authority text,
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_case_filing_templates_updated_at ON public.case_filing_templates;
CREATE TRIGGER trg_case_filing_templates_updated_at
BEFORE UPDATE ON public.case_filing_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_case_filing_templates_category ON public.case_filing_templates (category);
CREATE INDEX IF NOT EXISTS idx_case_filing_templates_active ON public.case_filing_templates (active, sort_order);

CREATE TABLE IF NOT EXISTS public.site_content (
  slug text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_site_content_updated_at ON public.site_content;
CREATE TRIGGER trg_site_content_updated_at
BEFORE UPDATE ON public.site_content
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
