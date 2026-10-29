-- Inventario Servillantas: snapshots activos por sitio + reglas
create extension if not exists pgcrypto;

create table if not exists public.inventory_rules (
  id int primary key default 1 check (id = 1),
  rules jsonb not null,
  updated_at timestamptz not null default timezone('America/Mexico_City', now())
);

create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_code text not null check (site_code in ('general', 'chihuahua')),
  cutoff text,
  file_name text,
  data_version text,
  loaded_at timestamptz not null default timezone('America/Mexico_City', now()),
  row_count int not null default 0,
  rows jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('America/Mexico_City', now())
);

create index if not exists inventory_snapshots_site_created_idx
  on public.inventory_snapshots (site_code, created_at desc);

create unique index if not exists inventory_snapshots_one_active_per_site
  on public.inventory_snapshots (site_code)
  where is_active;

create or replace function public.publish_inventory_snapshot(
  p_site_code text,
  p_cutoff text,
  p_file_name text,
  p_data_version text,
  p_rows jsonb
) returns public.inventory_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.inventory_snapshots;
begin
  if p_site_code not in ('general', 'chihuahua') then
    raise exception 'site_code invalido: %', p_site_code;
  end if;

  update public.inventory_snapshots
     set is_active = false
   where site_code = p_site_code
     and is_active = true;

  insert into public.inventory_snapshots (
    site_code, cutoff, file_name, data_version, row_count, rows, is_active
  ) values (
    p_site_code,
    p_cutoff,
    p_file_name,
    p_data_version,
    coalesce(jsonb_array_length(p_rows), 0),
    coalesce(p_rows, '[]'::jsonb),
    true
  )
  returning * into inserted;

  return inserted;
end;
$$;

revoke all on function public.publish_inventory_snapshot(text, text, text, text, jsonb) from public;
grant execute on function public.publish_inventory_snapshot(text, text, text, text, jsonb) to service_role;

alter table public.inventory_rules enable row level security;
alter table public.inventory_snapshots enable row level security;

drop policy if exists inventory_rules_read on public.inventory_rules;
create policy inventory_rules_read on public.inventory_rules
  for select to anon, authenticated
  using (true);

drop policy if exists inventory_snapshots_read_active on public.inventory_snapshots;
create policy inventory_snapshots_read_active on public.inventory_snapshots
  for select to anon, authenticated
  using (is_active = true);

insert into public.inventory_rules (id, rules)
values (
  1,
  $json${
    "inventory": {
      "targetCoverageDays": 90,
      "recentPurchaseDays": 90,
      "excessDays": 120,
      "noMovementDays": 90,
      "stockDifferenceTolerance": 0.01
    },
    "general": {
      "capacity": { "sat": 1000, "ins": null, "cue": 300, "tor": 300 }
    },
    "chihuahua": {
      "capacity": { "fco": null, "pis": null, "juv": null, "camp": null, "par": null }
    },
    "report": {
      "bufferDays": 15,
      "lostDemandWarningDays": 60,
      "seasonFactorMin": 0.75,
      "seasonFactorMax": 1.25
    },
    "suppliers": {
      "opportunityCoverageDays": 120,
      "minimumSavingsRate": 0.10,
      "generalCostDivisor": 1.16
    }
  }$json$::jsonb
)
on conflict (id) do nothing;
