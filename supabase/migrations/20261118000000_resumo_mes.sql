-- Resumo do mês: compras para o estoque, vendas, rankings e comparativos, calculados no banco
-- (uma chamada /rpc/resumo_mes devolve tudo). Idempotente. Datas na hora local da loja (America/Belem).
-- Os filtros usam datahora (indexada) para não varrer o histórico inteiro.

-- Indicadores de um intervalo [ini, fim) — usados no mês, nos comparativos e no histórico.
create or replace function public.resumo_kpis(p_ini date, p_fim date) returns jsonb
language sql stable security invoker set search_path = public as $$
  with lim as (select (p_ini::timestamp at time zone 'America/Belem') as a, (p_fim::timestamp at time zone 'America/Belem') as b),
  v as (select vi.* from vw_venda_item vi, lim where vi.datahora >= lim.a and vi.datahora < lim.b),
  dv as (select di.* from vw_devolucao_item di, lim where di.datahora >= lim.a and di.datahora < lim.b),
  c as (select ci.* from vw_compra_item ci, lim where ci.datahora >= lim.a and ci.datahora < lim.b),
  sv as (select count(distinct iddocumento) as vendas, coalesce(sum(valtotalbruto), 0) as bruto, coalesce(sum(valdesconto), 0) as descontos,
                coalesce(sum(valtotalliquido), 0) as faturamento, coalesce(sum(custo_total), 0) as custo, coalesce(sum(lucro_bruto), 0) as lucro,
                coalesce(sum(qtd), 0) as itens, count(distinct idmercadoriavariacao) as produtos,
                count(distinct idcliente) filter (where coalesce(idcliente, 0) > 0) as clientes,
                count(distinct iddocumento) filter (where coalesce(idcliente, 0) = 0) as vendas_sem_cliente,
                count(*) filter (where custo_unitario is null) as itens_sem_custo,
                coalesce(sum(valtotalliquido) filter (where custo_unitario is null), 0) as faturamento_sem_custo,
                count(distinct data) as dias_com_venda
           from v),
  sd as (select coalesce(sum(valtotalliquido), 0) as devolucoes, count(distinct iddocumento) as qtd_devolucoes from dv),
  sc as (select coalesce(sum(valtotalliquido), 0) as compras, count(distinct iddocumento) as notas, coalesce(sum(qtd), 0) as itens,
                count(distinct idmercadoriavariacao) as produtos, count(distinct idfornecedor) as fornecedores from c)
  select jsonb_build_object(
    'vendas', sv.vendas, 'faturamento_bruto', round(sv.bruto, 2), 'descontos', round(sv.descontos, 2),
    'faturamento', round(sv.faturamento, 2), 'devolucoes', round(sd.devolucoes, 2), 'qtd_devolucoes', sd.qtd_devolucoes,
    'faturamento_liquido', round(sv.faturamento - sd.devolucoes, 2),
    'custo_vendas', round(sv.custo, 2), 'lucro', round(sv.lucro, 2),
    'margem_pct', round(sv.lucro * 100 / nullif(sv.faturamento - sv.faturamento_sem_custo, 0), 2),
    'markup_pct', round(sv.lucro * 100 / nullif(sv.custo, 0), 2),
    'ticket_medio', round((sv.faturamento - sd.devolucoes) / nullif(sv.vendas, 0), 2),
    'itens_vendidos', round(sv.itens, 3), 'itens_por_venda', round(sv.itens / nullif(sv.vendas, 0), 2),
    'produtos_vendidos', sv.produtos, 'clientes', sv.clientes, 'vendas_sem_cliente', sv.vendas_sem_cliente,
    'pct_vendas_identificadas', round((sv.vendas - sv.vendas_sem_cliente) * 100.0 / nullif(sv.vendas, 0), 2),
    'pct_desconto', round(sv.descontos * 100 / nullif(sv.bruto, 0), 2),
    'pct_devolucao', round(sd.devolucoes * 100 / nullif(sv.faturamento, 0), 2),
    'itens_sem_custo', sv.itens_sem_custo, 'dias_com_venda', sv.dias_com_venda,
    'compras', round(sc.compras, 2), 'notas_compra', sc.notas, 'itens_comprados', round(sc.itens, 3),
    'produtos_comprados', sc.produtos, 'fornecedores', sc.fornecedores,
    'compras_sobre_custo_pct', round(sc.compras * 100 / nullif(sv.custo, 0), 2),
    'compras_sobre_faturamento_pct', round(sc.compras * 100 / nullif(sv.faturamento - sd.devolucoes, 0), 2))
  from sv, sd, sc;
