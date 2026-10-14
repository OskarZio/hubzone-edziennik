-- =====================================================================
-- Hubzone Weightlifting e-Dziennik — schemat bazy Supabase
-- Wklej całość w Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Profile (jeden na konto) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 60),
  email       text not null default '',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Ustawienia klubu (jeden wiersz) ----------
create table if not exists public.club_settings (
  id         int primary key default 1 check (id = 1),
  join_code  text check (join_code is null or char_length(join_code) between 3 and 40)
);
insert into public.club_settings (id, join_code) values (1, 'HUBZONE')
  on conflict (id) do nothing;

-- ---------- Czy zalogowany użytkownik jest trenerem ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Nowe konto: sprawdź kod klubu i utwórz profil ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  required_code text;
begin
  select join_code into required_code from public.club_settings where id = 1;
  if required_code is not null
     and upper(coalesce(new.raw_user_meta_data->>'join_code', '')) <> upper(required_code) then
    raise exception 'invalid_join_code';
  end if;
  insert into public.profiles (id, name, email)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 60), coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Ćwiczenia ----------
create table if not exists public.exercises (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (char_length(name) between 1 and 80),
  type      text not null check (type in ('kg', 'band', 'bw')),
  inc       numeric not null default 2.5 check (inc >= 0 and inc <= 20),
  position  int not null default 0
);

-- ---------- Gumy (kolejność: od najmocniejszej asysty) ----------
create table if not exists public.bands (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (char_length(name) between 1 and 40),
  color     text not null default '#888888' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position  int not null default 0
);

-- ---------- Treningi (stacje jako lista JSON) ----------
create table if not exists public.workouts (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  title       text not null default '' check (char_length(title) <= 80),
  note        text not null default '' check (char_length(note) <= 1000),
  stations    jsonb not null default '[]'::jsonb check (jsonb_typeof(stations) = 'array'),
  created_at  timestamptz not null default now()
);

-- ---------- Wpisy klientów ----------
create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  workout_id  uuid references public.workouts(id) on delete set null,
  date        date not null,
  own         boolean not null default false,
  title       text not null default '' check (char_length(title) <= 80),
  fatigue     smallint check (fatigue between 1 and 10),
  note        text not null default '' check (char_length(note) <= 1000),
  entries     jsonb not null default '[]'::jsonb
              check (jsonb_typeof(entries) = 'array' and pg_column_size(entries) < 100000),
  saved_at    timestamptz not null default now(),
  unique (user_id, workout_id)
);
create index if not exists logs_user_idx on public.logs (user_id, date);
create index if not exists logs_workout_idx on public.logs (workout_id);

-- =====================================================================
-- Zabezpieczenia (Row Level Security)
-- Niezalogowani nie widzą nic. Klient widzi i zapisuje tylko swoje wpisy.
-- Trener (is_admin = true) widzi wszystko i zarządza treningami.
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.club_settings enable row level security;
alter table public.exercises     enable row level security;
alter table public.bands         enable row level security;
alter table public.workouts      enable row level security;
alter table public.logs          enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- klient może zmienić wyłącznie swoje imię (nie rolę ani e-mail)
revoke update on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

-- club_settings: tylko trener
drop policy if exists club_admin on public.club_settings;
create policy club_admin on public.club_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- exercises / bands / workouts: odczyt dla zalogowanych, zapis tylko trener
do $$
declare t text;
begin
  foreach t in array array['exercises', 'bands', 'workouts'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- logs
drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists logs_update on public.logs;
create policy logs_update on public.logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists logs_delete on public.logs;
create policy logs_delete on public.logs for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- =====================================================================
-- PO ZAŁOŻENIU SWOJEGO KONTA nadaj sobie rolę trenera
-- (podmień e-mail i uruchom tylko tę linijkę):
--
-- update public.profiles set is_admin = true where email = 'twoj@email.pl';
-- =====================================================================
