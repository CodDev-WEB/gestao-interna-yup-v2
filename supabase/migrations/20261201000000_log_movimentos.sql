-- Log de modificações dos itens: cada mudança de saldo (venda, entrada, saída, ajuste, devolução, implantação)
-- com quem lançou, data e hora, documento, saldo antes e depois e valor; e cada mudança de preço de venda.
-- Fonte: histórico de saldos do ERP (mercadoria_estoque_historico) + documento que causou o movimento
-- (usuário = documento.idusuario, que é uma pessoa no cadastro) + histórico de preços. Idempotente.
--
-- log_movimentos(p) com p = { variacao, de, ate, tipo, usuario, busca, limite (1..500), offset }
-- devolve { linhas: [...], total }

create index if not exists erp_mercadoria_estoque_historico_ix2 on public.erp_mercadoria_estoque_historico (datahora);
create index if not exists erp_mercadoria_tabela_preco_historico_ix2 on public.erp_mercadoria_tabela_preco_historico (datahora);
create index if not exists erp_documento_ix4 on public.erp_documento (idusuario);

create or replace view public.vw_log_movimento with (security_invoker = true) as
select 'e' || h.idh || '-' || h._iddocumento || '-' || h._idlocalestoque as id,
       'estoque'::text as origem,
       h.datahora,
       h.idmercadoriavariacao,
       h._idlocalestoque as idlocal,
       case
         when d._iddocumento is null then 'outro'
         when d.tipomovimento = 'S' and d.tipomovimentofinanceiro = 'R' then 'venda'
         when d.modelo = 'TM' then 'devolucao'
         when d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' then 'entrada'
         when d.modelo = 'IM' then 'implantacao'
         when d.modelo = 'AS' then 'ajuste'
         when d.tipomovimento = 'E' then 'outra_entrada'
         when d.tipomovimento = 'S' then 'outra_saida'
         else 'outro' end as tipo,
       case
         when d._iddocumento is null then 'Movimento sem documento no sistema'
         when d.modelo = 'AS' then 'Ajuste de estoque (' || case when d.tipomovimento = 'E' then 'entrada' else 'saída' end || ')'
         when d.modelo = 'IM' then 'Implantação de estoque'
         when d.modelo in ('LA', 'LS') and n.descricao is null then 'Lançamento manual de ' || case when d.tipomovimento = 'E' then 'entrada' else 'saída' end
         else coalesce(upper(left(n.descricao, 1)) || lower(substring(n.descricao from 2)), d.modelo || ' ' || d.tipomovimento) end as operacao,
       d.status = 'C' as cancelado,
       h.antes,
       h.depois,
       h.quantidade,
       d._iddocumento as iddocumento,
       nullif(trim(concat_ws(' ', d.modelo, d.numero)), '') as documento,
       d.idusuario,
       coalesce(nullif(trim(concat_ws(' ', pu.nome, pu.sobrenome)), ''), case when d.idusuario is not null then 'Usuário nº ' || d.idusuario end) as usuario,
       d.idpessoa,
       nullif(trim(concat_ws(' ', pp.nome, pp.sobrenome)), '') as pessoa,
       it.valor,
       it.vendedora,
       h.registros
  -- O ERP grava uma linha por bipe/alteração (12 unidades bipadas = 12 linhas de -1): junta por documento e item.
  from (select x._iddocumento, x._idlocalestoque, x.idmercadoriavariacao, max(x.datahora) as datahora, min(x._idhistorico) as idh, count(*) as registros,
               (array_agg(x.qtdsaldoatual order by x.datahora, x._idhistorico))[1] as antes,
               (array_agg(x.qtdnovosaldo order by x.datahora desc, x._idhistorico desc))[1] as depois,
               sum(x.qtdnovosaldo - x.qtdsaldoatual) as quantidade
          from public.erp_mercadoria_estoque_historico x
         group by x._iddocumento, x._idlocalestoque, x.idmercadoriavariacao) h
  left join public.erp_documento d on d._iddocumento = h._iddocumento
  left join public.erp_natureza_operacao n on n._idnatureza = d.idnaturezaoperacao and n._idempresa = d.idempresa
  -- documento.idusuario é o usuário do ERP; o nome vem do funcionário ligado a ele (pessoa_funcionario).
  left join lateral (
    select p2.nome, p2.sobrenome from public.erp_pessoa_funcionario f join public.erp_pessoa p2 on p2._idpessoa = f._idpessoa
     where f.idusuario = d.idusuario and f.idusuario <> 0 and f.sync_deleted_at is null
     order by (f._idempresa = d.idempresa) desc, f.flaginativo nulls last limit 1) pu on true
  left join public.erp_pessoa pp on pp._idpessoa = d.idpessoa
  left join lateral (
    select sum(dm.valtotalliquido) as valor,
           max(nullif(trim(concat_ws(' ', pf.nome, pf.sobrenome)), '')) as vendedora
      from public.erp_documento_mercadoria dm
      left join public.erp_pessoa pf on pf._idpessoa = dm.idpessoafuncionario
     where dm._iddocumento = h._iddocumento and dm.idmercadoriavariacao = h.idmercadoriavariacao) it on true