$$;

-- Resumo completo do mês de p_mes (qualquer dia do mês serve).
create or replace function public.resumo_mes(p_mes date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  ini date := date_trunc('month', p_mes)::date;
  fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
  hoje date := (now() at time zone 'America/Belem')::date;
  a timestamptz := (date_trunc('month', p_mes)::timestamp at time zone 'America/Belem');
  b timestamptz := ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Belem');
  k jsonb;
  out jsonb;
begin
  k := resumo_kpis(ini, fim);

  with v as (select * from vw_venda_item where datahora >= a and datahora < b),
  c as (select * from vw_compra_item where datahora >= a and datahora < b),
  tot as (select nullif(sum(valtotalliquido), 0) as fat from v),
  totc as (select nullif(sum(valtotalliquido), 0) as comp from c),
  nome as (select idmercadoriavariacao as id, nome from vw_variacao_nome),
  -- Produto mais vendido: valor, quantidade, lucro e participação.
  prod as (select v.idmercadoriavariacao as id, sum(v.qtd) as qtd, sum(v.valtotalliquido) as faturamento, sum(v.lucro_bruto) as lucro,
                  count(distinct v.iddocumento) as vendas, count(*) filter (where v.custo_unitario is null) as sem_custo
             from v group by 1),
  prod_out as (select p.*, n.nome from prod p left join nome n on n.id = p.id),
  comp as (select c.idmercadoriavariacao as id, sum(c.qtd) as qtd, sum(c.valtotalliquido) as valor, count(distinct c.iddocumento) as notas
             from c group by 1),
  -- Fornecedor de cada produto vendido: o da compra mais recente; sem compra, o primeiro cadastrado.
  ult_compra as (select distinct on (idmercadoriavariacao) idmercadoriavariacao as id, idfornecedor
                   from vw_compra_item where coalesce(idfornecedor, 0) > 0 order by idmercadoriavariacao, datahora desc),
  cad_forn as (select _idmercadoriavariacao as id, min(_idpessoa) as idfornecedor from erp_mercadoria_fornecedor where sync_deleted_at is null group by 1),
  forn_prod as (select p.id, coalesce(u.idfornecedor, f.idfornecedor) as idfornecedor
                  from prod p left join ult_compra u on u.id = p.id left join cad_forn f on f.id = p.id),
  pessoa as (select _idpessoa as id, nullif(trim(concat_ws(' ', vazio_null(nome), vazio_null(sobrenome))), '') as nome from erp_pessoa),
  secao as (select vi.idsecao, s.descricao, coalesce(cfg.setor, 'Não classificado') as setor, vi.valtotalliquido, vi.lucro_bruto, vi.qtd, vi.iddocumento
              from v vi left join erp_mercadoria_secao s on s._idsecao = vi.idsecao left join cfg_secao_setor cfg on cfg.idsecao = vi.idsecao)
  select jsonb_build_object(
    'top_faturamento', coalesce((select jsonb_agg(x order by x.faturamento desc) from (
        select id, nome, round(qtd, 3) as qtd, round(faturamento, 2) as faturamento, round(lucro, 2) as lucro, vendas,
               round(lucro * 100 / nullif(faturamento, 0), 2) as margem_pct, round(faturamento * 100 / (select fat from tot), 2) as pct
          from prod_out order by faturamento desc nulls last limit 15) x), '[]'),
    'top_quantidade', coalesce((select jsonb_agg(x order by x.qtd desc) from (
        select id, nome, round(qtd, 3) as qtd, round(faturamento, 2) as faturamento, round(lucro, 2) as lucro, vendas,
               round(lucro * 100 / nullif(faturamento, 0), 2) as margem_pct, round(faturamento * 100 / (select fat from tot), 2) as pct
          from prod_out order by qtd desc nulls last limit 15) x), '[]'),
    'top_lucro', coalesce((select jsonb_agg(x order by x.lucro desc) from (
        select id, nome, round(qtd, 3) as qtd, round(faturamento, 2) as faturamento, round(lucro, 2) as lucro, vendas,
               round(lucro * 100 / nullif(faturamento, 0), 2) as margem_pct, round(faturamento * 100 / (select fat from tot), 2) as pct
          from prod_out where sem_custo = 0 order by lucro desc nulls last limit 15) x), '[]'),
    'top_comprados', coalesce((select jsonb_agg(x order by x.valor desc) from (
        select c.id, n.nome, round(c.qtd, 3) as qtd, round(c.valor, 2) as valor, c.notas,
               round(c.valor / nullif(c.qtd, 0), 4) as custo_medio, round(c.valor * 100 / (select comp from totc), 2) as pct
          from comp c left join nome n on n.id = c.id order by c.valor desc nulls last limit 15) x), '[]'),
    'fornecedores_compra', coalesce((select jsonb_agg(x order by x.valor desc) from (
        select c.idfornecedor as id, coalesce(pe.nome, 'Fornecedor ' || c.idfornecedor) as nome, round(sum(c.valtotalliquido), 2) as valor,
               count(distinct c.iddocumento) as notas, count(distinct c.idmercadoriavariacao) as produtos,
               round(sum(c.valtotalliquido) * 100 / (select comp from totc), 2) as pct
          from c left join pessoa pe on pe.id = c.idfornecedor group by c.idfornecedor, pe.nome order by 3 desc nulls last limit 10) x), '[]'),
    'fornecedores_venda', coalesce((select jsonb_agg(x order by x.faturamento desc) from (
        select fp.idfornecedor as id, coalesce(pe.nome, case when fp.idfornecedor is null then 'Sem fornecedor identificado' else 'Fornecedor ' || fp.idfornecedor end) as nome,
               round(sum(p.faturamento), 2) as faturamento, round(sum(p.lucro), 2) as lucro, count(*) as produtos, round(sum(p.qtd), 3) as qtd,
               round(sum(p.lucro) * 100 / nullif(sum(p.faturamento), 0), 2) as margem_pct, round(sum(p.faturamento) * 100 / (select fat from tot), 2) as pct
          from prod p join forn_prod fp on fp.id = p.id left join pessoa pe on pe.id = fp.idfornecedor
         group by fp.idfornecedor, pe.nome order by 3 desc nulls last limit 10) x), '[]'),
    'setores', coalesce((select jsonb_agg(x order by x.faturamento desc) from (
        select setor, round(sum(valtotalliquido), 2) as faturamento, round(sum(lucro_bruto), 2) as lucro, count(distinct iddocumento) as vendas,
               round(sum(lucro_bruto) * 100 / nullif(sum(valtotalliquido), 0), 2) as margem_pct, round(sum(valtotalliquido) * 100 / (select fat from tot), 2) as pct
          from secao group by setor) x), '[]'),
    'secoes', coalesce((select jsonb_agg(x order by x.faturamento desc) from (
        select coalesce(descricao, 'Sem seção') as secao, setor, round(sum(valtotalliquido), 2) as faturamento, round(sum(lucro_bruto), 2) as lucro,
               round(sum(qtd), 3) as qtd, round(sum(lucro_bruto) * 100 / nullif(sum(valtotalliquido), 0), 2) as margem_pct,
               round(sum(valtotalliquido) * 100 / (select fat from tot), 2) as pct
          from secao group by descricao, setor order by 3 desc nulls last limit 12) x), '[]'),
    'vendedores', coalesce((select jsonb_agg(x order by x.faturamento desc) from (
        select v.idpessoafuncionario as id, coalesce(pe.nome, case when coalesce(v.idpessoafuncionario, 0) = 0 then 'Sem vendedor' else 'Vendedor ' || v.idpessoafuncionario end) as nome,
               round(sum(v.valtotalliquido), 2) as faturamento, count(distinct v.iddocumento) as vendas, round(sum(v.lucro_bruto), 2) as lucro,
               round(sum(v.valtotalliquido) / nullif(count(distinct v.iddocumento), 0), 2) as ticket_medio,
               round(sum(v.valtotalliquido) * 100 / (select fat from tot), 2) as pct
          from v left join pessoa pe on pe.id = v.idpessoafuncionario group by v.idpessoafuncionario, pe.nome order by 3 desc nulls last limit 10) x), '[]'),
    'por_dia', coalesce((select jsonb_agg(x order by x.data) from (
        select d::date as data, coalesce(dv.faturamento, 0) as faturamento, coalesce(dv.lucro, 0) as lucro,
               coalesce(dv.vendas, 0) as vendas, coalesce(dc.compras, 0) as compras
          from generate_series(ini, fim - 1, interval '1 day') d
          left join (select data, round(sum(valtotalliquido), 2) as faturamento, round(sum(lucro_bruto), 2) as lucro, count(distinct iddocumento) as vendas
                       from v group by data) dv on dv.data = d::date
          left join (select data, round(sum(valtotalliquido), 2) as compras from c group by data) dc on dc.data = d::date) x), '[]'),
    'dia_semana', coalesce((select jsonb_agg(x order by x.dow) from (
        select extract(isodow from data)::int as dow, round(sum(valtotalliquido), 2) as faturamento, count(distinct iddocumento) as vendas,
               count(distinct data) as dias, round(sum(valtotalliquido) / nullif(count(distinct data), 0), 2) as media_dia,
               round(sum(valtotalliquido) * 100 / (select fat from tot), 2) as pct
          from v group by 1) x), '[]'),
    'clientes_novos', (select count(*) from (select idcliente from vw_venda_item where coalesce(idcliente, 0) > 0 group by idcliente having min(datahora) >= a and min(datahora) < b) n)
  ) into out;

  return jsonb_build_object(
    'mes', to_char(ini, 'YYYY-MM'), 'inicio', ini, 'fim', fim - 1,
    'dias_no_mes', fim - ini,
    'dias_decorridos', case when hoje >= fim then fim - ini when hoje < ini then 0 else hoje - ini + 1 end,
    'em_andamento', hoje >= ini and hoje < fim,
    'kpis', k,
    'anterior', resumo_kpis((ini - interval '1 month')::date, ini),
    'ano_anterior', resumo_kpis((ini - interval '1 year')::date, (fim - interval '1 year')::date),
    'historico', (select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM')) || resumo_kpis(m::date, (m + interval '1 month')::date) order by m)
                    from generate_series(ini - interval '11 months', ini, interval '1 month') m)
  ) || out;
end $$;

-- Só a service_role (Worker) executa.
do $$
declare r text; f text;
begin
  foreach f in array array['public.resumo_kpis(date, date)', 'public.resumo_mes(date)'] loop
    execute format('revoke execute on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke execute on function %s from %I', f, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

-- Meses que têm movimento (para o seletor do site).
create or replace view public.vw_meses_movimento with (security_invoker = true) as
select to_char(date_trunc('month', datahora at time zone 'America/Belem'), 'YYYY-MM') as mes, count(*) as documentos
  from public.erp_documento
 where status = 'E'
 group by 1;
