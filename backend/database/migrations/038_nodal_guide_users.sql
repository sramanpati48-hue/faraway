-- Allow 'nodal_guide' and 'nyayguide' in public.users.role CHECK constraint.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('victim', 'sahayak', 'lawyer', 'moderator', 'admin', 'super_admin', 'nodal_guide', 'nyayguide'));
