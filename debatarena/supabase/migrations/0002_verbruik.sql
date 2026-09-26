-- Tokenverbruik en kosten per AI-aanroep, zodat je per debat ziet waar het geld heen gaat.
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  -- null = verbruik buiten een debat (bijv. inspreken)
  run_id uuid references runs(id) on delete cascade,
  -- samenstellen | aanpassen | portret | huiswerk | beurt | uitspraak | hoogtepunten | zinnetje | stem | spraak
  kind text not null,
  role_id text,
  provider text not null default '',
  model text not null default '',
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- afbeeldingen of tekens spraak
  units numeric not null default 0,
  cost_eur numeric(12,5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_run_idx on usage_events (run_id);
create index if not exists usage_events_created_idx on usage_events (created_at desc);
alter table usage_events enable row level security;
