-- Auditoria de valores (ERP × sistema, ao centavo) e painel de vendedoras. Idempotente.
--
-- auditoria_espelho(p_ate): os mesmos totais que o Worker pede ao ERP, calculados no espelho, para comparar
--   linha a linha. Tudo em numeric (sem arredondar): a comparação é feita em centavos no Worker.
-- vendedoras_resumo(p_de, p_ate): por vendedora, o que vendeu (bruto, desconto, líquido, custo, lucro),
--   quantas devoluções teve e o que ela mesma comprou como cliente.
-- vendedora_detalhe(p_id, p_de, p_ate): itens que vendeu, itens que comprou, as compras dela e mês a mês.
-- Critérios (os mesmos de todo o sistema):
--   venda     = documento de saída (S), financeiro a receber (R), efetivado (E)
--   devolução = modelo TM, entrada (E), financeiro a pagar (P), efetivado (E)
--   compra    = entrada (E), a pagar (P), efetivado (E), modelo diferente de TM

create or replace function public.auditoria_espelho(p_ate timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'classes', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.mes, c.modelo, c.tm, c.tf, c.status), '[]'::jsonb) from (
        select to_char(d.datahora at time zone 'America/Belem', 'YYYY-MM') as mes,
               coalesce(d.modelo, '') as modelo, coalesce(d.tipomovimento, '') as tm,
               coalesce(d.tipomovimentofinanceiro, '') as tf, coalesce(d.status, '') as status,
               count(distinct d._iddocumento) as docs, count(*) as itens,
               coalesce(sum(dm.qtd), 0) as qtd, coalesce(sum(dm.valtotalliquido), 0) as valor,
               coalesce(sum(dm.valtotalbruto), 0) as bruto, coalesce(sum(dm.valdesconto), 0) as desconto
          from public.erp_documento d
          join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
         where d.datahora < p_ate and d.sync_deleted_at is null and dm.sync_deleted_at is null
         group by 1, 2, 3, 4, 5) c),
    'vendedoras', (
      select coalesce(jsonb_agg(to_jsonb(v) order by v.mes, v.vendedora), '[]'::jsonb) from (
        select to_char(d.datahora at time zone 'America/Belem', 'YYYY-MM') as mes,
               coalesce(dm.idpessoafuncionario, 0) as vendedora,
               count(distinct d._iddocumento) as docs, count(*) as itens,
               coalesce(sum(dm.qtd), 0) as qtd, coalesce(sum(dm.valtotalliquido), 0) as valor
          from public.erp_documento d
          join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
         where d.datahora < p_ate and d.sync_deleted_at is null and dm.sync_deleted_at is null
           and d.tipomovimento = 'S' and d.tipomovimentofinanceiro = 'R' and d.status = 'E'
         group by 1, 2) v),
    'estoque', (
      select jsonb_build_object('linhas', count(*), 'qtd', coalesce(sum(qtdsaldo), 0))
        from public.erp_mercadoria_estoque where sync_deleted_at is null),
    -- Itens cujo cabeçalho (documento) não está no espelho: o Worker pergunta ao ERP o que são.
    'orfaos', (
      select coalesce(jsonb_agg(distinct x._iddocumento), '[]'::jsonb)
        from public.erp_documento_mercadoria x
       where x.sync_deleted_at is null
         and not exists (select 1 from public.erp_documento d where d._iddocumento = x._iddocumento))
  )
$$;

