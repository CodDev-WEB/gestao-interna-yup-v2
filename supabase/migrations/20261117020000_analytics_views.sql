-- Camada analítica sobre o espelho do ERP (views). Idempotente (create or replace).
-- security_invoker: as views respeitam o RLS das tabelas erp_* (só a service_role lê).
--
-- Critérios de classificação dos documentos (os mesmos validados no Gestão à Vista):
--   Venda:     tipomovimento = 'S', tipomovimentofinanceiro = 'R', status = 'E'
--   Devolução: modelo = 'TM', tipomovimento = 'E', tipomovimentofinanceiro = 'P', status = 'E'
--   Compra:    tipomovimento = 'E', tipomovimentofinanceiro = 'P', status = 'E', modelo <> 'TM'  (VALIDAR com a loja)
-- Datas em hora local da loja (America/Belem).

-- Itens vendidos, com custo da operação e lucro bruto.
create or replace view public.vw_venda_item with (security_invoker = true) as
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

-- Itens devolvidos por clientes.
create or replace view public.vw_devolucao_item with (security_invoker = true) as
select d._iddocumento as iddocumento, dm._idsequencia as idsequencia, d.idempresa, d.datahora,
       (d.datahora at time zone 'America/Belem')::date as data,
       d.idpessoa as idcliente, dm.idpessoafuncionario, dm.idmercadoriavariacao, dm.descricao,
       dm.qtd, dm.valtotalliquido
  from public.erp_documento d
  join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
 where d.modelo = 'TM' and d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' and d.status = 'E';

-- Itens comprados de fornecedores.
create or replace view public.vw_compra_item with (security_invoker = true) as
select d._iddocumento as iddocumento, dm._idsequencia as idsequencia, d.idempresa, d.datahora,
       (d.datahora at time zone 'America/Belem')::date as data,
       d.idpessoa as idfornecedor, d.idnaturezaoperacao, dm.idmercadoria, dm.idmercadoriavariacao, dm.descricao,
       dm.qtd, dm.qtdestoque, dm.valunitarioliquido, dm.valtotalliquido,
       c.valcusto as custo_unitario, dm.lote, dm.dtvalidade
  from public.erp_documento d
  join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
  left join public.erp_documento_mercadoria_custo c on c._iddocumento = dm._iddocumento and c._idsequencia = dm._idsequencia
 where d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' and d.status = 'E' and coalesce(d.modelo, '') <> 'TM';

-- Resultado diário: faturamento, devoluções, custo, lucro, margem, ticket médio.
create or replace view public.vw_venda_diaria with (security_invoker = true) as
with v as (
  select idempresa, data,
         count(distinct iddocumento)                    as vendas,
         sum(valtotalliquido)                           as faturamento,
         sum(valdesconto)                               as descontos,
         sum(custo_total)                               as custo,
         sum(lucro_bruto)                               as lucro,
         count(*) filter (where custo_unitario is null) as itens_sem_custo
    from public.vw_venda_item group by idempresa, data),
dv as (
  select idempresa, data, sum(valtotalliquido) as devolucoes from public.vw_devolucao_item group by idempresa, data)
select coalesce(v.idempresa, dv.idempresa)                       as idempresa,
       coalesce(v.data, dv.data)                                 as data,
       coalesce(v.vendas, 0)                                     as vendas,
       coalesce(v.faturamento, 0)                                as faturamento_bruto,
       coalesce(dv.devolucoes, 0)                                as devolucoes,
       coalesce(v.faturamento, 0) - coalesce(dv.devolucoes, 0)   as faturamento_liquido,
       coalesce(v.descontos, 0)                                  as descontos,
       v.custo,
       v.lucro                                                   as lucro_bruto,
       round(v.lucro * 100 / nullif(v.faturamento, 0), 2)        as margem_pct,
       round((coalesce(v.faturamento, 0) - coalesce(dv.devolucoes, 0)) / nullif(v.vendas, 0), 2) as ticket_medio,
       coalesce(v.itens_sem_custo, 0)                            as itens_sem_custo
  from v full join dv on dv.idempresa = v.idempresa and dv.data = v.data;

-- Desempenho e situação de cada variação (estoque parado, sem saída, excesso, ruptura).
create or replace view public.vw_produto_desempenho with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
est as (select _idmercadoriavariacao as id, sum(qtdsaldo) as qtd
          from public.erp_mercadoria_estoque where sync_deleted_at is null group by 1),
custo as (select _idmercadoriavariacao as id, avg(coalesce(nullif(valcustomedio, 0), valcusto)) as custo
            from public.erp_mercadoria_custo where sync_deleted_at is null group by 1),
