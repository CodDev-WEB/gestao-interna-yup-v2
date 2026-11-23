-- Vendas e classificação de produtos prontas, para as telas não recalcularem todos os itens vendidos a cada
-- acesso. Com várias telas abertas e a sincronização rodando, as consultas passavam do limite de 8 s da API e
-- voltavam erro 500 em todas as abas. Idempotente.
--
-- vw_venda_item e vw_produto_classe continuam existindo com as mesmas colunas (as views que dependem delas
-- seguem iguais); só passam a ler a versão pronta. A definição original fica em *_base.
--  - cache_venda_item: tabela atualizada de forma incremental (só os documentos que mudaram desde a última vez:
--    novos, relidos, cancelados ou que ganharam custo). Refazer tudo levava ~8 s; o incremental, frações de segundo.
--  - mv_produto_classe: materialized view pequena (16 mil linhas, < 1 s).
-- Atualização: atualizar_gestao() (cron do Worker a cada 15 min) e atualizar_classe() (ao salvar uma regra).

create or replace view public.vw_venda_item_base with (security_invoker = true) as
select d._iddocumento                                   as iddocumento,
       dm._idsequencia                                  as idsequencia,
       d.idempresa,
       d.datahora,
       (d.datahora at time zone 'America/Belem')::date  as data,
       d.idpessoa                                       as idcliente,
       dm.idpessoafuncionario,
       dm.idmercadoria,
       dm.idmercadoriavariacao,
       dm.descricao,
       coalesce(dm.idsecao, m.idsecao)                  as idsecao,
       coalesce(dm.idgrupo, m.idgrupo)                  as idgrupo,
       coalesce(dm.idsubgrupo, m.idsubgrupo)            as idsubgrupo,
       dm.qtd,
       dm.valtotalbruto,
       coalesce(dm.valdesconto, 0)                      as valdesconto,
       dm.valtotalliquido,
       coalesce(nullif(c.valcustomedio, 0), c.valcusto) as custo_unitario,
       dm.qtd * coalesce(nullif(c.valcustomedio, 0), c.valcusto)                      as custo_total,
       dm.valtotalliquido - dm.qtd * coalesce(nullif(c.valcustomedio, 0), c.valcusto) as lucro_bruto
  from public.erp_documento d
  join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
  left join public.erp_documento_mercadoria_custo c on c._iddocumento = dm._iddocumento and c._idsequencia = dm._idsequencia
  left join public.erp_mercadoria m on m._idmercadoria = dm.idmercadoria
 where d.tipomovimento = 'S' and d.tipomovimentofinanceiro = 'R' and d.status = 'E';

create or replace view public.vw_produto_classe_base with (security_invoker = true) as
with v as (
  select v._idmercadoriavariacao as id, v.idmercadoria, m.idsecao, coalesce(public.ncm_limpo(v.ncm), public.ncm_limpo(m.ncm)) as ncm
    from public.erp_mercadoria_variacao v
    left join public.erp_mercadoria m on m._idmercadoria = v.idmercadoria
   where v.sync_deleted_at is null),
r as (select distinct on (v.id) v.id, c.setor from v join public.cfg_ncm_setor c on v.ncm like c.prefixo || '%' order by v.id, length(c.prefixo) desc)
select v.id as idmercadoriavariacao, v.idmercadoria, v.ncm,
       left(v.ncm, 2) as capitulo, left(v.ncm, 4) as posicao, left(v.ncm, 6) as subposicao, n.descricao as ncm_descricao,
       coalesce(r.setor, s.setor, case when v.ncm is not null then 'Diversos' end, 'Não classificado') as setor,
       case when r.setor is not null then 'ncm' when s.setor is not null then 'secao' when v.ncm is not null then 'padrao' end as origem_setor
  from v
  left join r on r.id = v.id
  left join public.cfg_secao_setor s on s.idsecao = v.idsecao
  left join public.erp_ncm n on n._ncm = v.ncm and n.sync_deleted_at is null;