create or replace function public.vendedoras_resumo(p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  with equipe as (select distinct idpessoafuncionario as id from public.vw_venda_item where idpessoafuncionario is not null),
  v as (
    select coalesce(idpessoafuncionario, 0) as id, count(distinct iddocumento) as vendas, count(*) as itens,
           sum(qtd) as qtd, sum(valtotalbruto) as bruto, sum(valdesconto) as desconto, sum(valtotalliquido) as liquido,
           sum(custo_total) as custo, sum(lucro_bruto) as lucro, count(distinct idcliente) as clientes,
           count(*) filter (where custo_total is null) as itens_sem_custo
      from public.vw_venda_item where data between p_de and p_ate group by 1),
  dv as (
    select coalesce(dm.idpessoafuncionario, 0) as id, count(distinct d._iddocumento) as devolucoes,
           sum(dm.valtotalliquido) as devolvido
      from public.erp_documento d
      join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
     where d.modelo = 'TM' and d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' and d.status = 'E'
       and (d.datahora at time zone 'America/Belem')::date between p_de and p_ate
     group by 1),
  cp as (
    select idcliente as id, count(distinct iddocumento) as compras, count(*) as itens_comprados,
           sum(valtotalliquido) as comprado, sum(valdesconto) as desconto_recebido
      from public.vw_venda_item
     where data between p_de and p_ate and idcliente in (select id from equipe)
     group by 1),
  ids as (select id from v union select id from dv union select id from cp)
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
    left join public.erp_pessoa p on p._idpessoa = ids.id
$$;

create or replace function public.vendedora_detalhe(p_id bigint, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'id', p_id,
    'nome', case when p_id = 0 then 'Sem vendedora no item' else (select coalesce(nullif(trim(concat_ws(' ', nome, sobrenome)), ''), 'Pessoa ' || p_id) from public.erp_pessoa where _idpessoa = p_id) end,
    -- O que ela vendeu, por item.
    'vendidos', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.liquido desc), '[]'::jsonb) from (
        select idmercadoriavariacao as id, max(descricao) as descricao, count(distinct iddocumento) as vendas,
               sum(qtd) as qtd, sum(valtotalbruto) as bruto, sum(valdesconto) as desconto, sum(valtotalliquido) as liquido,
               sum(custo_total) as custo, sum(lucro_bruto) as lucro
          from public.vw_venda_item
         where coalesce(idpessoafuncionario, 0) = p_id and data between p_de and p_ate
         group by 1) x),
    -- O que ela comprou como cliente, por item.
    'comprados', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.liquido desc), '[]'::jsonb) from (
        select idmercadoriavariacao as id, max(descricao) as descricao, count(distinct iddocumento) as compras,
               sum(qtd) as qtd, sum(valtotalbruto) as bruto, sum(valdesconto) as desconto, sum(valtotalliquido) as liquido
          from public.vw_venda_item
         where p_id <> 0 and idcliente = p_id and data between p_de and p_ate
         group by 1) x),
    -- Cada compra dela: quando, quanto, quem atendeu.
    'compras', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.datahora desc), '[]'::jsonb) from (
        select c.iddocumento, min(c.datahora) as datahora, count(*) as itens, sum(c.valtotalbruto) as bruto,
               sum(c.valdesconto) as desconto, sum(c.valtotalliquido) as liquido,
               string_agg(distinct coalesce(nullif(trim(concat_ws(' ', p.nome, p.sobrenome)), ''), 'sem vendedora'), ', ') as atendida_por
          from public.vw_venda_item c
          left join public.erp_pessoa p on p._idpessoa = c.idpessoafuncionario
         where p_id <> 0 and c.idcliente = p_id and c.data between p_de and p_ate
         group by c.iddocumento) x),
    'devolucoes', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.datahora desc), '[]'::jsonb) from (
        select d._iddocumento as iddocumento, min(d.datahora) as datahora, count(*) as itens, sum(dm.valtotalliquido) as valor
          from public.erp_documento d
          join public.erp_documento_mercadoria dm on dm._iddocumento = d._iddocumento
         where d.modelo = 'TM' and d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' and d.status = 'E'
           and coalesce(dm.idpessoafuncionario, 0) = p_id
           and (d.datahora at time zone 'America/Belem')::date between p_de and p_ate
         group by d._iddocumento) x),
    'meses', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]'::jsonb) from (
        select to_char(data, 'YYYY-MM') as mes,
               sum(valtotalliquido) filter (where coalesce(idpessoafuncionario, 0) = p_id) as vendido,
               count(distinct iddocumento) filter (where coalesce(idpessoafuncionario, 0) = p_id) as vendas,
               sum(valtotalliquido) filter (where p_id <> 0 and idcliente = p_id) as comprado
          from public.vw_venda_item
         where data between p_de and p_ate and (coalesce(idpessoafuncionario, 0) = p_id or (p_id <> 0 and idcliente = p_id))
         group by 1) x)
  )
$$;

do $$
declare f text;
begin
  foreach f in array array['public.auditoria_espelho(timestamptz)', 'public.vendedoras_resumo(date, date)', 'public.vendedora_detalhe(bigint, date, date)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
