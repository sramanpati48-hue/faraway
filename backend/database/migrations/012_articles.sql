-- Legal knowledge-base articles with pgvector semantic search (768-d)

CREATE TABLE IF NOT EXISTS public.articles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  author text NOT NULL DEFAULT 'NyaySahayak Editorial',
  tags text[] NOT NULL DEFAULT '{}',
  read_minutes int NOT NULL DEFAULT 5,
  hero_image text,
  published_at timestamptz NOT NULL DEFAULT now(),
  embedding vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_articles_updated_at ON public.articles;
CREATE TRIGGER trg_articles_updated_at
BEFORE UPDATE ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_articles_category ON public.articles (category);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON public.articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_tags ON public.articles USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_articles_embedding
  ON public.articles USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_articles(
  query_embedding vector(768),
  match_count int DEFAULT 10,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (
  article_row jsonb,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_jsonb(a) - 'embedding' AS article_row,
    (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM public.articles a
  WHERE a.embedding IS NOT NULL
    AND (filter_category IS NULL OR a.category = filter_category)
  ORDER BY a.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;
