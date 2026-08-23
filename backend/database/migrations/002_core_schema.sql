-- Core application schema (replaces Supabase tables)

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Users (local JWT auth; firebase_uid kept for migration compatibility)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text UNIQUE,
  email text,
  mobile text,
  password_hash text,
  role text NOT NULL DEFAULT 'victim'
    CHECK (role IN ('victim', 'sahayak', 'lawyer', 'moderator', 'admin', 'super_admin')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'pending_reset')),
  password_reset_required boolean NOT NULL DEFAULT false,
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  email_normalized text GENERATED ALWAYS AS (lower(nullif(btrim(email), ''))) STORED,
  mobile_normalized text GENERATED ALWAYS AS (
    CASE
      WHEN mobile IS NULL OR btrim(mobile) = '' THEN NULL
      ELSE regexp_replace(mobile, '[^0-9+]', '', 'g')
    END
  ) STORED,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_or_mobile CHECK (
    email_normalized IS NOT NULL OR mobile_normalized IS NOT NULL OR firebase_uid IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_normalized
  ON public.users (email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_mobile_normalized
  ON public.users (mobile_normalized) WHERE mobile_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON public.users (firebase_uid);

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auth tokens / reset codes
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS public.password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user ON public.password_reset_codes (user_id);

CREATE TABLE IF NOT EXISTS public.auth_audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chat history
CREATE TABLE IF NOT EXISTS public.chat_history (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_ts
  ON public.chat_history (user_id, timestamp DESC);

-- Cases
CREATE TABLE IF NOT EXISTS public.cases (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text,
  structured_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending boolean NOT NULL DEFAULT false,
  situation_summary jsonb,
  collected_answers jsonb,
  user_language text,
  status text,
  has_answers boolean,
  pdf_url text,
  pdf_updated_at timestamptz,
  pdf_generated_at timestamptz,
  timestamp timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cases_user_ts ON public.cases (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cases_pending ON public.cases (pending) WHERE pending = true;

DROP TRIGGER IF EXISTS trg_cases_updated_at ON public.cases;
CREATE TRIGGER trg_cases_updated_at
BEFORE UPDATE ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Interventions
CREATE TABLE IF NOT EXISTS public.interventions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text,
  collection_name text NOT NULL DEFAULT 'moderator',
  structured_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'resolved')),
  session_id text,
  user_statement text DEFAULT '',
  location jsonb DEFAULT '{}'::jsonb,
  moderator_response text,
  moderator_options jsonb,
  routing_recommendation jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interventions_pending
  ON public.interventions (collection_name, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interventions_user
  ON public.interventions (user_id, status);

DROP TRIGGER IF EXISTS trg_interventions_updated_at ON public.interventions;
CREATE TRIGGER trg_interventions_updated_at
BEFORE UPDATE ON public.interventions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sahayak
CREATE TABLE IF NOT EXISTS public.sahayak_profiles (
  uid text PRIMARY KEY,
  name text,
  email text,
  contact_number text,
  location text,
  occupation text,
  bio text,
  avatar text,
  languages text[] DEFAULT '{}',
  availability text,
  rating numeric,
  cases_resolved int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sahayak_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text,
  user_name text,
  structured_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  session_id text,
  assigned_sahayak_id text,
  assigned_sahayak_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sahayak_cases_session ON public.sahayak_cases (session_id);
CREATE INDEX IF NOT EXISTS idx_sahayak_cases_assigned ON public.sahayak_cases (assigned_sahayak_id, status);

-- Lawyers
CREATE TABLE IF NOT EXISTS public.lawyers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text UNIQUE,
  name text,
  email text,
  specialization text,
  lawyer_type text,
  experience text,
  hourly_rate text,
  bio text,
  location text,
  avatar text,
  contact_number text,
  bar_registration_number text,
  rating numeric,
  verified boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lawyers_specialization ON public.lawyers (specialization);

CREATE TABLE IF NOT EXISTS public.lawyer_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text,
  assigned_lawyer_id text,
  structured_report jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lawyer_cases_lawyer ON public.lawyer_cases (assigned_lawyer_id, status);

CREATE TABLE IF NOT EXISTS public.case_attachments (
  id bigserial PRIMARY KEY,
  case_id text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_name text,
  file_size bigint,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_attachments_case ON public.case_attachments (case_id);

CREATE TABLE IF NOT EXISTS public.case_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  assignee_type text NOT NULL CHECK (assignee_type IN ('lawyer', 'counsellor', 'nyayguide')),
  assignee_id text NOT NULL,
  assigned_by text,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_assignments_case ON public.case_assignments (case_id);
