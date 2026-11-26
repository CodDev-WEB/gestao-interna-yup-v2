-- Prevenção de perdas: sinais de furo entre o que é registrado no caixa e o que sai da loja.
-- Tudo é indício para conferir (câmera, balcão, contagem), não prova. Período padrão: últimos 30 dias.
-- p: {"de": "AAAA-MM-DD", "ate": "AAAA-MM-DD"}. Idempotente.

create index if not exists erp_mercadoria_estoque_historico_datahora on public.erp_mercadoria_estoque_historico (datahora);
create index if not exists erp_mercadoria_estoque_historico_doc on public.erp_mercadoria_estoque_historico (_iddocumento, idmercadoriavariacao);
create index if not exists erp_inventario_mercadoria_datahora on public.erp_inventario_mercadoria (datahora);

-- Preço de tabela principal de cada variação (a de menor código, ativa, na empresa 1).
create or replace view public.vw_preco_tabela with (security_invoker = true) as
select distinct on (t._idmercadoriavariacao) t._idmercadoriavariacao as idmercadoriavariacao, t._idtabela as idtabela, t.valpreco
  from public.erp_mercadoria_tabela_preco t
 where t._idempresa = 1 and t.sync_deleted_at is null and coalesce(t.flaginativo, '') not in ('T', 'S')
 order by t._idmercadoriavariacao, t._idtabela;

-- Nome do funcionário (vendedora) a partir da pessoa.
create or replace function public.pp_nome(id bigint) returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(nullif(trim(concat_ws(' ', p.nome, p.sobrenome)), ''), 'Sem vendedora')
    from (select 1) x left join public.erp_pessoa p on p._idpessoa = id
$$;

-- 1. Troca na bipagem: item que SOBROU na contagem pareado com item que FALTOU, da mesma marca (ou mesma seção e
--    grupo), com preço bem maior. Contagens do sistema (Conciliação) e inventários do ERP dos últimos 120 dias.
create or replace function public.pp_trocas(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with cont as (
    select c.idmercadoriavariacao as id, c.contado_em as quando, c.qtd_contada - c.qtd_sistema as dif, 'conciliação' as origem
      from public.cnt_contagem c where c.contado_em >= now() - interval '120 days' and c.qtd_sistema is not null
    union all
    select im.idmercadoriavariacao, im.datahora, im.qtdcontada - im.qtdanterior, 'inventário do ERP'
      from public.erp_inventario_mercadoria im
     where im.datahora >= now() - interval '120 days' and im.qtdanterior is not null and im.sync_deleted_at is null),
  ultima as (select distinct on (id) id, quando, dif, origem from cont where id is not null order by id, quando desc),
  info as (
    select u.id, u.quando, u.dif, u.origem, coalesce(n.nome, 'Item ' || u.id) as nome, v.idmarca, m.idsecao, m.idgrupo, pt.valpreco as preco
      from ultima u
      join public.vw_preco_tabela pt on pt.idmercadoriavariacao = u.id and pt.valpreco > 0
      left join public.vw_variacao_nome n on n.idmercadoriavariacao = u.id
      left join public.erp_mercadoria_variacao v on v._idmercadoriavariacao = u.id
      left join public.erp_mercadoria m on m._idmercadoria = v.idmercadoria
     where u.dif <> 0),
  pares as (
    select distinct on (f.id) s.id as id_barato, s.nome as nome_barato, s.preco as preco_barato, s.dif as sobra, s.quando as contado_barato, s.origem as origem_barato,
           f.id as id_caro, f.nome as nome_caro, f.preco as preco_caro, -f.dif as falta, f.quando as contado_caro, f.origem as origem_caro,
           (s.idmarca is not null and s.idmarca = f.idmarca) as mesma_marca,
           least(s.dif, -f.dif) as qtd_par, least(s.dif, -f.dif) * (f.preco - s.preco) as valor
      from info f join info s
        on s.dif > 0 and f.dif < 0 and s.id <> f.id and f.preco >= s.preco * 1.5
       and ((s.idmarca is not null and s.idmarca = f.idmarca) or (s.idsecao = f.idsecao and s.idgrupo = f.idgrupo))
     order by f.id, (s.idmarca is not null and s.idmarca = f.idmarca) desc, least(s.dif, -f.dif) * (f.preco - s.preco) desc),
  top as (select * from pares order by valor desc limit 60)
  select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
    'vendas_barato', (select coalesce(jsonb_agg(jsonb_build_object('vendedora', x.vendedora, 'qtd', x.qtd, 'vendas', x.vendas) order by x.qtd desc), '[]'::jsonb)
                        from (select public.pp_nome(v.idpessoafuncionario) as vendedora, round(sum(v.qtd), 3) as qtd, count(distinct v.iddocumento) as vendas
                                from public.vw_venda_item v
                               where v.idmercadoriavariacao = t.id_barato and v.datahora between t.contado_barato - interval '60 days' and t.contado_barato
                               group by 1 order by 2 desc limit 4) x))
    order by t.valor desc), '[]'::jsonb)
  from top t
