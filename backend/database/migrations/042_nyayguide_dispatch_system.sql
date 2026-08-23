-- Migration 042: NyayGuide Physical Assistance Dispatch System
-- Implements tables for physical on-ground assistance matching, dispatching, and audit logging.

-- 1. nyay_guides table
CREATE TABLE IF NOT EXISTS public.nyay_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE NOT NULL,
  display_name text NOT NULL,
  profile_photo_url text,
  gender text CHECK (gender IN ('female', 'male', 'other', 'prefer_not_to_say')),
  languages jsonb NOT NULL DEFAULT '["en", "hi"]'::jsonb,
  specializations jsonb NOT NULL DEFAULT '["document_support", "office_navigation", "complaint_filing_support", "digital_assistance"]'::jsonb,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  availability_status text NOT NULL DEFAULT 'OFFLINE'
    CHECK (availability_status IN ('OFFLINE', 'AVAILABLE', 'OFFERED', 'BUSY', 'PAUSED')),
  verification_status text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED')),
  rating numeric NOT NULL DEFAULT 4.8,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nyay_guides_availability
  ON public.nyay_guides (availability_status, verification_status);
CREATE INDEX IF NOT EXISTS idx_nyay_guides_user_id
  ON public.nyay_guides (user_id);
CREATE INDEX IF NOT EXISTS idx_nyay_guides_coords
  ON public.nyay_guides (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

DROP TRIGGER IF EXISTS trg_nyay_guides_updated_at ON public.nyay_guides;
CREATE TRIGGER trg_nyay_guides_updated_at
BEFORE UPDATE ON public.nyay_guides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. nyayguide_requests table
CREATE TABLE IF NOT EXISTS public.nyayguide_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  user_id text NOT NULL,
  assistance_type text NOT NULL
    CHECK (assistance_type IN ('document_support', 'office_navigation', 'complaint_filing_support', 'digital_assistance', 'other')),
  safe_task_summary text NOT NULL,
  risk_flags text[] NOT NULL DEFAULT '{}',
  preferred_gender text CHECK (preferred_gender IN ('female', 'male', 'any')),
  location_consent_at timestamptz,
  user_latitude double precision,
  user_longitude double precision,
  idempotency_key text,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN (
      'REQUESTED',
      'SEARCHING',
      'OFFER_SENT',
      'MATCHED',
      'NYAYGUIDE_EN_ROUTE',
      'NYAYGUIDE_ARRIVED',
      'ASSISTANCE_ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'NO_NYAYGUIDE_AVAILABLE',
      'FAILED'
    )),
  assigned_nyayguide_id uuid REFERENCES public.nyay_guides(id) ON DELETE SET NULL,
  search_radius_km double precision NOT NULL DEFAULT 3.0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  nyayguide_en_route_at timestamptz,
  nyayguide_arrived_at timestamptz,
  assistance_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz,
  completion_notes text,
  citizen_rating int CHECK (citizen_rating BETWEEN 1 AND 5),
  citizen_feedback text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nyayguide_requests_case
  ON public.nyayguide_requests (case_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_nyayguide_requests_status
  ON public.nyayguide_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_nyayguide_requests_assigned
  ON public.nyayguide_requests (assigned_nyayguide_id)
  WHERE assigned_nyayguide_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nyayguide_requests_idempotency
  ON public.nyayguide_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_nyayguide_requests_updated_at ON public.nyayguide_requests;
CREATE TRIGGER trg_nyayguide_requests_updated_at
BEFORE UPDATE ON public.nyayguide_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. nyayguide_offers table
CREATE TABLE IF NOT EXISTS public.nyayguide_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.nyayguide_requests(id) ON DELETE CASCADE,
  nyayguide_id uuid NOT NULL REFERENCES public.nyay_guides(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  distance_km double precision,
  estimated_minutes int,
  offered_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nyayguide_offers_request
  ON public.nyayguide_offers (request_id, status);
CREATE INDEX IF NOT EXISTS idx_nyayguide_offers_guide
  ON public.nyayguide_offers (nyayguide_id, status);

DROP TRIGGER IF EXISTS trg_nyayguide_offers_updated_at ON public.nyayguide_offers;
CREATE TRIGGER trg_nyayguide_offers_updated_at
BEFORE UPDATE ON public.nyayguide_offers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. nyayguide_request_events table (Audit Trail)
CREATE TABLE IF NOT EXISTS public.nyayguide_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.nyayguide_requests(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('citizen', 'nyayguide', 'system', 'admin')),
  actor_id text,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nyayguide_request_events_req
  ON public.nyayguide_request_events (request_id, created_at ASC);
