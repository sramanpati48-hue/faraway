-- RPC for semantic retrieval from public.legal_documents
-- Returns full row + similarity score, ordered by nearest embedding.

create extension if not exists vector;

create or replace function public.match_legal_documents(
  query_embedding vector(768),
  match_count int default 5,
  filter_category text default null
)
returns table (
  document_row jsonb,
  similarity float
)
language sql
stable
as $$
  select
    to_jsonb(ld) as document_row,
    (1 - (ld.embedding <=> query_embedding))::float as similarity
  from public.legal_documents ld
  where ld.embedding is not null
    and (filter_category is null or ld.category = filter_category)
  order by ld.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