$$;

-- 2. Venda sem saldo: item vendido quando o saldo do local já era zero ou negativo (bipou um, saiu outro?).
create or replace function public.pp_sem_saldo(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with per as (select coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Belem')::date - 29) as de,
                      coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Belem')::date) as ate),
  l as (
    select v.iddocumento, v.datahora, v.data, v.idmercadoriavariacao as id, coalesce(n.nome, v.descricao) as nome, v.qtd, v.valtotalliquido as valor,
           v.idpessoafuncionario, min(h.qtdsaldoatual) as saldo_antes
      from per, public.vw_venda_item v
      join public.erp_mercadoria_estoque_historico h on h._iddocumento = v.iddocumento and h.idmercadoriavariacao = v.idmercadoriavariacao
      left join public.vw_variacao_nome n on n.idmercadoriavariacao = v.idmercadoriavariacao
     where v.data between per.de and per.ate and h.qtdsaldoatual <= 0 and h.sync_deleted_at is null
     group by 1, 2, 3, 4, 5, 6, 7, 8)
  select jsonb_build_object(
    'total', (select jsonb_build_object('linhas', count(*), 'valor', round(coalesce(sum(valor), 0), 2), 'produtos', count(distinct id)) from l),
    'por_vendedora', coalesce((select jsonb_agg(jsonb_build_object('id', x.idpessoafuncionario, 'vendedora', public.pp_nome(x.idpessoafuncionario), 'linhas', x.n, 'valor', x.v) order by x.n desc)
                                 from (select idpessoafuncionario, count(*) n, round(sum(valor), 2) v from l group by 1) x), '[]'::jsonb),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('documento', iddocumento, 'datahora', datahora, 'id', id, 'nome', nome, 'qtd', qtd, 'valor', round(valor, 2),
                                 'saldo_antes', saldo_antes, 'vendedora', public.pp_nome(idpessoafuncionario)) order by datahora desc)
                          from (select * from l order by datahora desc limit 300) y), '[]'::jsonb))
$$;