union all
select 'p' || t._idhistorico || '-' || t._idtabela,
       'preco', t.datahora, t._idmercadoriavariacao, null, 'preco',
       'Mudança de preço de venda' || case when t._idtabela <> 1 then ' (tabela ' || t._idtabela || ')' else '' end,
       false, t.valprecotual, t.valpreconovo, t.valpreconovo - t.valprecotual,
       null, null, t.idusuarioalteracao, nullif(trim(t.nomeusuarioalteracao), ''), null, null, null, null, 1::bigint
  from public.erp_mercadoria_tabela_preco_historico t;

create or replace function public.log_movimentos(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v bigint := nullif(p->>'variacao', '')::bigint;
  de timestamptz := coalesce((nullif(p->>'de', '')::date)::timestamp at time zone 'America/Belem', '-infinity');
  ate timestamptz := coalesce(((nullif(p->>'ate', '')::date) + 1)::timestamp at time zone 'America/Belem', 'infinity');
  p_tipo text := nullif(p->>'tipo', '');
  p_usuario bigint := nullif(p->>'usuario', '')::bigint;
  busca text := nullif(trim(p->>'busca'), '');
  limite int := least(greatest(coalesce((p->>'limite')::int, 50), 1), 500);
  desloc int := greatest(coalesce((p->>'offset')::int, 0), 0);
  linhas jsonb; total bigint;
begin
  -- Mesmo conteúdo de vw_log_movimento, mas com item e período filtrados antes de juntar (rápido).
  with l as (
select 'e' || h.idh || '-' || h._iddocumento || '-' || h._idlocalestoque as id,
       'estoque'::text as origem,
       h.datahora,
       h.idmercadoriavariacao,
       h._idlocalestoque as idlocal,
       case
         when d._iddocumento is null then 'outro'
         when d.tipomovimento = 'S' and d.tipomovimentofinanceiro = 'R' then 'venda'
         when d.modelo = 'TM' then 'devolucao'
         when d.tipomovimento = 'E' and d.tipomovimentofinanceiro = 'P' then 'entrada'
         when d.modelo = 'IM' then 'implantacao'
         when d.modelo = 'AS' then 'ajuste'
         when d.tipomovimento = 'E' then 'outra_entrada'
         when d.tipomovimento = 'S' then 'outra_saida'
         else 'outro' end as tipo,
       case
         when d._iddocumento is null then 'Movimento sem documento no sistema'
         when d.modelo = 'AS' then 'Ajuste de estoque (' || case when d.tipomovimento = 'E' then 'entrada' else 'saída' end || ')'
         when d.modelo = 'IM' then 'Implantação de estoque'
         when d.modelo in ('LA', 'LS') and n.descricao is null then 'Lançamento manual de ' || case when d.tipomovimento = 'E' then 'entrada' else 'saída' end
         else coalesce(upper(left(n.descricao, 1)) || lower(substring(n.descricao from 2)), d.modelo || ' ' || d.tipomovimento) end as operacao,
       d.status = 'C' as cancelado,
       h.antes,
       h.depois,
       h.quantidade,
       d._iddocumento as iddocumento,
       nullif(trim(concat_ws(' ', d.modelo, d.numero)), '') as documento,
       d.idusuario,
       coalesce(nullif(trim(concat_ws(' ', pu.nome, pu.sobrenome)), ''), case when d.idusuario is not null then 'Usuário nº ' || d.idusuario end) as usuario,
       d.idpessoa,
       nullif(trim(concat_ws(' ', pp.nome, pp.sobrenome)), '') as pessoa,
       it.valor,
       it.vendedora,
       h.registros
  -- O ERP grava uma linha por bipe/alteração (12 unidades bipadas = 12 linhas de -1): junta por documento e item.
  from (select x._iddocumento, x._idlocalestoque, x.idmercadoriavariacao, max(x.datahora) as datahora, min(x._idhistorico) as idh, count(*) as registros,
               (array_agg(x.qtdsaldoatual order by x.datahora, x._idhistorico))[1] as antes,
               (array_agg(x.qtdnovosaldo order by x.datahora desc, x._idhistorico desc))[1] as depois,
               sum(x.qtdnovosaldo - x.qtdsaldoatual) as quantidade
          from public.erp_mercadoria_estoque_historico x
         where (v is null or x.idmercadoriavariacao = v) and x.datahora >= de and x.datahora < ate
         group by x._iddocumento, x._idlocalestoque, x.idmercadoriavariacao) h
  left join public.erp_documento d on d._iddocumento = h._iddocumento
  left join public.erp_natureza_operacao n on n._idnatureza = d.idnaturezaoperacao and n._idempresa = d.idempresa
  -- documento.idusuario é o usuário do ERP; o nome vem do funcionário ligado a ele (pessoa_funcionario).
  left join lateral (
    select p2.nome, p2.sobrenome from public.erp_pessoa_funcionario f join public.erp_pessoa p2 on p2._idpessoa = f._idpessoa
     where f.idusuario = d.idusuario and f.idusuario <> 0 and f.sync_deleted_at is null
     order by (f._idempresa = d.idempresa) desc, f.flaginativo nulls last limit 1) pu on true
  left join public.erp_pessoa pp on pp._idpessoa = d.idpessoa
  left join lateral (
    select sum(dm.valtotalliquido) as valor,
           max(nullif(trim(concat_ws(' ', pf.nome, pf.sobrenome)), '')) as vendedora
      from public.erp_documento_mercadoria dm
      left join public.erp_pessoa pf on pf._idpessoa = dm.idpessoafuncionario
     where dm._iddocumento = h._iddocumento and dm.idmercadoriavariacao = h.idmercadoriavariacao) it on true
union all
select 'p' || t._idhistorico || '-' || t._idtabela,
       'preco', t.datahora, t._idmercadoriavariacao, null, 'preco',
       'Mudança de preço de venda' || case when t._idtabela <> 1 then ' (tabela ' || t._idtabela || ')' else '' end,
       false, t.valprecotual, t.valpreconovo, t.valpreconovo - t.valprecotual,
       null, null, t.idusuarioalteracao, nullif(trim(t.nomeusuarioalteracao), ''), null, null, null, null, 1::bigint
  from public.erp_mercadoria_tabela_preco_historico t
 where (v is null or t._idmercadoriavariacao = v) and t.datahora >= de and t.datahora < ate),
  f as (
    select l.*, n.nome as produto
      from l
      left join public.vw_variacao_nome n on n.idmercadoriavariacao = l.idmercadoriavariacao
     where (p_tipo is null or l.tipo = p_tipo or (p_tipo = 'saidas' and l.quantidade < 0 and l.origem = 'estoque') or (p_tipo = 'entradas' and l.quantidade > 0 and l.origem = 'estoque'))
       and (p_usuario is null or l.idusuario = p_usuario)
       and (busca is null or (busca ~ '^\d{1,9}$' and l.idmercadoriavariacao = busca::bigint) or n.nome ilike '%' || replace(busca, ' ', '%') || '%'))
  select (select count(*) from f),
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.datahora desc, x.id desc), '[]'::jsonb)
            from (select * from f order by datahora desc, id desc limit limite offset desloc) x)
    into total, linhas;
  return jsonb_build_object('linhas', linhas, 'total', total);
end $$;

-- Quem lançou movimentos (para o filtro por usuário).
create or replace function public.log_usuarios() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome, 'movimentos', u.n) order by u.n desc), '[]'::jsonb)
    from (select d.idusuario as id, coalesce(max(nullif(trim(concat_ws(' ', p.nome, p.sobrenome)), '')), 'Usuário nº ' || d.idusuario) as nome, count(distinct d._iddocumento) as n
            from public.erp_documento d
            left join public.erp_pessoa_funcionario f on f.idusuario = d.idusuario and f.idusuario <> 0 and f.sync_deleted_at is null
            left join public.erp_pessoa p on p._idpessoa = f._idpessoa
           where d.idusuario is not null group by d.idusuario) u
$$;

do $$
declare f text;
begin
  foreach f in array array['public.log_movimentos(jsonb)', 'public.log_usuarios()'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
