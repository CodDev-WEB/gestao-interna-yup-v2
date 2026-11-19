-- Gestão do estoque (plano de melhoria, fases 1 a 4). Idempotente.
--   vw_produto_abc         curva ABC (Pareto) pelo faturamento dos últimos 365 dias carregados
--   vw_qualidade_dados     um problema de cadastro/estoque por linha (negativo, sem custo, sem EAN, sem NCM, lote vencido)
--   vw_qualidade_resumo    contagem e valor de cada problema
--   cfg_reposicao          nível de serviço, prazo de entrega e revisão por classe ABC (editável)
--   vw_reposicao           ponto de pedido, estoque de segurança, máximo e sugestão de compra (Ballou, cap. 9)
--   cnt_contagem           contagens físicas (contagem cíclica) registradas pelo site
--   vw_contagem_pendente   itens que devem ser contados (A a cada 30 dias, B a cada 90, C a cada 365)
--   vw_contagem_acuracia   acurácia do estoque por mês e classe
--   vw_custo_servico_mensal relatório de custo-serviço por mês (Ballou, cap. 16)
-- Datas de referência: a última venda carregada, para os números fazerem sentido enquanto a carga do ERP não chega a hoje.

-- ---------- Curva ABC ----------
create or replace view public.vw_produto_abc with (security_invoker = true) as
with ref as (select coalesce(max(data), (now() at time zone 'America/Belem')::date) as fim from public.vw_venda_item),
v as (
  select vi.idmercadoriavariacao as id, sum(vi.valtotalliquido) as faturamento, sum(vi.lucro_bruto) as lucro,
         count(*) filter (where vi.custo_unitario is null) as itens_sem_custo,
         sum(vi.qtd) as qtd, count(distinct vi.iddocumento) as vendas
    from public.vw_venda_item vi, ref
   where vi.data > ref.fim - 365 and vi.idmercadoriavariacao is not null
   group by 1),
r as (
  select v.*, sum(faturamento) over (order by faturamento desc, id) as acum, sum(faturamento) over () as total,
         row_number() over (order by faturamento desc, id) as posicao
    from v where faturamento > 0)
select r.id as idmercadoriavariacao, r.posicao, r.faturamento, r.qtd, r.vendas,
       case when r.itens_sem_custo = 0 then r.lucro end as lucro,
       case when r.itens_sem_custo = 0 and r.faturamento > 0 then round(r.lucro * 100 / r.faturamento, 2) end as margem_pct,
       round(r.faturamento * 100 / nullif(r.total, 0), 4) as participacao_pct,
       round(r.acum * 100 / nullif(r.total, 0), 2) as acumulado_pct,
       case when (r.acum - r.faturamento) / nullif(r.total, 0) < 0.80 then 'A'
            when (r.acum - r.faturamento) / nullif(r.total, 0) < 0.95 then 'B' else 'C' end as classe,
       (select fim from ref) as referencia
  from r;

-- ---------- Qualidade do dado ----------
create or replace view public.vw_qualidade_dados with (security_invoker = true) as
with p as (
  select n.idmercadoriavariacao, n.descricao, n.codigobarras, n.secao, n.setor, n.ncm,
         n.estoque_atual::numeric as estoque, n.custo_unitario::numeric as custo, n.valor_estoque::numeric as valor_estoque,
         coalesce(a.classe, 'C') as classe, coalesce(a.faturamento, 0) as faturamento
    from public.vw_produto_ncm n
    left join public.vw_produto_abc a on a.idmercadoriavariacao = n.idmercadoriavariacao),
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

create or replace view public.vw_qualidade_resumo with (security_invoker = true) as
select problema, count(*) as itens, count(*) filter (where classe = 'A') as itens_a, round(sum(coalesce(valor, 0)), 2) as valor
  from public.vw_qualidade_dados group by problema
union all
select 'venda_sem_custo', count(*) filter (where vi.custo_unitario is null), null, null
  from public.vw_venda_item vi
 where vi.data > (select coalesce(max(data), (now() at time zone 'America/Belem')::date) from public.vw_venda_item) - 90;

-- ---------- Reposição: ponto de pedido e estoque de segurança ----------
create table if not exists public.cfg_reposicao (
  classe             text primary key check (classe in ('A', 'B', 'C')),
  nivel_servico      numeric not null check (nivel_servico > 0 and nivel_servico < 1),
  z                  numeric not null check (z >= 0),
  prazo_entrega_dias integer not null check (prazo_entrega_dias between 1 and 120),
  revisao_dias       integer not null check (revisao_dias between 1 and 180)
);
alter table public.cfg_reposicao enable row level security;
insert into public.cfg_reposicao (classe, nivel_servico, z, prazo_entrega_dias, revisao_dias) values
  ('A', 0.98, 2.05, 7, 7), ('B', 0.95, 1.65, 7, 14), ('C', 0.90, 1.28, 7, 30)
on conflict (classe) do nothing;

-- Demanda diária dos últimos 90 dias carregados (dias sem venda contam como zero).
-- Ponto de pedido = média × prazo + z × desvio × √prazo; máximo = ponto de pedido + média × dias de revisão.
-- Sugestão = máximo − estoque (estoque negativo conta como zero) quando o estoque está no ponto de pedido ou abaixo.
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
    left join public.vw_produto_abc a on a.idmercadoriavariacao = e.id
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