-- 3. Preço abaixo da tabela: preço unitário (antes do desconto) menor que o da tabela vigente na hora da venda.
create or replace function public.pp_preco_abaixo(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with per as (select coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Belem')::date - 29) as de,
                      coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Belem')::date) as ate),
  v as (
    select v.iddocumento, v.datahora, v.idmercadoriavariacao as id, v.descricao, v.qtd, v.valtotalbruto, v.valdesconto, v.valtotalliquido, v.idpessoafuncionario,
           pt.idtabela, pt.valpreco as preco_atual
      from per, public.vw_venda_item v
      join public.vw_preco_tabela pt on pt.idmercadoriavariacao = v.idmercadoriavariacao
     where v.data between per.de and per.ate and v.qtd > 0 and coalesce(v.valtotalbruto, 0) > 0),
  c as (
    select v.*, coalesce(
             (select h.valpreconovo from public.erp_mercadoria_tabela_preco_historico h
               where h._idmercadoriavariacao = v.id and h._idtabela = v.idtabela and h._idempresa = 1 and h.datahora <= v.datahora order by h.datahora desc limit 1),
             (select h.valprecotual from public.erp_mercadoria_tabela_preco_historico h
               where h._idmercadoriavariacao = v.id and h._idtabela = v.idtabela and h._idempresa = 1 and h.datahora > v.datahora order by h.datahora asc limit 1),
             v.preco_atual) as preco_tabela
      from v),
  l as (
    select c.*, round(c.valtotalbruto / c.qtd, 2) as preco_cobrado, round(c.qtd * c.preco_tabela - c.valtotalbruto, 2) as diferenca
      from c where c.preco_tabela > 0 and c.valtotalbruto / c.qtd < c.preco_tabela * 0.99 and c.qtd * c.preco_tabela - c.valtotalbruto >= 0.10)
  select jsonb_build_object(
    'total', (select jsonb_build_object('linhas', count(*), 'diferenca', round(coalesce(sum(diferenca), 0), 2), 'produtos', count(distinct id)) from l),
    'por_vendedora', coalesce((select jsonb_agg(jsonb_build_object('id', x.idpessoafuncionario, 'vendedora', public.pp_nome(x.idpessoafuncionario), 'linhas', x.n, 'diferenca', x.d) order by x.d desc)
                                 from (select idpessoafuncionario, count(*) n, round(sum(diferenca), 2) d from l group by 1) x), '[]'::jsonb),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('documento', y.iddocumento, 'datahora', y.datahora, 'id', y.id, 'nome', coalesce(n.nome, y.descricao), 'qtd', y.qtd,
                                 'preco_tabela', round(y.preco_tabela, 2), 'preco_cobrado', y.preco_cobrado, 'desconto', round(coalesce(y.valdesconto, 0), 2), 'diferenca', y.diferenca,
                                 'vendedora', public.pp_nome(y.idpessoafuncionario)) order by y.diferenca desc)
                          from (select * from l order by diferenca desc limit 300) y left join public.vw_variacao_nome n on n.idmercadoriavariacao = y.id), '[]'::jsonb))
$$;

-- 4. Saída sem venda: estoque que baixou por documento que não é venda (ajuste, consumo, inventário, perda...) ou sem
--    documento. Transferência entre locais se anula (soma por documento e item).
create or replace function public.pp_saidas(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with per as (select coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Belem')::date - 29) as de,
                      coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Belem')::date) as ate),
  mov as (
    select h._iddocumento as doc, h.idmercadoriavariacao as id, min(h.datahora) as datahora, sum(h.qtdnovosaldo - h.qtdsaldoatual) as delta
      from per, public.erp_mercadoria_estoque_historico h
     where h.datahora >= (per.de::timestamp at time zone 'America/Belem') and h.datahora < ((per.ate + 1)::timestamp at time zone 'America/Belem') and h.sync_deleted_at is null
     group by 1, 2 having sum(h.qtdnovosaldo - h.qtdsaldoatual) < 0),
  l as (
    select m.*, d.modelo, d.idusuario,
           case when d._iddocumento is null then 'Sem documento (ajuste direto)'
                else coalesce(nt.descricao, 'Modelo ' || coalesce(d.modelo, '?')) end as tipo,
           -m.delta * coalesce(nullif(cu.valcustomedio, 0), cu.valcusto, 0) as valor
      from mov m
      left join public.erp_documento d on d._iddocumento = m.doc
      left join public.erp_natureza_operacao nt on nt._idempresa = 1 and nt._idnatureza = d.idnaturezaoperacao
      left join public.erp_mercadoria_custo cu on cu._idempresa = 1 and cu._idmercadoriavariacao = m.id
     where d._iddocumento is null or not (d.tipomovimento = 'S' and d.tipomovimentofinanceiro = 'R' and d.status = 'E'))
  select jsonb_build_object(
    'total', (select jsonb_build_object('qtd', round(coalesce(sum(-delta), 0), 3), 'valor', round(coalesce(sum(valor), 0), 2), 'produtos', count(distinct id), 'documentos', count(distinct doc)) from l),
    'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'qtd', q, 'valor', v, 'produtos', pr, 'documentos', dc) order by v desc)
                            from (select tipo, round(sum(-delta), 3) q, round(sum(valor), 2) v, count(distinct id) pr, count(distinct doc) dc from l group by 1) x), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nome', coalesce(n.nome, 'Item ' || x.id), 'qtd', x.q, 'valor', x.v, 'tipos', x.t) order by x.v desc)
                            from (select id, round(sum(-delta), 3) q, round(sum(valor), 2) v, string_agg(distinct tipo, ', ') t from l group by 1 order by 3 desc limit 100) x
                            left join public.vw_variacao_nome n on n.idmercadoriavariacao = x.id), '[]'::jsonb))