-- Base de vendas pronta (tabela comum, atualizada por documento).
create table if not exists public.cache_venda_item as select * from public.vw_venda_item_base with no data;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cache_venda_item_pk') then
    alter table public.cache_venda_item add constraint cache_venda_item_pk primary key (iddocumento, idsequencia);
  end if;
end $$;
create index if not exists cache_venda_item_variacao_data on public.cache_venda_item (idmercadoriavariacao, data);
create index if not exists cache_venda_item_data on public.cache_venda_item (data);
create index if not exists cache_venda_item_datahora on public.cache_venda_item (datahora);
create index if not exists cache_venda_item_cliente on public.cache_venda_item (idcliente);
alter table public.cache_venda_item enable row level security;

create table if not exists public.cache_controle (nome text primary key, atualizado_ate timestamptz);
alter table public.cache_controle enable row level security;

create materialized view if not exists public.mv_produto_classe as select * from public.vw_produto_classe_base;
create unique index if not exists mv_produto_classe_pk on public.mv_produto_classe (idmercadoriavariacao);
create index if not exists mv_produto_classe_ncm on public.mv_produto_classe (ncm);

create or replace view public.vw_venda_item with (security_invoker = true) as select * from public.cache_venda_item;
create or replace view public.vw_produto_classe with (security_invoker = true) as select * from public.mv_produto_classe;
-- A primeira versão desta migração usava uma materialized view para as vendas (refazia tudo a cada vez).
drop materialized view if exists public.mv_venda_item;

-- Materialized view não tem RLS: fica fora da API pública; só a service_role (Worker) lê.
do $$
begin
  execute 'revoke all on public.mv_produto_classe from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.mv_produto_classe from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.mv_produto_classe from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant select on public.mv_produto_classe to service_role'; end if;
end $$;

-- Atualiza a base de vendas só com os documentos que mudaram (margem de 10 min para diferença de relógio
-- entre o Worker, que marca sync_seen_at, e o banco). Na primeira vez, carrega tudo.
create or replace function public.atualizar_vendas() returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  inicio timestamptz := clock_timestamp();
  desde timestamptz;
  n integer;
begin
  select atualizado_ate - interval '10 minutes' into desde from public.cache_controle where nome = 'venda_item';
  if desde is null then
    delete from public.cache_venda_item;
    insert into public.cache_venda_item select * from public.vw_venda_item_base;
    get diagnostics n = row_count;
  else
    create temp table if not exists _docs_alterados (id bigint primary key) on commit drop;
    insert into _docs_alterados
      select _iddocumento from public.erp_documento where sync_seen_at > desde
      union select _iddocumento from public.erp_documento_mercadoria where sync_seen_at > desde
      union select _iddocumento from public.erp_documento_mercadoria_custo where sync_seen_at > desde
      on conflict do nothing;
    delete from public.cache_venda_item c using _docs_alterados d where c.iddocumento = d.id;
    insert into public.cache_venda_item select b.* from public.vw_venda_item_base b join _docs_alterados d on d.id = b.iddocumento;
    get diagnostics n = row_count;
  end if;
  insert into public.cache_controle (nome, atualizado_ate) values ('venda_item', inicio)
    on conflict (nome) do update set atualizado_ate = excluded.atualizado_ate;
  return n;
end $$;

-- Tudo que é pronto, na ordem das dependências (vendas → classificação → curva ABC).
create or replace function public.atualizar_gestao() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform public.atualizar_vendas();
  refresh materialized view concurrently public.mv_produto_classe;
  refresh materialized view concurrently public.mv_produto_abc;
end $$;

-- Só a classificação: ao salvar uma regra de NCM ou de seção, a mudança aparece na hora.
create or replace function public.atualizar_classe() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  refresh materialized view concurrently public.mv_produto_classe;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.atualizar_vendas()', 'public.atualizar_gestao()', 'public.atualizar_classe()'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

-- Primeira carga da base de vendas (as próximas são incrementais).
select public.atualizar_vendas() where not exists (select 1 from public.cache_controle where nome = 'venda_item');

-- Margem de segurança: consultas do Worker (service_role) podem levar até 30 s (o padrão da API é 8 s).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'alter role service_role set statement_timeout = ''30s''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end $$;
