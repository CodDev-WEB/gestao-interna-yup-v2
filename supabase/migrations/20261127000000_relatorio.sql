-- Relatório montado pelo usuário: fonte, período, agrupamentos, métricas, filtros e ordem escolhidos na tela.
-- Tudo passa por listas fechadas (nada do navegador vira SQL); os valores vão como parâmetros. Idempotente.
--
-- relatorio(p) com p = {
--   fonte: vendas | compras | devolucoes | estoque | validades,
--   de, ate: 'AAAA-MM-DD' (estoque ignora; validades filtra pela data de validade),
--   grupos: [dia | semana | mes | ano | empresa | item | setor | secao | vendedora | cliente | fornecedor | documento | faixa | lote] (até 3),
--   metricas: [qtd | bruto | desconto | liquido | custo | lucro | margem | documentos | itens | ticket | clientes | produtos],
--   filtros: { empresa, vendedora, cliente, fornecedor, setor, secao, produto (texto ou código), faixa },
--   ordem: nome de métrica ou grupo, dir: asc | desc, limite: 1..5000 }
-- devolve { linhas: [...], totais: {...}, total_linhas, limitado }

create or replace function public.relatorio(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  fonte text := coalesce(p->>'fonte', 'vendas');
  de date := coalesce(nullif(p->>'de', '')::date, date '1900-01-01');
  ate date := coalesce(nullif(p->>'ate', '')::date, date '2999-12-31');
  f jsonb := coalesce(p->'filtros', '{}'::jsonb);
  limite int := least(greatest(coalesce((p->>'limite')::int, 1000), 1), 5000);
  base text; onde text := 'true'; sel text := ''; grp text := ''; tot text := ''; ord text; g text; m text;
  grupos text[] := array(select jsonb_array_elements_text(coalesce(p->'grupos', '[]'::jsonb)));
  metricas text[] := array(select jsonb_array_elements_text(coalesce(p->'metricas', '["liquido"]'::jsonb)));
  dims jsonb := jsonb_build_object(
    'dia',        jsonb_build_array('b.data', 'b.data as dia'),
    'semana',     jsonb_build_array('date_trunc(''week'', b.data)::date', 'date_trunc(''week'', b.data)::date as semana'),
    'mes',        jsonb_build_array('to_char(b.data, ''YYYY-MM'')', 'to_char(b.data, ''YYYY-MM'') as mes'),
    'ano',        jsonb_build_array('extract(year from b.data)::int', 'extract(year from b.data)::int as ano'),
    'empresa',    jsonb_build_array('b.idempresa', 'b.idempresa as empresa'),
    'item',       jsonb_build_array('b.idmercadoriavariacao', 'b.idmercadoriavariacao as variacao, max(b.idmercadoria) as codigo, max(b.item) as produto'),
    'setor',      jsonb_build_array('coalesce(b.setor, ''Não classificado'')', 'coalesce(b.setor, ''Não classificado'') as setor'),
    'secao',      jsonb_build_array('coalesce(b.secao, ''Sem seção'')', 'coalesce(b.secao, ''Sem seção'') as secao'),
    'vendedora',  jsonb_build_array('b.vendedora_id', 'b.vendedora_id as codigo_vendedora, coalesce(max(b.vendedora), ''Sem vendedora'') as vendedora'),
    'cliente',    jsonb_build_array('b.cliente_id', 'b.cliente_id as codigo_cliente, coalesce(max(b.cliente), ''Sem cliente'') as cliente'),
    'fornecedor', jsonb_build_array('b.fornecedor_id', 'b.fornecedor_id as codigo_fornecedor, coalesce(max(b.fornecedor), ''Sem fornecedor'') as fornecedor'),
    'documento',  jsonb_build_array('b.documento', 'b.documento as documento, min(b.data) as data_documento'),
    'faixa',      jsonb_build_array('b.faixa', 'b.faixa as faixa'),
    'lote',       jsonb_build_array('b.idmercadoriavariacao, b.lote, b.data', 'b.lote as lote, b.data as validade, max(b.idmercadoria) as codigo, max(b.item) as produto'));
  mets jsonb := jsonb_build_object(
    'qtd',        'sum(b.qtd)',
    'bruto',      'sum(b.bruto)',
    'desconto',   'sum(b.desconto)',
    'liquido',    'sum(b.liquido)',
    'custo',      'sum(b.custo)',
    'lucro',      'sum(b.lucro)',
    'margem',     'round(sum(b.lucro) * 100 / nullif(sum(b.liquido), 0), 2)',
    'documentos', 'count(distinct b.documento)',
    'itens',      'count(*)',
    'ticket',     'round(sum(b.liquido) / nullif(count(distinct b.documento), 0), 2)',
    'clientes',   'count(distinct b.cliente_id)',
    'produtos',   'count(distinct b.idmercadoriavariacao)');
  nome_pessoa constant text := 'nullif(trim(concat_ws('' '', %1$s.nome, %1$s.sobrenome)), '''')';
  resultado jsonb; totais jsonb; n bigint;
begin
  if array_length(grupos, 1) > 3 then raise exception 'Escolha no máximo 3 agrupamentos.'; end if;
  if coalesce(array_length(metricas, 1), 0) = 0 then raise exception 'Escolha pelo menos uma métrica.'; end if;

  base := case fonte
    when 'vendas' then format($q$
      select v.data, v.idempresa, v.idmercadoriavariacao, n.idmercadoria, n.nome as item, c.setor, sc.descricao as secao,
             v.idpessoafuncionario as vendedora_id, %s as vendedora, v.idcliente as cliente_id, %s as cliente,
             null::bigint as fornecedor_id, null::text as fornecedor, v.iddocumento as documento, null::text as lote, null::text as faixa,
             v.qtd, v.valtotalbruto as bruto, v.valdesconto as desconto, v.valtotalliquido as liquido, v.custo_total as custo, v.lucro_bruto as lucro
        from public.vw_venda_item v
        left join public.vw_variacao_nome n on n.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.vw_produto_classe c on c.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.erp_mercadoria_secao sc on sc._idsecao = v.idsecao
        left join public.erp_pessoa pf on pf._idpessoa = v.idpessoafuncionario
        left join public.erp_pessoa pc on pc._idpessoa = v.idcliente
       where v.data between $1 and $2$q$, format(nome_pessoa, 'pf'), format(nome_pessoa, 'pc'))
    when 'devolucoes' then format($q$
      select v.data, v.idempresa, v.idmercadoriavariacao, n.idmercadoria, n.nome as item, c.setor, sc.descricao as secao,
             v.idpessoafuncionario as vendedora_id, %s as vendedora, v.idcliente as cliente_id, %s as cliente,
             null::bigint as fornecedor_id, null::text as fornecedor, v.iddocumento as documento, null::text as lote, null::text as faixa,
             v.qtd, null::numeric as bruto, null::numeric as desconto, v.valtotalliquido as liquido, null::numeric as custo, null::numeric as lucro
        from public.vw_devolucao_item v
        left join public.vw_variacao_nome n on n.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.vw_produto_classe c on c.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.erp_mercadoria m on m._idmercadoria = n.idmercadoria
        left join public.erp_mercadoria_secao sc on sc._idsecao = m.idsecao
        left join public.erp_pessoa pf on pf._idpessoa = v.idpessoafuncionario
        left join public.erp_pessoa pc on pc._idpessoa = v.idcliente
       where v.data between $1 and $2$q$, format(nome_pessoa, 'pf'), format(nome_pessoa, 'pc'))
    when 'compras' then format($q$
      select v.data, v.idempresa, v.idmercadoriavariacao, v.idmercadoria, coalesce(n.nome, v.descricao) as item, c.setor, sc.descricao as secao,
             null::bigint as vendedora_id, null::text as vendedora, null::bigint as cliente_id, null::text as cliente,
             v.idfornecedor as fornecedor_id, %s as fornecedor, v.iddocumento as documento, v.lote, null::text as faixa,
             coalesce(v.qtdestoque, v.qtd) as qtd, null::numeric as bruto, null::numeric as desconto, v.valtotalliquido as liquido,
             v.valtotalliquido as custo, null::numeric as lucro
        from public.vw_compra_item v
        left join public.vw_variacao_nome n on n.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.vw_produto_classe c on c.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.erp_mercadoria m on m._idmercadoria = v.idmercadoria
        left join public.erp_mercadoria_secao sc on sc._idsecao = m.idsecao
        left join public.erp_pessoa pf on pf._idpessoa = v.idfornecedor
       where v.data between $1 and $2$q$, format(nome_pessoa, 'pf'))
    when 'estoque' then $q$
      select null::date as data, null::bigint as idempresa, v.idmercadoriavariacao, v.idmercadoria, v.descricao as item, v.setor, v.secao,
             null::bigint as vendedora_id, null::text as vendedora, null::bigint as cliente_id, null::text as cliente,
             null::bigint as fornecedor_id, null::text as fornecedor, null::bigint as documento, null::text as lote, v.situacao as faixa,
             v.estoque_atual as qtd, null::numeric as bruto, null::numeric as desconto, null::numeric as liquido, v.valor_estoque as custo, null::numeric as lucro
        from public.vw_produto_ncm v
       where v.estoque_atual <> 0 and $1 is not null and $2 is not null$q$
    when 'validades' then $q$
      select v.dtvalidade as data, v.idempresa, v.idmercadoriavariacao, n.idmercadoria, v.descricao as item, c.setor, null::text as secao,
             null::bigint as vendedora_id, null::text as vendedora, null::bigint as cliente_id, null::text as cliente,
             null::bigint as fornecedor_id, null::text as fornecedor, null::bigint as documento, v.lote, v.faixa,
             v.qtdsaldo as qtd, null::numeric as bruto, null::numeric as desconto, null::numeric as liquido, v.valor_em_risco as custo, null::numeric as lucro
        from public.vw_lote_disponivel v
        left join public.vw_variacao_nome n on n.idmercadoriavariacao = v.idmercadoriavariacao
        left join public.vw_produto_classe c on c.idmercadoriavariacao = v.idmercadoriavariacao
       where v.dtvalidade between $1 and $2$q$
    else null end;
  if base is null then raise exception 'Fonte de dados inválida: %', fonte; end if;

  -- Filtros (valores como parâmetro $3).
  if f ? 'empresa'    then onde := onde || ' and b.idempresa = ($3->>''empresa'')::bigint'; end if;
  if f ? 'vendedora'  then onde := onde || ' and coalesce(b.vendedora_id, 0) = ($3->>''vendedora'')::bigint'; end if;
  if f ? 'cliente'    then onde := onde || ' and b.cliente_id = ($3->>''cliente'')::bigint'; end if;
  if f ? 'fornecedor' then onde := onde || ' and b.fornecedor_id = ($3->>''fornecedor'')::bigint'; end if;
  if f ? 'setor'      then onde := onde || ' and coalesce(b.setor, ''Não classificado'') = ($3->>''setor'')'; end if;
  if f ? 'secao'      then onde := onde || ' and b.secao ilike ''%'' || ($3->>''secao'') || ''%'''; end if;
  if f ? 'faixa'      then onde := onde || ' and b.faixa = ($3->>''faixa'')'; end if;
  if f ? 'produto' then
    onde := onde || case when (f->>'produto') ~ '^\d{1,9}$'
      then ' and (b.idmercadoria = ($3->>''produto'')::bigint or b.idmercadoriavariacao = ($3->>''produto'')::bigint)'
      else ' and b.item ilike ''%'' || replace($3->>''produto'', '' '', ''%'') || ''%''' end;
  end if;

  foreach g in array grupos loop
    if not dims ? g then raise exception 'Agrupamento inválido: %', g; end if;
    sel := sel || (dims->g->>1) || ', ';
    grp := grp || (case when grp = '' then '' else ', ' end) || (dims->g->>0);
  end loop;
  foreach m in array metricas loop
    if not mets ? m then raise exception 'Métrica inválida: %', m; end if;
    sel := sel || (mets->>m) || ' as ' || m || ', ';
    tot := tot || (mets->>m) || ' as ' || m || ', ';
  end loop;
  sel := left(sel, length(sel) - 2); tot := left(tot, length(tot) - 2);

  ord := coalesce(p->>'ordem', '');
  if not (ord = any(metricas) or (ord = any(grupos) and ord not in ('item', 'vendedora', 'cliente', 'fornecedor', 'documento', 'lote'))) then
    ord := case when array_length(grupos, 1) > 0 and grupos[1] in ('dia', 'semana', 'mes', 'ano') then grupos[1] else metricas[1] end;
  end if;
  if ord = any(grupos) and ord not in ('dia', 'semana', 'mes', 'ano', 'empresa', 'setor', 'secao', 'faixa') then ord := metricas[1]; end if;
  ord := ord || case when lower(coalesce(p->>'dir', '')) = 'asc' or (p->>'dir' is null and ord in ('dia', 'semana', 'mes', 'ano')) then ' asc' else ' desc' end || ' nulls last';

  execute format('select jsonb_build_object(%s) from (%s) b where %s',
                 (select string_agg(format('%L, %s', x, mets->>x), ', ') from unnest(metricas) x), base, onde)
    into totais using de, ate, f;

  if array_length(grupos, 1) > 0 then
    execute format('select count(*) from (select 1 from (%s) b where %s group by %s) q', base, onde, grp) into n using de, ate, f;
    execute format('select coalesce(jsonb_agg(to_jsonb(r) - ''_ordem'' order by r._ordem), ''[]''::jsonb) from (select row_number() over (order by %s) as _ordem, x.* from (select %s from (%s) b where %s group by %s) x order by %s limit %s) r',
                   ord, sel, base, onde, grp, ord, limite) into resultado using de, ate, f;
  else
    n := 1; resultado := jsonb_build_array(totais);
  end if;
  return jsonb_build_object('linhas', resultado, 'totais', totais, 'total_linhas', n, 'limitado', n > limite);
end $$;

revoke execute on function public.relatorio(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.relatorio(jsonb) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function public.relatorio(jsonb) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.relatorio(jsonb) to service_role'; end if;
end $$;
