-- Per-article SEO fields for /blogs/[id]
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS meta_title text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS meta_keywords text,
  ADD COLUMN IF NOT EXISTS og_image text,
  ADD COLUMN IF NOT EXISTS robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS canonical_path text,
  ADD COLUMN IF NOT EXISTS structured_data jsonb;
