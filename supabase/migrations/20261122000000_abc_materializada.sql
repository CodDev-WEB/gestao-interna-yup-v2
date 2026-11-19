-- Curva ABC pronta numa materialized view: as views de qualidade, reposição e contagem deixam de varrer
-- todas as vendas a cada consulta (com várias telas abertas ao mesmo tempo, passavam do limite de 8 s da API).
-- Atualizada pelo cron do Worker a cada 15 minutos (função atualizar_gestao). Idempotente.

create materialized view if not exists public.mv_produto_abc as select * from public.vw_produto_abc;
create unique index if not exists mv_produto_abc_pk on public.mv_produto_abc (idmercadoriavariacao);
create index if not exists mv_produto_abc_classe on public.mv_produto_abc (classe, posicao);

-- Materialized view não tem RLS: fica fora da API pública, só a service_role (Worker) lê.
revoke all on public.mv_produto_abc from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on public.mv_produto_abc from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on public.mv_produto_abc from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant select on public.mv_produto_abc to service_role'; end if;
end $$;

create or replace function public.atualizar_gestao() returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  refresh materialized view concurrently public.mv_produto_abc;
end $$;
revoke execute on function public.atualizar_gestao() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.atualizar_gestao() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function public.atualizar_gestao() from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.atualizar_gestao() to service_role'; end if;
end $$;

create or replace view public.vw_qualidade_dados with (security_invoker = true) as
with p as (
  select n.idmercadoriavariacao, n.descricao, n.codigobarras, n.secao, n.setor, n.ncm,
         n.estoque_atual::numeric as estoque, n.custo_unitario::numeric as custo, n.valor_estoque::numeric as valor_estoque,
         coalesce(a.classe, 'C') as classe, coalesce(a.faturamento, 0) as faturamento
    from public.vw_produto_ncm n
    left join public.mv_produto_abc a on a.idmercadoriavariacao = n.idmercadoriavariacao),
lotes as (
  select idmercadoriavariacao, count(*) as lotes, sum(qtdsaldo) as qtd, sum(valor_em_risco) as valor, min(dtvalidade) as mais_antigo
    from public.vw_lote_validade where dias_para_vencer < 0 and qtdsaldo > 0 group by 1)
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, p.classe, p.faturamento, p.estoque,
       'estoque_negativo'::text as problema, round(abs(p.estoque) * coalesce(p.custo, 0), 2) as valor,
       'Saldo de ' || trim(to_char(p.estoque, 'FM999G999G990D###')) || ' no sistema' as detalhe
  from p where p.estoque < 0
union all
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, p.classe, p.faturamento, p.estoque,
       'sem_custo', null, 'Tem estoque e o custo está zerado ou vazio'
  from p where p.estoque > 0 and coalesce(p.custo, 0) <= 0
union all
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, p.classe, p.faturamento, p.estoque,
       'sem_codigo_barras', p.valor_estoque, 'Tem estoque e não tem código de barras'
  from p where p.estoque > 0 and coalesce(btrim(p.codigobarras), '') = ''
union all
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, p.classe, p.faturamento, p.estoque,
       'ncm_invalido', p.valor_estoque, 'Tem estoque e não tem NCM válido de 8 dígitos'
  from p where p.estoque > 0 and p.ncm is null
union all
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, p.classe, p.faturamento, p.estoque,
       'lote_vencido', round(l.valor, 2),
       l.lotes || case when l.lotes = 1 then ' lote vencido' else ' lotes vencidos' end || ' com saldo; o mais antigo venceu em ' || to_char(l.mais_antigo, 'DD/MM/YYYY')
  from p join lotes l on l.idmercadoriavariacao = p.idmercadoriavariacao;

create or replace view public.vw_reposicao with (security_invoker = true) as
with ref as (select coalesce(max(data), (now() at time zone 'America/Belem')::date) as fim from public.vw_venda_item),
dia as (
  select vi.idmercadoriavariacao as id, vi.data, sum(vi.qtd) as q
    from public.vw_venda_item vi, ref
   where vi.data > ref.fim - 90 and vi.idmercadoriavariacao is not null
   group by 1, 2),
