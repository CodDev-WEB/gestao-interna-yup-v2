-- Classificação dos produtos pelo NCM: setor (regras por prefixo do NCM), grupo (capítulo, 2 dígitos),
-- subgrupo (posição, 4 dígitos) e o NCM de 8 dígitos. Idempotente.
-- Setor de um produto: regra do NCM (prefixo mais longo) → regra da seção do ERP → "Diversos" se tem NCM → "Não classificado".

create table if not exists public.cfg_ncm_setor (
  prefixo text primary key check (prefixo ~ '^[0-9]{2,8}$'),
  setor   text not null
);
alter table public.cfg_ncm_setor enable row level security;

-- Sugestão inicial para pet shop (só quando ainda não há nenhuma regra; depois vale o que for editado no site).
insert into public.cfg_ncm_setor (prefixo, setor)
select p, s from (values
  ('23', 'Alimentação'), ('19', 'Alimentação'), ('21', 'Alimentação'), ('16', 'Alimentação'), ('10', 'Alimentação'),
  ('11', 'Alimentação'), ('12', 'Alimentação'), ('04', 'Alimentação'), ('0504', 'Alimentação'), ('0511', 'Alimentação'),
  ('30', 'Farmácia'), ('3808', 'Farmácia')) as x(p, s)
where not exists (select 1 from public.cfg_ncm_setor);

-- NCM com 8 dígitos (sem pontos); vazio, "00000000" ou fora do padrão = null.
create or replace function public.ncm_limpo(t text) returns text language sql immutable as $$
  select case when d ~ '^[0-9]{8}$' and d <> '00000000' then d end from (select regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') as d) x
$$;

create or replace view public.vw_produto_classe with (security_invoker = true) as
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
         m.idsecao, s.descricao as secao, m.idgrupo, g.descricao as grupo, coalesce(pc.setor, 'Não classificado') as setor,
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
    left join public.vw_produto_classe pc on pc.idmercadoriavariacao = v._idmercadoriavariacao
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

-- Desempenho + classificação NCM (a view acima mantém as colunas originais para as migrações antigas continuarem idempotentes).
create or replace view public.vw_produto_ncm with (security_invoker = true) as
select d.*, pc.ncm, pc.ncm_descricao, pc.capitulo, pc.posicao, pc.subposicao, pc.origem_setor
  from public.vw_produto_desempenho d
  left join public.vw_produto_classe pc on pc.idmercadoriavariacao = d.idmercadoriavariacao;

-- Faturamento por setor e mês, agora pelo setor do produto (NCM → seção).
create or replace view public.vw_setor_mensal with (security_invoker = true) as
with m as (
  select date_trunc('month', vi.data)::date as mes, coalesce(pc.setor, 'Não classificado') as setor,
         sum(vi.valtotalliquido) as faturamento, sum(vi.lucro_bruto) as lucro, sum(vi.qtd) as qtd,
         count(distinct vi.iddocumento) as vendas
    from public.vw_venda_item vi
    left join public.vw_produto_classe pc on pc.idmercadoriavariacao = vi.idmercadoriavariacao
   group by 1, 2)
select mes, setor, faturamento, lucro, round(lucro * 100 / nullif(faturamento, 0), 2) as margem_pct, qtd, vendas,
       lag(faturamento) over w as faturamento_mes_anterior,
       round((faturamento / nullif(lag(faturamento) over w, 0) - 1) * 100, 2) as crescimento_pct
  from m window w as (partition by setor order by mes);

-- Árvore de categorias: setor → grupo (capítulo) → subgrupo (posição) → NCM, com números de estoque e venda.
create or replace view public.vw_categoria_ncm with (security_invoker = true) as
select setor, capitulo, posicao, ncm, max(ncm_descricao) as ncm_descricao,
       count(*) as produtos, count(*) filter (where estoque_atual > 0) as com_estoque,
       round(sum(coalesce(valor_estoque, 0)), 2) as valor_estoque, round(sum(faturamento_90d), 2) as faturamento_90d,
       round(sum(coalesce(lucro_90d, 0)), 2) as lucro_90d, round(sum(qtd_90d), 3) as qtd_90d,
       count(*) filter (where origem_setor = 'ncm') as por_regra_ncm, count(*) filter (where origem_setor = 'secao') as por_secao
  from public.vw_produto_ncm
 group by setor, capitulo, posicao, ncm;
