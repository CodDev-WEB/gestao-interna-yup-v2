-- YUP Intelligence — base da camada de ingestão.
-- Idempotente: pode ser executado mais de uma vez no SQL Editor do Supabase.
-- Todas as tabelas ficam com RLS ligado e SEM políticas: só a service_role (Worker) lê e grava.

create table if not exists public.sync_runs (
  id           bigint generated always as identity primary key,
  dataset      text        not null,                 -- ex.: 'documento', 'mercadoria_estoque'
  mode         text        not null default 'manual', -- manual | initial | incremental | reprocess
  status       text        not null default 'running', -- running | ok | partial | error
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  range_start  timestamptz,
  range_end    timestamptz,
  rows_read    integer     not null default 0,
  rows_written integer     not null default 0,
  erp_requests integer     not null default 0,
  error        text
);
create index if not exists sync_runs_dataset_started_idx on public.sync_runs (dataset, started_at desc);

-- Ponto de parada de cada conjunto de dados para a sincronização incremental.
create table if not exists public.sync_state (
  dataset        text primary key,
  enabled        boolean     not null default false,
  last_cursor    text,                                -- último id/data lido no ERP
  last_synced_at timestamptz,
  updated_at     timestamptz not null default now()
);

-- Espelho bruto do que veio do ERP, para auditoria e reprocessamento.
create table if not exists public.raw_erp_records (
  dataset     text        not null,
  source_id   text        not null,                   -- chave original no ERP
  payload     jsonb       not null,
  hash        text        not null,                   -- detecta mudança sem comparar o JSON inteiro
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (dataset, source_id)
);

-- Trava contra duas sincronizações ao mesmo tempo (expira sozinha).
create table if not exists public.sync_locks (
  name       text primary key,
  locked_at  timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.sync_runs       enable row level security;
alter table public.sync_state      enable row level security;
alter table public.raw_erp_records enable row level security;
alter table public.sync_locks      enable row level security;