-- ---------- Contagem cíclica e conciliação ----------
create table if not exists public.cnt_contagem (
  id                   bigserial primary key,
  idmercadoriavariacao bigint not null,
  qtd_contada          numeric not null check (qtd_contada >= 0),
  qtd_sistema          numeric,
  custo_unitario       numeric,
  classe               text,
  motivo               text check (motivo is null or motivo in ('furto', 'avaria', 'erro_entrada', 'erro_venda', 'vencimento', 'outro')),
  observacao           text check (observacao is null or length(observacao) <= 300),
  contado_por          text,
  contado_em           timestamptz not null default now()
);
alter table public.cnt_contagem enable row level security;
create index if not exists cnt_contagem_item_idx on public.cnt_contagem (idmercadoriavariacao, contado_em desc);

-- Itens com contagem vencida pela classe (A: 30 dias, B: 90, C: 365). Itens A e B entram mesmo sem saldo,
-- porque saldo zerado ou negativo num item que vende é justamente o que precisa ser conferido.
create or replace view public.vw_contagem_pendente with (security_invoker = true) as
with ultima as (select idmercadoriavariacao, max(contado_em) as contado_em from public.cnt_contagem group by 1),
p as (
  select d.idmercadoriavariacao, d.descricao, d.codigobarras, d.secao, d.estoque_atual::numeric as estoque,
         d.valor_estoque::numeric as valor_estoque, coalesce(a.classe, 'C') as classe, coalesce(a.posicao, 999999) as posicao
    from public.vw_produto_desempenho d
    left join public.vw_produto_abc a on a.idmercadoriavariacao = d.idmercadoriavariacao)
select p.idmercadoriavariacao, p.descricao, p.codigobarras, p.secao, p.classe, p.estoque, p.valor_estoque, u.contado_em as ultima_contagem,
       case p.classe when 'A' then 30 when 'B' then 90 else 365 end as intervalo_dias,
       case p.classe when 'A' then 1 when 'B' then 2 else 3 end as prioridade, p.posicao
  from p left join ultima u on u.idmercadoriavariacao = p.idmercadoriavariacao
 where (p.classe in ('A', 'B') or p.estoque > 0)
   and (u.contado_em is null or u.contado_em < now() - make_interval(days => case p.classe when 'A' then 30 when 'B' then 90 else 365 end));

create or replace view public.vw_contagem_acuracia with (security_invoker = true) as
select to_char(date_trunc('month', contado_em at time zone 'America/Belem'), 'YYYY-MM') as mes,
       coalesce(classe, 'C') as classe,
       count(*) as contados,
       count(*) filter (where qtd_contada = coalesce(qtd_sistema, 0)) as sem_divergencia,
       round(count(*) filter (where qtd_contada = coalesce(qtd_sistema, 0)) * 100.0 / count(*), 1) as acuracia_pct,
       round(sum(abs(qtd_contada - coalesce(qtd_sistema, 0)) * coalesce(custo_unitario, 0)), 2) as valor_divergente,
       round(sum((qtd_contada - coalesce(qtd_sistema, 0)) * coalesce(custo_unitario, 0)), 2) as saldo_divergencia
  from public.cnt_contagem group by 1, 2;

-- ---------- Relatório de custo-serviço mensal ----------
create or replace view public.vw_custo_servico_mensal with (security_invoker = true) as
with v as (
  select to_char(data, 'YYYY-MM') as mes, sum(valtotalbruto) as bruto, sum(valtotalliquido) as liquido, sum(valdesconto) as descontos,
         sum(custo_total) as cmv, count(*) as itens, count(*) filter (where custo_unitario is null) as itens_sem_custo,
         count(distinct iddocumento) as vendas
    from public.vw_venda_item group by 1),
dv as (select to_char(data, 'YYYY-MM') as mes, sum(valtotalliquido) as devolucoes from public.vw_devolucao_item group by 1),
venc as (select to_char(dtvalidade, 'YYYY-MM') as mes, sum(valor_em_risco) as perda_validade, count(*) as lotes_vencidos
           from public.vw_lote_validade where dias_para_vencer < 0 and qtdsaldo > 0 group by 1)
select v.mes, v.vendas, v.itens, round(v.liquido - coalesce(dv.devolucoes, 0), 2) as faturamento_liquido,
       round(v.descontos * 100 / nullif(v.bruto, 0), 2) as desconto_pct,
       round(coalesce(dv.devolucoes, 0) * 100 / nullif(v.liquido, 0), 2) as devolucao_pct,
       case when v.itens_sem_custo = 0 then round(v.cmv, 2) end as cmv,
       case when v.itens_sem_custo = 0 then round((v.liquido - v.cmv) * 100 / nullif(v.liquido, 0), 2) end as margem_pct,
       round((v.liquido - coalesce(dv.devolucoes, 0)) / nullif(v.vendas, 0), 2) as ticket_medio,
       v.itens_sem_custo, round(v.itens_sem_custo * 100.0 / nullif(v.itens, 0), 1) as itens_sem_custo_pct,
       round(coalesce(venc.perda_validade, 0), 2) as perda_validade, coalesce(venc.lotes_vencidos, 0) as lotes_vencidos
  from v left join dv on dv.mes = v.mes left join venc on venc.mes = v.mes;

-- ---------- Segurança (auditoria do Supabase) ----------
-- Funções com search_path fixo; rls_auto_enable (criada fora destas migrações) sem execução pública.
alter function public.vazio_null(text) set search_path = public, pg_catalog;
alter function public.ncm_limpo(text) set search_path = public, pg_catalog;
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.rls_auto_enable() from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function public.rls_auto_enable() from authenticated'; end if;
  end if;
end $$;
