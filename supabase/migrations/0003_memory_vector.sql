-- 0003_memory_vector.sql — Semantic search over memory items (pgvector).
--
-- pgvector lives in the `extensions` schema (Supabase's convention, keeps
-- extension objects out of the exposed `public` API schema). 1024 dimensions
-- for every embedder (Voyage or the local hashing fallback, decision D-003).
-- Cosine distance, HNSW index.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated, service_role;

alter table public.memory_items add column embedding extensions.vector(1024);

create index memory_items_embedding_hnsw_idx
  on public.memory_items
  using hnsw (embedding extensions.vector_cosine_ops);

-- Security invoker (the default): RLS on memory_items still applies, so an
-- authenticated caller only matches items of projects they belong to.
-- Same rules as the in-memory repository: match_count <= 0 returns nothing,
-- at most 50 rows, and zero vectors (no direction) never match.
create or replace function public.match_memory_items(
  p_project_id uuid,
  query_embedding extensions.vector(1024),
  match_count integer default 8
)
returns table (
  id uuid,
  project_id uuid,
  kind text,
  summary text,
  evidence jsonb,
  occurred_at timestamptz,
  status text,
  similarity double precision
)
language sql
stable
-- `<=>` and vector_norm resolve through the search path (extensions).
set search_path = public, extensions
as $$
  select
    m.id,
    m.project_id,
    m.kind,
    m.summary,
    m.evidence,
    m.occurred_at,
    m.status,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memory_items m
  where m.project_id = p_project_id
    and m.embedding is not null
    and vector_norm(m.embedding) > 0
    and vector_norm(query_embedding) > 0
  order by m.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 8), 0), 50);
$$;

revoke all on function public.match_memory_items(uuid, extensions.vector, integer) from public, anon;
grant execute on function public.match_memory_items(uuid, extensions.vector, integer)
  to authenticated, service_role;
