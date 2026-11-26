-- Amostra aleatória de produtos (com estoque ou movimento) para o relatório do produto: n itens sorteados,
-- opcionalmente de uma situação e/ou setor. Idempotente.
create or replace function public.produtos_amostra(p_n integer, p_situacao text default null, p_setor text default null) returns jsonb
language sql volatile security definer set search_path = public, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('idmercadoriavariacao', x.idmercadoriavariacao, 'descricao', x.descricao)), '[]'::jsonb)
    from (select idmercadoriavariacao, descricao from public.vw_produto_ncm
           where (p_situacao is null or situacao = p_situacao) and (p_setor is null or setor = p_setor)
           order by random() limit least(greatest(coalesce(p_n, 5), 1), 50)) x
$$;
revoke execute on function public.produtos_amostra(integer, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.produtos_amostra(integer, text, text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke execute on function public.produtos_amostra(integer, text, text) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.produtos_amostra(integer, text, text) to service_role'; end if;
end $$;
