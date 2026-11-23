-- Vendedoras: filtro por empresa (loja) e total de vendas sem contar duas vezes a venda com itens de duas
-- vendedoras. Também devolve o "faturamento" no critério do Gestão à Vista (líquido − devoluções).
-- Idempotente.

drop function if exists public.vendedoras_resumo(date, date);

create or replace function public.vendedoras_resumo(p_de date, p_ate date, p_empresa integer default null) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with equipe as (select distinct idpessoafuncionario as id from public.vw_venda_item where idpessoafuncionario is not null),
  base as (select * from public.vw_venda_item where data between p_de and p_ate and (p_empresa is null or idempresa = p_empresa)),
  v as (
    select coalesce(idpessoafuncionario, 0) as id, count(distinct iddocumento) as vendas, count(*) as itens,
           sum(qtd) as qtd, sum(valtotalbruto) as bruto, sum(valdesconto) as desconto, sum(valtotalliquido) as liquido,
           sum(custo_total) as custo, sum(lucro_bruto) as lucro, count(distinct idcliente) as clientes,
           count(*) filter (where custo_total is null) as itens_sem_custo
      from base group by 1),
  dvi as (
    select d.idempresa, d._iddocumento, dm.idpessoafuncionario, dm.valtotalliquido
      from public.erp_documento d
      join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
     where d.modelo = 'TM' and d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' and d.status = 'E'
       and (d.datahora at time zone 'America/Belem')::date between p_de and p_ate
       and (p_empresa is null or d.idempresa = p_empresa)),
  dv as (select coalesce(idpessoafuncionario, 0) as id, count(distinct _iddocumento) as devolucoes, sum(valtotalliquido) as devolvido from dvi group by 1),
  cp as (
    select idcliente as id, count(distinct iddocumento) as compras, count(*) as itens_comprados,
           sum(valtotalliquido) as comprado, sum(valdesconto) as desconto_recebido
      from base where idcliente in (select id from equipe)
     group by 1),
  ids as (select id from v union select id from dv union select id from cp)
  select jsonb_build_object(
    'vendedoras', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ids.id,
               'nome', case when ids.id = 0 then 'Sem vendedora no item' else coalesce(nullif(trim(concat_ws(' ', p.nome, p.sobrenome)), ''), 'Pessoa ' || ids.id) end,
               'vendas', coalesce(v.vendas, 0), 'itens', coalesce(v.itens, 0), 'qtd', coalesce(v.qtd, 0),
               'bruto', coalesce(v.bruto, 0), 'desconto', coalesce(v.desconto, 0), 'liquido', coalesce(v.liquido, 0),
               'custo', coalesce(v.custo, 0), 'lucro', coalesce(v.lucro, 0), 'clientes', coalesce(v.clientes, 0),
               'itens_sem_custo', coalesce(v.itens_sem_custo, 0),
               'devolucoes', coalesce(dv.devolucoes, 0), 'devolvido', coalesce(dv.devolvido, 0),
               'compras', coalesce(cp.compras, 0), 'itens_comprados', coalesce(cp.itens_comprados, 0),
               'comprado', coalesce(cp.comprado, 0), 'desconto_recebido', coalesce(cp.desconto_recebido, 0)
             ) order by coalesce(v.liquido, 0) desc, ids.id), '[]'::jsonb)
        from ids
        left join v on v.id = ids.id
        left join dv on dv.id = ids.id
        left join cp on cp.id = ids.id
        left join public.erp_pessoa p on p._idpessoa = ids.id),
    -- Totais da loja: cada venda conta uma vez, mesmo com itens de duas vendedoras.
    'totais', jsonb_build_object(
      'vendas', (select count(distinct iddocumento) from base),
      'vendas_por_vendedora', (select coalesce(sum(vendas), 0) from v),
      'vendas_por_vendedora_dia', (select count(*) from (select distinct idpessoafuncionario, data, iddocumento from base where idpessoafuncionario > 0) q),
      'liquido', (select coalesce(sum(valtotalliquido), 0) from base),
      'devolvido', (select coalesce(sum(valtotalliquido), 0) from dvi),
      'devolucoes', (select count(distinct _iddocumento) from dvi)),
    'empresas', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from (
        select idempresa as id, count(distinct iddocumento) as vendas, sum(valtotalliquido) as liquido
          from public.vw_venda_item where data between p_de and p_ate group by 1) e)
  )
$$;

do $$
declare f text := 'public.vendedoras_resumo(date, date, integer)';
begin
  execute format('revoke execute on function %s from public', f);
  if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
end $$;
