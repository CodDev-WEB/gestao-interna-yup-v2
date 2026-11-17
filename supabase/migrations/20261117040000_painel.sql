-- Views de apoio do site (agregados que o PostgREST não calcula sozinho). Idempotente.

-- Capital em estoque por situação (barra principal da visão executiva).
create or replace view public.vw_capital_situacao with (security_invoker = true) as
select situacao, count(*) as produtos, round(sum(coalesce(valor_estoque, 0)), 2) as valor_estoque, sum(greatest(estoque_atual, 0)) as unidades
  from public.vw_produto_desempenho
 group by situacao;

-- Lotes por faixa de vencimento.
create or replace view public.vw_lote_resumo with (security_invoker = true) as
select faixa, count(*) as lotes, round(sum(coalesce(valor_em_risco, 0)), 2) as valor, count(*) filter (where risco_perda) as lotes_em_risco,
       round(sum(coalesce(valor_em_risco, 0)) filter (where risco_perda), 2) as valor_em_risco
  from public.vw_lote_validade
 group by faixa;

-- Seções do ERP e o setor da gestão (para classificar no site).
create or replace view public.vw_secao_setor with (security_invoker = true) as
select s._idsecao as idsecao, s.descricao, c.setor
  from public.erp_mercadoria_secao s
  left join public.cfg_secao_setor c on c.idsecao = s._idsecao
 where s.sync_deleted_at is null;
