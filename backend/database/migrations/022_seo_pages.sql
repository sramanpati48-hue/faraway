-- SEO pages live in system_config under keys seo_pages / seo_pages_defaults.
-- Route payloads are filled from backend.services.seo_pages defaults on first
-- read/save so this migration only ensures the keys exist.

INSERT INTO public.system_config (key, value, updated_at)
VALUES ('seo_pages', '{}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_config (key, value, updated_at)
VALUES ('seo_pages_defaults', '{}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
