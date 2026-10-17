-- Aurora Social Studio — Supabase şeması
create table if not exists public.items (
  collection text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists items_collection_created_idx on public.items (collection, created_at desc);

-- RLS açık, politika yok: anon/publishable anahtar hiçbir şey okuyamaz/yazamaz; yalnızca secret key erişir.
alter table public.items enable row level security;

-- Medya klasörü (herkese açık okuma, 50 MB sınır, yalnızca görsel/video)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
