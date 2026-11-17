-- Nome legível de cada variação. No ERP real a descrição da variação vem vazia ('') e o nome está na mercadoria.
-- Recria as views que mostram o nome (mesmas colunas, só muda a origem de "descricao"). Idempotente.

-- Texto sem espaços nas pontas, ou null se ficar vazio.
create or replace function public.vazio_null(t text) returns text language sql immutable as $$
  select case when length(trim(t)) > 0 then trim(t) end
$$;

create or replace view public.vw_variacao_nome with (security_invoker = true) as
select v._idmercadoriavariacao as idmercadoriavariacao, v.idmercadoria,
       coalesce(public.vazio_null(concat_ws(' ', public.vazio_null(m.descricao),
                  case when public.vazio_null(v.descricao) is distinct from public.vazio_null(m.descricao) then public.vazio_null(v.descricao) end)),
                'Variação ' || v._idmercadoriavariacao) as nome
  from public.erp_mercadoria_variacao v
  left join public.erp_mercadoria m on m._idmercadoria = v.idmercadoria;

create or replace view public.vw_produto_desempenho with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
est as (select _idmercadoriavariacao as id, sum(qtdsaldo) as qtd from public.erp_mercadoria_estoque where sync_deleted_at is null group by 1),
custo as (select _idmercadoriavariacao as id, avg(coalesce(nullif(valcustomedio, 0), valcusto)) as custo from public.erp_mercadoria_custo where sync_deleted_at is null group by 1),
vend as (select vi.idmercadoriavariacao as id, min(vi.data) as primeira_venda, max(vi.data) as ultima_venda, sum(vi.qtd) as qtd_total,
                sum(vi.qtd) filter (where vi.data > hoje.d - 30) as qtd_30d, sum(vi.qtd) filter (where vi.data > hoje.d - 90) as qtd_90d,
                sum(vi.valtotalliquido) filter (where vi.data > hoje.d - 90) as fat_90d, sum(vi.lucro_bruto) filter (where vi.data > hoje.d - 90) as lucro_90d
           from public.vw_venda_item vi cross join hoje group by 1),
