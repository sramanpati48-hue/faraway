-- legal_documents schema tuned for semantic legal chunk retrieval
-- Run this as a migration in Supabase SQL editor / migration pipeline.

create extension if not exists vector;

create table if not exists public.legal_documents (
  id bigserial primary key,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),

  document_name text not null,
  act_name text not null,
  category text not null,
  year_introduced integer null,
  year_amendment integer null,

  section_number text null,
  subsection_text text null,
  title text not null,
  content text not null,
  summary text null,

  authority text not null,
  jurisdiction text null default 'India',
  legal_status text null,
  related_acts text[] null,
  keywords text[] null,

  severity_level text null,
  applicable_sections text[] null,
  punishments text null,

  source_url text null,
  source_type text null,
  pdf_page_reference text null,

  version text null default '1.0',
  embedding vector(768) null,
  language text null default 'en',
  created_by text null,
  notes text null
);

create or replace function public.set_updated_at_legal_documents()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_legal_documents_updated_at on public.legal_documents;
create trigger trg_legal_documents_updated_at
before update on public.legal_documents
for each row execute function public.set_updated_at_legal_documents();

create index if not exists idx_legal_documents_category
  on public.legal_documents using btree (category);

create index if not exists idx_legal_documents_act_name
  on public.legal_documents using btree (act_name);

create index if not exists idx_legal_documents_authority
  on public.legal_documents using btree (authority);

create index if not exists idx_legal_documents_legal_status
  on public.legal_documents using btree (legal_status);

create index if not exists idx_legal_documents_section_number
  on public.legal_documents using btree (section_number);

create index if not exists idx_legal_documents_jurisdiction
  on public.legal_documents using btree (jurisdiction);

create index if not exists idx_legal_documents_embedding
  on public.legal_documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists idx_legal_documents_keywords
  on public.legal_documents using gin (keywords);

create index if not exists idx_legal_documents_related_acts
  on public.legal_documents using gin (related_acts);
