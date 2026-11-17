-- Controle da sincronização (estado por job, configurações, trava, execuções).
-- Idempotente. Ajusta as tabelas criadas em 20261117000000_ingestion_base.sql.

-- raw_erp_records foi substituída pelas tabelas espelho tipadas (erp_*). Estava vazia.
drop table if exists public.raw_erp_records;

-- Estado de cada job (cursor, ciclo, erros).
alter table public.sync_state drop column if exists last_cursor;
alter table public.sync_state alter column enabled set default true;
alter table public.sync_state add column if not exists kind text;
alter table public.sync_state add column if not exists cursor jsonb;
alter table public.sync_state add column if not exists window_from date;
alter table public.sync_state add column if not exists cycle_started_at timestamptz;
alter table public.sync_state add column if not exists last_completed_at timestamptz;
alter table public.sync_state add column if not exists status text not null default 'idle';
alter table public.sync_state add column if not exists last_error text;
alter table public.sync_state add column if not exists rows_cycle bigint not null default 0;
alter table public.sync_state add column if not exists rows_total bigint not null default 0;

-- Execuções: detalhes por job.
alter table public.sync_runs add column if not exists details jsonb;

-- Configuração geral (linha única). A sincronização automática começa DESLIGADA:
-- ligue depois de validar a conexão com o ERP (POST /api/sync/settings).
create table if not exists public.sync_settings (
  id           integer primary key default 1 check (id = 1),
  auto_enabled boolean not null default false,
  recent_days  integer not null default 7 check (recent_days between 1 and 60),
  updated_at   timestamptz not null default now()
);
insert into public.sync_settings (id) values (1) on conflict (id) do nothing;
alter table public.sync_settings enable row level security;

-- Trava contra execuções simultâneas (expira sozinha se o Worker cair).
alter table public.sync_locks add column if not exists owner text;

create or replace function public.sync_try_lock(p_name text, p_owner text, p_ttl_seconds integer)
returns boolean language plpgsql set search_path = public as $$
begin
  insert into public.sync_locks (name, owner, locked_at, expires_at)
  values (p_name, p_owner, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set owner = excluded.owner, locked_at = excluded.locked_at, expires_at = excluded.expires_at
    where public.sync_locks.expires_at < now();
  return found;
end $$;

create or replace function public.sync_release_lock(p_name text, p_owner text)
returns void language sql set search_path = public as $$
  delete from public.sync_locks where name = p_name and owner = p_owner;
$$;

-- Só a service_role (Worker) executa as funções de trava.
do $$
declare r text;
begin
  revoke execute on function public.sync_try_lock(text, text, integer) from public;
  revoke execute on function public.sync_release_lock(text, text) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.sync_try_lock(text, text, integer) from %I', r);
      execute format('revoke execute on function public.sync_release_lock(text, text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_try_lock(text, text, integer) to service_role;
    grant execute on function public.sync_release_lock(text, text) to service_role;
  end if;
end $$;

-- Classificação das seções do ERP nos setores da gestão (Alimentação, Farmácia, Diversos).
-- Preencha no SQL Editor: insert into cfg_secao_setor (idsecao, setor) values (1, 'Alimentação'), ...
create table if not exists public.cfg_secao_setor (
  idsecao bigint primary key,
  setor   text not null
);
alter table public.cfg_secao_setor enable row level security;