$$;

-- 5. Por vendedora: vendas, descontos, cancelamentos, devoluções, produto genérico e venda sem cliente.
create or replace function public.pp_vendedoras(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with per as (select coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Belem')::date - 29) as de,
                      coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Belem')::date) as ate),
  ven as (
    select v.idpessoafuncionario as id, count(distinct v.iddocumento) as vendas, sum(v.valtotalliquido) as faturamento, sum(v.valtotalbruto) as bruto,
           sum(coalesce(v.valdesconto, 0)) as desconto, count(*) as itens,
           count(distinct v.iddocumento) filter (where v.idcliente is null) as sem_cliente,
           count(*) filter (where v.descricao ~* '(DIVERS|GENERIC|AVULS)') as genericos,
           sum(v.valtotalliquido) filter (where v.descricao ~* '(DIVERS|GENERIC|AVULS)') as valor_genericos
      from per, public.vw_venda_item v where v.data between per.de and per.ate group by 1),
  canc as (
    select x.id, count(*) as cancelados, sum(x.valor) as valor_cancelado from (
      select ch._iddocumento, mode() within group (order by dm.idpessoafuncionario) as id, sum(dm.valtotalliquido) as valor
        from per, public.erp_documento_cancelamento_historico ch
        join public.erp_documento d on d._iddocumento = ch._iddocumento and d.tipomovimento = 'S'
        join public.erp_documento_mercadoria dm on dm._iddocumento = ch._iddocumento
       where (ch.datahora at time zone 'America/Belem')::date between per.de and per.ate
       group by 1) x group by 1),
  dev as (
    select v.idpessoafuncionario as id, count(distinct v.iddocumento) as devolucoes, sum(v.valtotalliquido) as valor_devolvido
      from per, public.vw_devolucao_item v where v.data between per.de and per.ate group by 1),
  ids as (select id from ven union select id from canc union select id from dev)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'vendedora', public.pp_nome(i.id),
    'vendas', coalesce(ven.vendas, 0), 'faturamento', round(coalesce(ven.faturamento, 0), 2), 'itens', coalesce(ven.itens, 0),
    'desconto', round(coalesce(ven.desconto, 0), 2), 'desconto_pct', round(coalesce(ven.desconto, 0) * 100 / nullif(ven.bruto, 0), 2),
    'sem_cliente_pct', round(coalesce(ven.sem_cliente, 0) * 100.0 / nullif(ven.vendas, 0), 1),
    'genericos', coalesce(ven.genericos, 0), 'valor_genericos', round(coalesce(ven.valor_genericos, 0), 2),
    'cancelados', coalesce(canc.cancelados, 0), 'valor_cancelado', round(coalesce(canc.valor_cancelado, 0), 2),
    'devolucoes', coalesce(dev.devolucoes, 0), 'valor_devolvido', round(coalesce(dev.valor_devolvido, 0), 2))
    order by coalesce(ven.faturamento, 0) desc), '[]'::jsonb)
  from ids i left join ven on ven.id is not distinct from i.id left join canc on canc.id is not distinct from i.id left join dev on dev.id is not distinct from i.id
$$;

do $$
declare f text;
begin
  foreach f in array array['pp_nome(bigint)', 'pp_trocas(jsonb)', 'pp_sem_saldo(jsonb)', 'pp_preco_abaixo(jsonb)', 'pp_saidas(jsonb)', 'pp_vendedoras(jsonb)'] loop
    execute format('revoke execute on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function public.%s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function public.%s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;
