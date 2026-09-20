-- 在 Supabase SQL Editor 中运行一次。
create table if not exists public.study_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.study_progress enable row level security;

drop policy if exists "users can read own progress" on public.study_progress;
create policy "users can read own progress"
on public.study_progress for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own progress" on public.study_progress;
create policy "users can insert own progress"
on public.study_progress for insert
with check (auth.uid() = user_id);

drop policy if exists "users can update own progress" on public.study_progress;
create policy "users can update own progress"
on public.study_progress for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
