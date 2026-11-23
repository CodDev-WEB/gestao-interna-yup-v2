-- Mantém estoque, preço e cancelamentos alinhados com as vendas entre uma leitura completa e outra.
-- As vendas chegam a cada poucos minutos, mas o saldo de estoque inteiro leva ~1 h para ser relido (preço, 1 vez
-- por dia). Enquanto isso, o que já foi vendido ainda aparecia no estoque. Os históricos do ERP (movimento de
-- estoque, mudança de preço, cancelamento) chegam junto com as vendas; esta função aplica o que for mais novo:
--   - saldo: último movimento de cada item/local, se for mais recente que o saldo gravado;
--   - preço: última mudança de preço de cada item/tabela, se for mais recente que o preço gravado;
--   - cancelamento: documento cancelado depois de lido passa a constar como cancelado (status C).
-- A próxima leitura completa do ERP confirma ou corrige. Chamada pelo Worker depois de cada sincronização. Idempotente.

create or replace function public.alinhar_espelho() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare n_estoque int; n_preco int; n_cancel int;
begin
  with h as (
    select distinct on (d.idempresa, h._idlocalestoque, h.idmercadoriavariacao)
           d.idempresa, h._idlocalestoque as loc, h.idmercadoriavariacao as v, h.datahora, h.qtdnovosaldo
      from public.erp_mercadoria_estoque_historico h
      join public.erp_documento d on d._iddocumento = h._iddocumento
     where h.datahora > now() - interval '3 days' and h.idmercadoriavariacao is not null and h.qtdnovosaldo is not null
     order by d.idempresa, h._idlocalestoque, h.idmercadoriavariacao, h.datahora desc, h._idhistorico desc)
  update public.erp_mercadoria_estoque e
     set qtdsaldo = h.qtdnovosaldo, datahora = h.datahora
    from h
   where e._idempresa = h.idempresa and e._idlocalestoque = h.loc and e._idmercadoriavariacao = h.v
     and e.sync_deleted_at is null and (e.datahora is null or h.datahora > e.datahora);
  get diagnostics n_estoque = row_count;

  with t as (
    select distinct on (_idempresa, _idmercadoriavariacao, _idtabela) _idempresa, _idmercadoriavariacao, _idtabela, datahora, valpreconovo
      from public.erp_mercadoria_tabela_preco_historico
     where datahora > now() - interval '3 days' and valpreconovo is not null
     order by _idempresa, _idmercadoriavariacao, _idtabela, datahora desc, _idhistorico desc)
  update public.erp_mercadoria_tabela_preco p
     set valpreco = t.valpreconovo, dtalteracao = t.datahora
    from t
   where p._idempresa = t._idempresa and p._idmercadoriavariacao = t._idmercadoriavariacao and p._idtabela = t._idtabela
     and p.sync_deleted_at is null and (p.dtalteracao is null or t.datahora > p.dtalteracao);
  get diagnostics n_preco = row_count;

  update public.erp_documento d
     set status = 'C', sync_seen_at = now()
    from public.erp_documento_cancelamento_historico c
   where c._iddocumento = d._iddocumento and d.status is distinct from 'C'
     and c.datahora > now() - interval '30 days' and c.datahora > d.sync_seen_at;
  get diagnostics n_cancel = row_count;

  return jsonb_build_object('estoque', n_estoque, 'precos', n_preco, 'cancelamentos', n_cancel);
end $$;

revoke execute on function public.alinhar_espelho() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.alinhar_espelho() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function public.alinhar_espelho() from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.alinhar_espelho() to service_role'; end if;
end $$;