vend as (select vi.idmercadoriavariacao as id,
                min(vi.data) as primeira_venda, max(vi.data) as ultima_venda, sum(vi.qtd) as qtd_total,
                sum(vi.qtd) filter (where vi.data > hoje.d - 30)             as qtd_30d,
                sum(vi.qtd) filter (where vi.data > hoje.d - 90)             as qtd_90d,
                sum(vi.valtotalliquido) filter (where vi.data > hoje.d - 90) as fat_90d,
                sum(vi.lucro_bruto) filter (where vi.data > hoje.d - 90)     as lucro_90d
           from public.vw_venda_item vi cross join hoje group by 1),
comp as (select idmercadoriavariacao as id, min(data) as primeira_entrada, max(data) as ultima_entrada, sum(qtd) as qtd_comprada
           from public.vw_compra_item group by 1),
base as (
  select v._idmercadoriavariacao as idmercadoriavariacao, v.idmercadoria,
         coalesce(v.descricao, m.descricao) as descricao, v.codigobarras,
         m.idsecao, s.descricao as secao, m.idgrupo, g.descricao as grupo,
         coalesce(cfg.setor, 'Não classificado') as setor,
         coalesce(est.qtd, 0) as estoque_atual, custo.custo as custo_unitario,
         comp.primeira_entrada, comp.ultima_entrada, coalesce(comp.qtd_comprada, 0) as qtd_comprada,
         vend.primeira_venda, vend.ultima_venda,
         coalesce(vend.qtd_total, 0) as qtd_vendida_total, coalesce(vend.qtd_30d, 0) as qtd_30d,
         coalesce(vend.qtd_90d, 0) as qtd_90d, coalesce(vend.fat_90d, 0) as faturamento_90d, vend.lucro_90d,
         hoje.d as hoje
    from public.erp_mercadoria_variacao v
    cross join hoje
    left join public.erp_mercadoria m on m._idmercadoria = v.idmercadoria
    left join public.erp_mercadoria_secao s on s._idsecao = m.idsecao
    left join public.erp_mercadoria_grupo g on g._idgrupo = m.idgrupo
    left join public.cfg_secao_setor cfg on cfg.idsecao = m.idsecao
    left join est on est.id = v._idmercadoriavariacao
    left join custo on custo.id = v._idmercadoriavariacao
    left join vend on vend.id = v._idmercadoriavariacao
    left join comp on comp.id = v._idmercadoriavariacao
   where v.sync_deleted_at is null)
select b.idmercadoriavariacao, b.idmercadoria, b.descricao, b.codigobarras, b.idsecao, b.secao, b.idgrupo, b.grupo, b.setor,
       b.estoque_atual, b.custo_unitario,
       round(greatest(b.estoque_atual, 0) * b.custo_unitario, 2)       as valor_estoque,
       b.primeira_entrada, b.ultima_entrada, b.qtd_comprada, b.primeira_venda, b.ultima_venda,
       b.qtd_vendida_total, b.qtd_30d, b.qtd_90d, b.faturamento_90d, b.lucro_90d,
       round(b.lucro_90d * 100 / nullif(b.faturamento_90d, 0), 2)      as margem_90d_pct,
       b.hoje - coalesce(b.ultima_venda, b.primeira_entrada)           as dias_sem_venda,
       round(b.qtd_90d / 90.0, 4)                                      as venda_media_diaria,
       round(b.estoque_atual / nullif(b.qtd_90d / 90.0, 0), 1)         as cobertura_dias,
       case
         when b.ultima_venda is null and b.primeira_entrada is not null and b.estoque_atual > 0 then 'sem_saida_historica'
         when b.ultima_venda is null then 'sem_movimento'
         when b.estoque_atual <= 0 and b.qtd_30d > 0 then 'ruptura'
         when b.estoque_atual > 0 and b.hoje - b.ultima_venda > 90 then 'parado'
         when b.estoque_atual > 0 and b.hoje - b.ultima_venda > 30 then 'baixa_movimentacao'
         when b.qtd_90d > 0 and b.estoque_atual / (b.qtd_90d / 90.0) > 120 then 'excesso_estoque'
         else 'saudavel'
       end as situacao
  from base b;

-- Lotes com saldo: prazo para vencer, valor em risco e se a venda média esgota antes do vencimento.
create or replace view public.vw_lote_validade with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
custo as (select _idmercadoriavariacao as id, avg(coalesce(nullif(valcustomedio, 0), valcusto)) as custo
            from public.erp_mercadoria_custo where sync_deleted_at is null group by 1),
media as (select vi.idmercadoriavariacao as id, sum(vi.qtd) / 90.0 as diaria
            from public.vw_venda_item vi cross join hoje where vi.data > hoje.d - 90 group by 1)
