-- Run this in Supabase SQL Editor after replacing ADMIN_EMAIL below.
-- This creates shared posts and media storage with Row Level Security.
-- IMPORTANT: Create the admin user manually in Supabase Authentication first.
-- Disable public sign-ups after creating the admin account.

create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 120),
  category text not null default 'School announcement',
  priority text not null default 'Normal',
  author text not null default 'Okomfo Anokye Updates',
  body text not null check (char_length(body) <= 5000),
  media_urls text[] not null default '{}',
  video_url text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts enable row level security;

drop policy if exists "Anyone can read published posts" on public.posts;
create policy "Anyone can read published posts" on public.posts
for select to anon, authenticated using (published = true or lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL'));

drop policy if exists "Only admin can insert posts" on public.posts;
create policy "Only admin can insert posts" on public.posts
for insert to authenticated with check (lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL'));

drop policy if exists "Only admin can update posts" on public.posts;
create policy "Only admin can update posts" on public.posts
for update to authenticated using (lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL'))
with check (lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL'));

drop policy if exists "Only admin can delete posts" on public.posts;
create policy "Only admin can delete posts" on public.posts
for delete to authenticated using (lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public=true, file_size_limit=52428800;

drop policy if exists "Public can view post media" on storage.objects;
create policy "Public can view post media" on storage.objects
for select to anon, authenticated using (bucket_id = 'post-media');

drop policy if exists "Only admin can upload post media" on storage.objects;
create policy "Only admin can upload post media" on storage.objects
for insert to authenticated with check (
  bucket_id = 'post-media' and lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL')
);

drop policy if exists "Only admin can update post media" on storage.objects;
create policy "Only admin can update post media" on storage.objects
for update to authenticated using (
  bucket_id = 'post-media' and lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL')
) with check (
  bucket_id = 'post-media' and lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL')
);

drop policy if exists "Only admin can delete post media" on storage.objects;
create policy "Only admin can delete post media" on storage.objects
for delete to authenticated using (
  bucket_id = 'post-media' and lower(coalesce(auth.jwt()->>'email','')) = lower('ADMIN_EMAIL')
);

-- Security checklist:
-- 1) Replace every ADMIN_EMAIL above with your exact admin email, then run the SQL.
-- 2) Create that email in Authentication > Users with a strong password.
-- 3) Turn off public user sign-ups in Authentication settings.
-- 4) Never expose the Supabase service-role key in website files.
