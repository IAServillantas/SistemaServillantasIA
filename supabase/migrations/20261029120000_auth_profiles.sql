-- Perfiles y roles de acceso
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('super_admin', 'chihuahua', 'juarez')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('America/Mexico_City', now()),
  updated_at timestamptz not null default timezone('America/Mexico_City', now())
);

create index if not exists profiles_role_idx on public.profiles (role);

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.can_access_site(p_site text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_role()
    when 'super_admin' then true
    when 'juarez' then p_site = 'general'
    when 'chihuahua' then p_site = 'chihuahua'
    else false
  end;
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.current_role() = 'super_admin');

drop policy if exists profiles_update_super on public.profiles;
create policy profiles_update_super on public.profiles
  for update to authenticated
  using (public.current_role() = 'super_admin');

-- Lectura de snapshots solo autenticados y con permiso de sitio
drop policy if exists inventory_snapshots_read_active on public.inventory_snapshots;
create policy inventory_snapshots_read_active on public.inventory_snapshots
  for select to authenticated
  using (is_active = true and public.can_access_site(site_code));

-- Revoca lectura anon previa de reglas e inventarios
drop policy if exists inventory_rules_read on public.inventory_rules;
create policy inventory_rules_read on public.inventory_rules
  for select to authenticated
  using (true);

revoke all on function public.publish_inventory_snapshot(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_inventory_snapshot(text, text, text, text, jsonb) to service_role;
grant execute on function public.current_role() to authenticated;
grant execute on function public.can_access_site(text) to authenticated;

comment on table public.profiles is 'Roles: super_admin (todo), juarez (inventario/criticas), chihuahua (dashboard Chihuahua)';