select l._idempresa as idempresa, l._idlocalestoque as idlocalestoque, l._idmercadoriavariacao as idmercadoriavariacao,
       v.descricao, l._lote as lote, l._dtvalidade as dtvalidade, l._dtentrada as dtentrada, l.qtdsaldo,
       l._dtvalidade - hoje.d as dias_para_vencer,
       case when l._dtvalidade < hoje.d then 'vencido'
            when l._dtvalidade - hoje.d <= 7 then 'critico_7d'
            when l._dtvalidade - hoje.d <= 30 then 'alto_30d'
            when l._dtvalidade - hoje.d <= 60 then 'atencao_60d'
            when l._dtvalidade - hoje.d <= 90 then 'monitorar_90d'
            else 'normal' end as faixa,
       custo.custo as custo_unitario,
       round(l.qtdsaldo * custo.custo, 2) as valor_em_risco,
       round(media.diaria, 4) as venda_media_diaria,
       ceil(l.qtdsaldo / nullif(media.diaria, 0)) as dias_para_vender,
       (l._dtvalidade < hoje.d or coalesce(media.diaria, 0) = 0 or l.qtdsaldo / media.diaria > (l._dtvalidade - hoje.d)) as risco_perda
  from public.erp_mercadoria_estoque_lote l
  cross join hoje
  left join public.erp_mercadoria_variacao v on v._idmercadoriavariacao = l._idmercadoriavariacao
  left join custo on custo.id = l._idmercadoriavariacao
  left join media on media.id = l._idmercadoriavariacao
 where l.sync_deleted_at is null and l.qtdsaldo > 0;

-- Fornecedores: total comprado, frequência, ticket médio, participação.
create or replace view public.vw_fornecedor_resumo with (security_invoker = true) as
with c as (select * from public.vw_compra_item),
tot as (select sum(valtotalliquido) as total from c)
select c.idfornecedor, p.nome,
       sum(c.valtotalliquido)                                                   as total_comprado,
       count(distinct c.iddocumento)                                            as compras,
       round(sum(c.valtotalliquido) / nullif(count(distinct c.iddocumento), 0), 2) as ticket_medio,
       count(distinct c.idmercadoriavariacao)                                   as skus,
       min(c.data)                                                              as primeira_compra,
       max(c.data)                                                              as ultima_compra,
       round(sum(c.valtotalliquido) * 100 / nullif(max(tot.total), 0), 2)       as participacao_pct
  from c cross join tot
  left join public.erp_pessoa p on p._idpessoa = c.idfornecedor
 group by c.idfornecedor, p.nome;

-- Preço de compra por fornecedor e variação: menor, maior, médio ponderado, último e variação.
create or replace view public.vw_fornecedor_preco_item with (security_invoker = true) as
with c as (select idfornecedor, idmercadoriavariacao, descricao, data, iddocumento, qtd, valtotalliquido,
                  valtotalliquido / qtd as preco
             from public.vw_compra_item where qtd > 0),
r as (select c.*, row_number() over (partition by idfornecedor, idmercadoriavariacao order by data desc, iddocumento desc) as rn from c)
select idfornecedor, idmercadoriavariacao, max(descricao) as descricao, count(*) as compras,
       round(min(preco), 4) as menor_preco, round(max(preco), 4) as maior_preco,
       round(sum(valtotalliquido) / nullif(sum(qtd), 0), 4) as preco_medio_ponderado,
       round(max(preco) filter (where rn = 1), 4) as ultimo_preco,
       round(max(preco) filter (where rn = 2), 4) as penultimo_preco,
       round((max(preco) filter (where rn = 1) / nullif(max(preco) filter (where rn = 2), 0) - 1) * 100, 2) as variacao_ultima_pct,
       max(data) as ultima_compra
  from r group by idfornecedor, idmercadoriavariacao;

-- Setores por mês, com crescimento sobre o mês anterior.
create or replace view public.vw_setor_mensal with (security_invoker = true) as
with m as (
  select date_trunc('month', vi.data)::date as mes, coalesce(cfg.setor, 'Não classificado') as setor,
         sum(vi.valtotalliquido) as faturamento, sum(vi.lucro_bruto) as lucro, sum(vi.qtd) as qtd,
         count(distinct vi.iddocumento) as vendas
    from public.vw_venda_item vi
    left join public.cfg_secao_setor cfg on cfg.idsecao = vi.idsecao
   group by 1, 2)
select mes, setor, faturamento, lucro, round(lucro * 100 / nullif(faturamento, 0), 2) as margem_pct, qtd, vendas,
       lag(faturamento) over w as faturamento_mes_anterior,
       round((faturamento / nullif(lag(faturamento) over w, 0) - 1) * 100, 2) as crescimento_pct
  from m window w as (partition by setor order by mes);

-- Clientes: RFM, recorrência e próxima compra prevista.
create or replace view public.vw_cliente_rfm with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
v as (select idcliente, iddocumento, data, sum(valtotalliquido) as valor
        from public.vw_venda_item where idcliente is not null and idcliente > 0 group by 1, 2, 3),