comp as (select idmercadoriavariacao as id, min(data) as primeira_entrada, max(data) as ultima_entrada, sum(qtd) as qtd_comprada from public.vw_compra_item group by 1),
base as (
  select v._idmercadoriavariacao as idmercadoriavariacao, v.idmercadoria, n.nome as descricao, v.codigobarras,
         m.idsecao, s.descricao as secao, m.idgrupo, g.descricao as grupo, coalesce(cfg.setor, 'Não classificado') as setor,
         coalesce(est.qtd, 0) as estoque_atual, custo.custo as custo_unitario,
         comp.primeira_entrada, comp.ultima_entrada, coalesce(comp.qtd_comprada, 0) as qtd_comprada, vend.primeira_venda, vend.ultima_venda,
         coalesce(vend.qtd_total, 0) as qtd_vendida_total, coalesce(vend.qtd_30d, 0) as qtd_30d, coalesce(vend.qtd_90d, 0) as qtd_90d,
         coalesce(vend.fat_90d, 0) as faturamento_90d, vend.lucro_90d, hoje.d as hoje
    from public.erp_mercadoria_variacao v
    cross join hoje
    left join public.vw_variacao_nome n on n.idmercadoriavariacao = v._idmercadoriavariacao
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
       b.estoque_atual, b.custo_unitario, round(greatest(b.estoque_atual, 0) * b.custo_unitario, 2) as valor_estoque,
       b.primeira_entrada, b.ultima_entrada, b.qtd_comprada, b.primeira_venda, b.ultima_venda,
       b.qtd_vendida_total, b.qtd_30d, b.qtd_90d, b.faturamento_90d, b.lucro_90d,
       round(b.lucro_90d * 100 / nullif(b.faturamento_90d, 0), 2) as margem_90d_pct,
       b.hoje - coalesce(b.ultima_venda, b.primeira_entrada) as dias_sem_venda,
       round(b.qtd_90d / 90.0, 4) as venda_media_diaria,
       round(b.estoque_atual / nullif(b.qtd_90d / 90.0, 0), 1) as cobertura_dias,
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

create or replace view public.vw_lote_validade with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
custo as (select _idmercadoriavariacao as id, avg(coalesce(nullif(valcustomedio, 0), valcusto)) as custo from public.erp_mercadoria_custo where sync_deleted_at is null group by 1),
media as (select vi.idmercadoriavariacao as id, sum(vi.qtd) / 90.0 as diaria from public.vw_venda_item vi cross join hoje where vi.data > hoje.d - 90 group by 1)
select l._idempresa as idempresa, l._idlocalestoque as idlocalestoque, l._idmercadoriavariacao as idmercadoriavariacao,
       n.nome as descricao, l._lote as lote, l._dtvalidade as dtvalidade, l._dtentrada as dtentrada, l.qtdsaldo,
       l._dtvalidade - hoje.d as dias_para_vencer,
       case when l._dtvalidade < hoje.d then 'vencido' when l._dtvalidade - hoje.d <= 7 then 'critico_7d' when l._dtvalidade - hoje.d <= 30 then 'alto_30d'
            when l._dtvalidade - hoje.d <= 60 then 'atencao_60d' when l._dtvalidade - hoje.d <= 90 then 'monitorar_90d' else 'normal' end as faixa,
       custo.custo as custo_unitario, round(l.qtdsaldo * custo.custo, 2) as valor_em_risco, round(media.diaria, 4) as venda_media_diaria,
       ceil(l.qtdsaldo / nullif(media.diaria, 0)) as dias_para_vender,
       (l._dtvalidade < hoje.d or coalesce(media.diaria, 0) = 0 or l.qtdsaldo / media.diaria > (l._dtvalidade - hoje.d)) as risco_perda
  from public.erp_mercadoria_estoque_lote l
  cross join hoje
  left join public.vw_variacao_nome n on n.idmercadoriavariacao = l._idmercadoriavariacao
  left join custo on custo.id = l._idmercadoriavariacao
  left join media on media.id = l._idmercadoriavariacao
 where l.sync_deleted_at is null and l.qtdsaldo > 0;

create or replace view public.vw_fornecedor_preco_item with (security_invoker = true) as
with c as (select ci.idfornecedor, ci.idmercadoriavariacao, n.nome as descricao, ci.data, ci.iddocumento, ci.qtd, ci.valtotalliquido, ci.valtotalliquido / ci.qtd as preco
             from public.vw_compra_item ci left join public.vw_variacao_nome n on n.idmercadoriavariacao = ci.idmercadoriavariacao where ci.qtd > 0),
r as (select c.*, row_number() over (partition by idfornecedor, idmercadoriavariacao order by data desc, iddocumento desc) as rn from c)
select idfornecedor, idmercadoriavariacao, max(descricao) as descricao, count(*) as compras,
       round(min(preco), 4) as menor_preco, round(max(preco), 4) as maior_preco,
       round(sum(valtotalliquido) / nullif(sum(qtd), 0), 4) as preco_medio_ponderado,
       round(max(preco) filter (where rn = 1), 4) as ultimo_preco, round(max(preco) filter (where rn = 2), 4) as penultimo_preco,
       round((max(preco) filter (where rn = 1) / nullif(max(preco) filter (where rn = 2), 0) - 1) * 100, 2) as variacao_ultima_pct,
       max(data) as ultima_compra
  from r group by idfornecedor, idmercadoriavariacao;

create or replace view public.vw_produto_declinio with (security_invoker = true) as
with ref as (select date_trunc('month', now() at time zone 'America/Belem')::date as mes_atual),
m as (select vi.idmercadoriavariacao as id,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '3 months')::date and vi.data < (ref.mes_atual - interval '2 months')::date) as m3,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '2 months')::date and vi.data < (ref.mes_atual - interval '1 month')::date) as m2,
             sum(vi.qtd) filter (where vi.data >= (ref.mes_atual - interval '1 month')::date and vi.data < ref.mes_atual) as m1
        from public.vw_venda_item vi cross join ref
       where vi.data >= (ref.mes_atual - interval '3 months')::date and vi.data < ref.mes_atual group by 1),
est as (select _idmercadoriavariacao as id, sum(qtdsaldo) as qtd from public.erp_mercadoria_estoque where sync_deleted_at is null group by 1)
select m.id as idmercadoriavariacao, n.nome as descricao,
       coalesce(m.m3, 0) as qtd_3_meses_atras, coalesce(m.m2, 0) as qtd_2_meses_atras, coalesce(m.m1, 0) as qtd_mes_passado,
       round((coalesce(m.m1, 0) / nullif(m.m3, 0) - 1) * 100, 2) as variacao_pct,
       (coalesce(m.m3, 0) > coalesce(m.m2, 0) and coalesce(m.m2, 0) > coalesce(m.m1, 0)) as queda_consecutiva,
       coalesce(est.qtd, 0) as estoque_atual
  from m
  left join public.vw_variacao_nome n on n.idmercadoriavariacao = m.id
  left join est on est.id = m.id;
