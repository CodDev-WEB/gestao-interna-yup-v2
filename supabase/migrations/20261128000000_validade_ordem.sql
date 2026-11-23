-- Validades sempre na mesma ordem: o que vence primeiro aparece primeiro e os já vencidos ficam juntos no fim
-- (ou no filtro "Vencido"). Acrescenta a coluna vencido a vw_lote_disponivel para a API ordenar por ela. Idempotente.

create or replace view public.vw_lote_disponivel with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Belem')::date as d),
custo as (
  select _idmercadoriavariacao as id, avg(coalesce(nullif(valcustomedio, 0), valcusto)) as custo
    from public.erp_mercadoria_custo where sync_deleted_at is null group by 1),
media as (
  select vi.idmercadoriavariacao as id, sum(vi.qtd) / 90.0 as diaria
    from public.vw_venda_item vi cross join hoje where vi.data > hoje.d - 90 group by 1),
estoque as (
  select _idempresa as e, _idlocalestoque as loc, _idmercadoriavariacao as v, greatest(sum(qtdsaldo), 0) as disponivel
    from public.erp_mercadoria_estoque where sync_deleted_at is null group by 1, 2, 3),
lotes as (
  select l.*, coalesce(s.disponivel, 0) as estoque_item,
         -- Unidades dos lotes que vencem depois deste (ficam com o estoque antes dele).
         coalesce(sum(l.qtdsaldo) over (partition by l._idempresa, l._idlocalestoque, l._idmercadoriavariacao
                                        order by l._dtvalidade desc, l._dtentrada desc, l._lote desc
                                        rows between unbounded preceding and 1 preceding), 0) as depois
    from public.erp_mercadoria_estoque_lote l
    left join estoque s on s.e = l._idempresa and s.loc = l._idlocalestoque and s.v = l._idmercadoriavariacao
   where l.sync_deleted_at is null and l.qtdsaldo > 0),
disp as (
  select lotes.*, greatest(0, least(qtdsaldo, estoque_item - depois)) as disponivel from lotes),
acum as (
  -- Para o risco: tudo que vence até este lote (inclusive) precisa vender antes da validade dele.
  select disp.*, sum(disponivel) over (partition by _idempresa, _idlocalestoque, _idmercadoriavariacao
                                       order by _dtvalidade, _dtentrada, _lote rows between unbounded preceding and current row) as ate_aqui
    from disp where disponivel > 0)
select a._idempresa as idempresa,
       a._idlocalestoque as idlocalestoque,
       a._idmercadoriavariacao as idmercadoriavariacao,
       n.nome as descricao,
       a._lote as lote,
       a._dtvalidade as dtvalidade,
       a._dtentrada as dtentrada,
       a.disponivel as qtdsaldo,
       a._dtvalidade - hoje.d as dias_para_vencer,
       case when a._dtvalidade < hoje.d then 'vencido'
            when a._dtvalidade - hoje.d <= 7 then 'critico_7d'
            when a._dtvalidade - hoje.d <= 30 then 'alto_30d'
            when a._dtvalidade - hoje.d <= 60 then 'atencao_60d'
            when a._dtvalidade - hoje.d <= 90 then 'monitorar_90d'
            else 'normal' end as faixa,
       custo.custo as custo_unitario,
       round(a.disponivel * custo.custo, 2) as valor_em_risco,
       round(media.diaria, 4) as venda_media_diaria,
       ceil(a.ate_aqui / nullif(media.diaria, 0)) as dias_para_vender,
       (a._dtvalidade < hoje.d or coalesce(media.diaria, 0) = 0 or a.ate_aqui / media.diaria > (a._dtvalidade - hoje.d)) as risco_perda,
       a.qtdsaldo as qtd_lote,
       a.estoque_item,
       a.qtdsaldo - a.disponivel as qtd_ja_saiu,
       -- Ordem padrão das listas: primeiro o que ainda vai vencer (do mais próximo ao mais distante), depois os vencidos.
       (a._dtvalidade < hoje.d) as vencido
  from acum a
  cross join hoje
  left join public.vw_variacao_nome n on n.idmercadoriavariacao = a._idmercadoriavariacao
  left join custo on custo.id = a._idmercadoriavariacao
  left join media on media.id = a._idmercadoriavariacao;