c as (select idcliente, count(*) as compras, sum(valor) as valor_total, min(data) as primeira, max(data) as ultima from v group by 1),
s as (select c.*, hoje.d - c.ultima as recencia_dias,
             case when c.compras > 1 then round((c.ultima - c.primeira)::numeric / (c.compras - 1), 1) end as intervalo_medio_dias,
             ntile(5) over (order by c.ultima)      as r_score,
             ntile(5) over (order by c.compras)     as f_score,
             ntile(5) over (order by c.valor_total) as m_score
        from c cross join hoje)
select s.idcliente, p.nome, s.compras, s.valor_total, round(s.valor_total / s.compras, 2) as ticket_medio,
       s.primeira as primeira_compra, s.ultima as ultima_compra, s.recencia_dias, s.intervalo_medio_dias,
       s.ultima + round(s.intervalo_medio_dias)::integer as proxima_compra_prevista,
       s.r_score, s.f_score, s.m_score,
       case
         when s.recencia_dias > 180 then 'inativo'
         when s.intervalo_medio_dias is not null and s.recencia_dias > greatest(2 * s.intervalo_medio_dias, 30) then 'em_risco'
         when s.m_score = 5 and s.f_score >= 4 then 'vip'
         when s.compras = 1 and s.recencia_dias <= 30 then 'novo'
         when s.compras > 1 then 'recorrente'
         else 'ocasional'
       end as segmento
  from s left join public.erp_pessoa p on p._idpessoa = s.idcliente;

-- Produtos com queda de vendas nos últimos 3 meses fechados (com estoque, para separar queda de ruptura).
create or replace view public.vw_produto_declinio with (security_invoker = true) as
with ref as (select date_trunc('month', now() at time zone 'America/Belem')::date as mes_atual),
m as (select vi.idmercadoriavariacao as id,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '3 months')::date and vi.data < (ref.mes_atual - interval '2 months')::date) as m3,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '2 months')::date and vi.data < (ref.mes_atual - interval '1 month')::date)  as m2,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '1 month')::date and vi.data < ref.mes_atual)                               as m1
        from public.vw_venda_item vi cross join ref
       where vi.data >= (ref.mes_atual - interval '3 months')::date and vi.data < ref.mes_atual
       group by 1),
est as (select _idmercadoriavariacao as id, sum(qtdsaldo) as qtd from public.erp_mercadoria_estoque where sync_deleted_at is null group by 1)
select m.id as idmercadoriavariacao, v.descricao,
       coalesce(m.m3, 0) as qtd_3_meses_atras, coalesce(m.m2, 0) as qtd_2_meses_atras, coalesce(m.m1, 0) as qtd_mes_passado,
       round((coalesce(m.m1, 0) / nullif(m.m3, 0) - 1) * 100, 2) as variacao_pct,
       (coalesce(m.m3, 0) > coalesce(m.m2, 0) and coalesce(m.m2, 0) > coalesce(m.m1, 0)) as queda_consecutiva,
       coalesce(est.qtd, 0) as estoque_atual
  from m
  left join public.erp_mercadoria_variacao v on v._idmercadoriavariacao = m.id
  left join est on est.id = m.id;

-- Painel de pontos a atacar: uma linha com os números principais.
create or replace view public.vw_resumo_gestao with (security_invoker = true) as
select
  (select round(sum(valor_estoque), 2) from public.vw_produto_desempenho)                                                   as valor_estoque_total,
  (select round(sum(valor_estoque), 2) from public.vw_produto_desempenho where situacao in ('parado', 'sem_saida_historica')) as capital_parado,
  (select count(*) from public.vw_produto_desempenho where situacao = 'sem_saida_historica')                                 as produtos_sem_saida,
  (select count(*) from public.vw_produto_desempenho where situacao = 'parado')                                              as produtos_parados,
  (select count(*) from public.vw_produto_desempenho where situacao = 'excesso_estoque')                                     as produtos_excesso,
  (select count(*) from public.vw_produto_desempenho where situacao = 'ruptura')                                             as produtos_ruptura,
  (select round(sum(valor_em_risco), 2) from public.vw_lote_validade where risco_perda)                                      as valor_lotes_em_risco,
  (select count(*) from public.vw_lote_validade where faixa in ('vencido', 'critico_7d'))                                    as lotes_criticos,
  (select count(*) from public.vw_fornecedor_preco_item where variacao_ultima_pct >= 10)                                     as itens_aumento_custo_10pct,
  (select count(*) from public.vw_cliente_rfm where segmento = 'em_risco')                                                   as clientes_em_risco,
  (select count(*) from public.vw_produto_declinio where queda_consecutiva and estoque_atual > 0)                            as produtos_em_declinio;