est as (
  select id, sum(q) / 90.0 as media, sqrt(greatest(sum(q * q) / 90.0 - power(sum(q) / 90.0, 2), 0)) as desvio, count(*) as dias_com_venda
    from dia group by 1),
base as (
  select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.setor, coalesce(a.classe, 'C') as classe,
         p.estoque_atual::numeric as estoque, nullif(p.custo_unitario::numeric, 0) as custo,
         e.media, e.desvio, e.dias_com_venda, c.nivel_servico, c.prazo_entrega_dias, c.revisao_dias,
         ceil(c.z * e.desvio * sqrt(c.prazo_entrega_dias::numeric)) as estoque_seguranca,
         ceil(e.media * c.prazo_entrega_dias + c.z * e.desvio * sqrt(c.prazo_entrega_dias::numeric)) as ponto_pedido,
         ceil(e.media * c.prazo_entrega_dias + c.z * e.desvio * sqrt(c.prazo_entrega_dias::numeric) + e.media * c.revisao_dias) as estoque_maximo
    from est e
    join public.vw_produto_desempenho p on p.idmercadoriavariacao = e.id
    left join public.mv_produto_abc a on a.idmercadoriavariacao = e.id
    join public.cfg_reposicao c on c.classe = coalesce(a.classe, 'C')
   where e.media > 0)
select b.idmercadoriavariacao, b.descricao, b.codigobarras, b.secao, b.setor, b.classe, b.estoque, b.custo,
       round(b.media, 3) as venda_media_diaria, round(b.desvio, 3) as desvio_diario, b.dias_com_venda,
       b.nivel_servico, b.prazo_entrega_dias, b.revisao_dias, b.estoque_seguranca, b.ponto_pedido, b.estoque_maximo,
       b.desvio > b.media as demanda_erratica,
       b.estoque <= 0 as em_ruptura,
       case when b.estoque <= b.ponto_pedido then greatest(b.estoque_maximo - greatest(b.estoque, 0), 0) else 0 end as sugestao_compra,
       round(case when b.estoque <= b.ponto_pedido then greatest(b.estoque_maximo - greatest(b.estoque, 0), 0) else 0 end * b.custo, 2) as valor_sugestao,
       round(greatest(b.estoque, 0) / nullif(b.media, 0)) as cobertura_dias,
       (select fim from ref) as referencia
  from base b;

create or replace view public.vw_contagem_pendente with (security_invoker = true) as
with ultima as (select idmercadoriavariacao, max(contado_em) as contado_em from public.cnt_contagem group by 1),
p as (
  select d.idmercadoriavariacao, d.descricao, d.codigobarras, d.secao, d.estoque_atual::numeric as estoque,
         d.valor_estoque::numeric as valor_estoque, coalesce(a.classe, 'C') as classe, coalesce(a.posicao, 999999) as posicao
    from public.vw_produto_desempenho d
    left join public.mv_produto_abc a on a.idmercadoriavariacao = d.idmercadoriavariacao)
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.classe, p.estoque, p.valor_estoque, u.contado_em as ultima_contagem,
       case p.classe when 'A' then 30 when 'B' then 90 else 365 end as intervalo_dias,
       case p.classe when 'A' then 1 when 'B' then 2 else 3 end as prioridade, p.posicao
  from p left join ultima u on u.idmercadoriavariacao = p.idmercadoriavariacao
 where (p.classe in ('A', 'B') or p.estoque > 0)
   and (u.contado_em is null or u.contado_em < now() - make_interval(days => case p.classe when 'A' then 30 when 'B' then 90 else 365 end));

-- Quantos itens faltam contar por classe, numa consulta só.
create or replace view public.vw_contagem_resumo with (security_invoker = true) as
select classe, count(*) as pendentes from public.vw_contagem_pendente group by classe;
