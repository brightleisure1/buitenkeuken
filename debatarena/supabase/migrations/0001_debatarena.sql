-- Debatarena: tabellen, opslag en hulpfuncties.
-- Alle toegang loopt via de server met de service role key.
-- RLS staat aan zonder policies, zodat de publieke (anon) sleutel niets kan lezen.

create extension if not exists pgcrypto;

-- Instellingen (API-sleutels versleuteld, stemmenlijst gecachet, teller)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Opgeslagen teams (cast als template)
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "cast" jsonb not null,
  created_at timestamptz not null default now()
);

-- Debatten
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  title text,
  -- draft | running | done
  status text not null default 'draft',
  "cast" jsonb not null,
  -- voorbereiding per rol: portretten, huiswerk, wat ze bekijken
  prep jsonb not null default '{}'::jsonb,
  result jsonb,
  result_checks jsonb not null default '{}'::jsonb,
  highlights jsonb,
  share_token text unique,
  share jsonb not null default '{}'::jsonb,
  cost_eur numeric(12,5) not null default 0,
  debate_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runs_created_at_idx on runs (created_at desc);

-- Alles wat er in een debat gezegd wordt
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  seq bigint generated always as identity,
  -- turn | boss | system
  kind text not null,
  role_id text,
  round integer,
  -- bezwaar | akkoord | voorstel
  tag text,
  content text not null default '',
  sources jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  audio jsonb not null default '[]'::jsonb,
  cost_eur numeric(12,5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists messages_run_seq_idx on messages (run_id, seq);

-- Bijlages (tekst uitgelezen, afbeeldingen in Storage)
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  name text not null,
  mime text not null,
  -- text | image
  kind text not null,
  text text,
  storage_path text,
  size integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists attachments_run_idx on attachments (run_id);

alter table settings enable row level security;
alter table templates enable row level security;
alter table runs enable row level security;
alter table messages enable row level security;
alter table attachments enable row level security;

-- Atomisch één rol in runs.prep bijwerken (parallelle achtergrondtaken)
create or replace function merge_prep(p_run uuid, p_role text, p_patch jsonb)
returns void language sql as $$
  update runs
     set prep = jsonb_set(coalesce(prep, '{}'::jsonb), array[p_role],
                          coalesce(prep -> p_role, '{}'::jsonb) || p_patch, true),
         updated_at = now()
   where id = p_run;
$$;

-- Atomisch kosten optellen
create or replace function add_cost(p_run uuid, p_eur numeric)
returns void language sql as $$
  update runs set cost_eur = cost_eur + p_eur, updated_at = now() where id = p_run;
$$;

-- Atomisch een audiofragment aan een bericht toevoegen
create or replace function add_audio(p_msg uuid, p_item jsonb)
returns void language sql as $$
  update messages set audio = coalesce(audio, '[]'::jsonb) || jsonb_build_array(p_item) where id = p_msg;
$$;

revoke all on function add_audio(uuid, jsonb) from anon, authenticated;
revoke all on function merge_prep(uuid, text, jsonb) from anon, authenticated;
revoke all on function add_cost(uuid, numeric) from anon, authenticated;

-- Opslag: portretten en audio zijn publiek leesbaar (replay-links), bijlages privé
insert into storage.buckets (id, name, public)
values ('portraits', 'portraits', true),
       ('audio', 'audio', true),
       ('attachments', 'attachments', false)
on conflict (id) do nothing;
