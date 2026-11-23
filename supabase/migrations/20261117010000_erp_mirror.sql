-- GERADO por scripts/mirror-sql.ts a partir de src/sync/datasets.ts. Não edite à mão: rode `npm run gen:sql`.
-- Espelho das tabelas do ERP (Santarém Sistemas). Idempotente: cria o que falta e acrescenta colunas novas.
-- RLS ligado e sem políticas: só a service_role (Worker) lê e grava.

create table if not exists public.erp_documento (
  _iddocumento bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_iddocumento)
);
alter table public.erp_documento add column if not exists idempresa bigint;
alter table public.erp_documento add column if not exists idpessoa bigint;
alter table public.erp_documento add column if not exists idusuario bigint;
alter table public.erp_documento add column if not exists datahora timestamptz;
alter table public.erp_documento add column if not exists datahoramovimento timestamptz;
alter table public.erp_documento add column if not exists numero text;
alter table public.erp_documento add column if not exists serie text;
alter table public.erp_documento add column if not exists modelo text;
alter table public.erp_documento add column if not exists tipomovimento text;
alter table public.erp_documento add column if not exists tipomovimentoestoque text;
alter table public.erp_documento add column if not exists tipomovimentofinanceiro text;
alter table public.erp_documento add column if not exists idnaturezaoperacao bigint;
alter table public.erp_documento add column if not exists status text;
alter table public.erp_documento enable row level security;
create index if not exists erp_documento_seen_idx on public.erp_documento (sync_seen_at);
create index if not exists erp_documento_ix1 on public.erp_documento (datahora);
create index if not exists erp_documento_ix2 on public.erp_documento (idpessoa);
create index if not exists erp_documento_ix3 on public.erp_documento (tipomovimento, tipomovimentofinanceiro, status);

create table if not exists public.erp_documento_mercadoria (
  _iddocumento bigint not null,
  _idsequencia bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_iddocumento, _idsequencia)
);
alter table public.erp_documento_mercadoria add column if not exists idmercadoria bigint;
alter table public.erp_documento_mercadoria add column if not exists idmercadoriavariacao bigint;
alter table public.erp_documento_mercadoria add column if not exists descricao text;
alter table public.erp_documento_mercadoria add column if not exists qtd numeric;
alter table public.erp_documento_mercadoria add column if not exists qtdfator numeric;
alter table public.erp_documento_mercadoria add column if not exists qtdestoque numeric;
alter table public.erp_documento_mercadoria add column if not exists qtddevolucao numeric;
alter table public.erp_documento_mercadoria add column if not exists valunitarioliquido numeric;
alter table public.erp_documento_mercadoria add column if not exists valtotalbruto numeric;
alter table public.erp_documento_mercadoria add column if not exists valtotalliquido numeric;
alter table public.erp_documento_mercadoria add column if not exists valdesconto numeric;
alter table public.erp_documento_mercadoria add column if not exists valacrescimo numeric;
alter table public.erp_documento_mercadoria add column if not exists valdescontocashback numeric;
alter table public.erp_documento_mercadoria add column if not exists idsecao bigint;
alter table public.erp_documento_mercadoria add column if not exists idgrupo bigint;
alter table public.erp_documento_mercadoria add column if not exists idsubgrupo bigint;
alter table public.erp_documento_mercadoria add column if not exists idmarca bigint;
alter table public.erp_documento_mercadoria add column if not exists idlocalestoque bigint;
alter table public.erp_documento_mercadoria add column if not exists idpessoafuncionario bigint;
alter table public.erp_documento_mercadoria add column if not exists lote text;
alter table public.erp_documento_mercadoria add column if not exists dtvalidade date;
alter table public.erp_documento_mercadoria add column if not exists flagbonificacao text;
alter table public.erp_documento_mercadoria add column if not exists iddocumentoorigem bigint;
alter table public.erp_documento_mercadoria enable row level security;
create index if not exists erp_documento_mercadoria_seen_idx on public.erp_documento_mercadoria (sync_seen_at);
create index if not exists erp_documento_mercadoria_ix1 on public.erp_documento_mercadoria (idmercadoriavariacao);
create index if not exists erp_documento_mercadoria_ix2 on public.erp_documento_mercadoria (idsecao);

create table if not exists public.erp_documento_mercadoria_custo (
  _iddocumento bigint not null,
  _idsequencia bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_iddocumento, _idsequencia)
);
alter table public.erp_documento_mercadoria_custo add column if not exists idmercadoriavariacao bigint;
alter table public.erp_documento_mercadoria_custo add column if not exists valcusto numeric;
alter table public.erp_documento_mercadoria_custo add column if not exists valcustomedio numeric;
alter table public.erp_documento_mercadoria_custo add column if not exists valfrete numeric;
alter table public.erp_documento_mercadoria_custo add column if not exists valipi numeric;
alter table public.erp_documento_mercadoria_custo add column if not exists valicmsst numeric;
alter table public.erp_documento_mercadoria_custo add column if not exists valoutroscustos numeric;
alter table public.erp_documento_mercadoria_custo enable row level security;
create index if not exists erp_documento_mercadoria_custo_seen_idx on public.erp_documento_mercadoria_custo (sync_seen_at);

create table if not exists public.erp_mercadoria_secao (
  _idsecao bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idsecao)
);
alter table public.erp_mercadoria_secao add column if not exists descricao text;
alter table public.erp_mercadoria_secao add column if not exists flaginativo text;
alter table public.erp_mercadoria_secao enable row level security;
create index if not exists erp_mercadoria_secao_seen_idx on public.erp_mercadoria_secao (sync_seen_at);

create table if not exists public.erp_mercadoria_grupo (
  _idgrupo bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idgrupo)
);
alter table public.erp_mercadoria_grupo add column if not exists descricao text;
alter table public.erp_mercadoria_grupo add column if not exists flaginativo text;
alter table public.erp_mercadoria_grupo enable row level security;
create index if not exists erp_mercadoria_grupo_seen_idx on public.erp_mercadoria_grupo (sync_seen_at);

create table if not exists public.erp_mercadoria_subgrupo (
  _idsubgrupo bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idsubgrupo)
);
alter table public.erp_mercadoria_subgrupo add column if not exists descricao text;
alter table public.erp_mercadoria_subgrupo add column if not exists flaginativo text;
alter table public.erp_mercadoria_subgrupo enable row level security;
create index if not exists erp_mercadoria_subgrupo_seen_idx on public.erp_mercadoria_subgrupo (sync_seen_at);

create table if not exists public.erp_mercadoria_marca (
  _idmarca bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idmarca)
);
alter table public.erp_mercadoria_marca add column if not exists descricao text;
alter table public.erp_mercadoria_marca add column if not exists flaginativo text;
alter table public.erp_mercadoria_marca enable row level security;
create index if not exists erp_mercadoria_marca_seen_idx on public.erp_mercadoria_marca (sync_seen_at);

create table if not exists public.erp_natureza_operacao (
  _idempresa bigint not null,
  _idnatureza bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idnatureza)
);
alter table public.erp_natureza_operacao add column if not exists descricao text;
alter table public.erp_natureza_operacao add column if not exists tipomovimento text;
alter table public.erp_natureza_operacao add column if not exists tipocategoria text;
alter table public.erp_natureza_operacao add column if not exists cfop text;
alter table public.erp_natureza_operacao add column if not exists flagmovimentarestoque text;
alter table public.erp_natureza_operacao add column if not exists flagmovimentarfinanceiro text;
alter table public.erp_natureza_operacao add column if not exists flagmovimentarcusto text;
alter table public.erp_natureza_operacao add column if not exists flaginativo text;
alter table public.erp_natureza_operacao enable row level security;
create index if not exists erp_natureza_operacao_seen_idx on public.erp_natureza_operacao (sync_seen_at);

create table if not exists public.erp_local_estoque (
  _idempresa bigint not null,
  _idlocal bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idlocal)
);
alter table public.erp_local_estoque add column if not exists descricao text;
alter table public.erp_local_estoque add column if not exists flaginativo text;
alter table public.erp_local_estoque enable row level security;
create index if not exists erp_local_estoque_seen_idx on public.erp_local_estoque (sync_seen_at);

create table if not exists public.erp_mercadoria (
  _idmercadoria bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idmercadoria)
);
alter table public.erp_mercadoria add column if not exists descricao text;
alter table public.erp_mercadoria add column if not exists referencia text;
alter table public.erp_mercadoria add column if not exists idtipo bigint;
alter table public.erp_mercadoria add column if not exists idsecao bigint;
alter table public.erp_mercadoria add column if not exists idgrupo bigint;
alter table public.erp_mercadoria add column if not exists idsubgrupo bigint;
alter table public.erp_mercadoria add column if not exists dtalteracao timestamptz;
alter table public.erp_mercadoria add column if not exists ncm text;
alter table public.erp_mercadoria add column if not exists cest text;
alter table public.erp_mercadoria enable row level security;
create index if not exists erp_mercadoria_seen_idx on public.erp_mercadoria (sync_seen_at);

create table if not exists public.erp_mercadoria_variacao (
  _idmercadoriavariacao bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idmercadoriavariacao)
);
alter table public.erp_mercadoria_variacao add column if not exists idmercadoria bigint;
alter table public.erp_mercadoria_variacao add column if not exists descricao text;
alter table public.erp_mercadoria_variacao add column if not exists referencia text;
alter table public.erp_mercadoria_variacao add column if not exists codigobarras text;
alter table public.erp_mercadoria_variacao add column if not exists embalagem text;
alter table public.erp_mercadoria_variacao add column if not exists marca text;
alter table public.erp_mercadoria_variacao add column if not exists idmarca bigint;
alter table public.erp_mercadoria_variacao add column if not exists dtalteracao timestamptz;
alter table public.erp_mercadoria_variacao add column if not exists ncm text;
alter table public.erp_mercadoria_variacao add column if not exists cest text;
alter table public.erp_mercadoria_variacao enable row level security;
create index if not exists erp_mercadoria_variacao_seen_idx on public.erp_mercadoria_variacao (sync_seen_at);
create index if not exists erp_mercadoria_variacao_ix1 on public.erp_mercadoria_variacao (idmercadoria);

create table if not exists public.erp_ncm (
  _ncm text not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_ncm)
);
alter table public.erp_ncm add column if not exists descricao text;
alter table public.erp_ncm enable row level security;
create index if not exists erp_ncm_seen_idx on public.erp_ncm (sync_seen_at);

create table if not exists public.erp_pessoa (
  _idpessoa bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idpessoa)
);
alter table public.erp_pessoa add column if not exists nome text;
alter table public.erp_pessoa add column if not exists sobrenome text;
alter table public.erp_pessoa add column if not exists tipo text;
alter table public.erp_pessoa add column if not exists idgrupo bigint;
alter table public.erp_pessoa add column if not exists datacadastro timestamptz;
alter table public.erp_pessoa add column if not exists dataalteracao timestamptz;
alter table public.erp_pessoa add column if not exists dataclientedesde date;
alter table public.erp_pessoa add column if not exists flaginativo text;
alter table public.erp_pessoa enable row level security;
create index if not exists erp_pessoa_seen_idx on public.erp_pessoa (sync_seen_at);

create table if not exists public.erp_pessoa_funcionario (
  _idempresa bigint not null,
  _idpessoa bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idpessoa)
);
alter table public.erp_pessoa_funcionario add column if not exists idusuario bigint;
alter table public.erp_pessoa_funcionario add column if not exists tipo text;
alter table public.erp_pessoa_funcionario add column if not exists flaginativo text;
alter table public.erp_pessoa_funcionario add column if not exists idequipe bigint;
alter table public.erp_pessoa_funcionario enable row level security;
create index if not exists erp_pessoa_funcionario_seen_idx on public.erp_pessoa_funcionario (sync_seen_at);

create table if not exists public.erp_mercadoria_fornecedor (
  _idmercadoriavariacao bigint not null,
  _idpessoa bigint not null,
  _embalagem text not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idmercadoriavariacao, _idpessoa, _embalagem)
);
alter table public.erp_mercadoria_fornecedor add column if not exists qtdfator numeric;
alter table public.erp_mercadoria_fornecedor add column if not exists codigoexterno text;
alter table public.erp_mercadoria_fornecedor enable row level security;
create index if not exists erp_mercadoria_fornecedor_seen_idx on public.erp_mercadoria_fornecedor (sync_seen_at);

create table if not exists public.erp_mercadoria_estoque (
  _idempresa bigint not null,
  _idlocalestoque bigint not null,
  _idmercadoriavariacao bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idlocalestoque, _idmercadoriavariacao)
);
alter table public.erp_mercadoria_estoque add column if not exists qtdsaldo numeric;
alter table public.erp_mercadoria_estoque add column if not exists qtdsaldoreserva numeric;
alter table public.erp_mercadoria_estoque add column if not exists datahora timestamptz;
alter table public.erp_mercadoria_estoque enable row level security;
create index if not exists erp_mercadoria_estoque_seen_idx on public.erp_mercadoria_estoque (sync_seen_at);

create table if not exists public.erp_mercadoria_custo (
  _idempresa bigint not null,
  _idmercadoriavariacao bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idmercadoriavariacao)
);
alter table public.erp_mercadoria_custo add column if not exists valcusto numeric;
alter table public.erp_mercadoria_custo add column if not exists valcustomedio numeric;
alter table public.erp_mercadoria_custo add column if not exists datahora timestamptz;
alter table public.erp_mercadoria_custo enable row level security;
create index if not exists erp_mercadoria_custo_seen_idx on public.erp_mercadoria_custo (sync_seen_at);

create table if not exists public.erp_mercadoria_estoque_lote (
  _idempresa bigint not null,
  _idlocalestoque bigint not null,
  _idmercadoriavariacao bigint not null,
  _lote text not null,
  _dtvalidade date not null,
  _dtentrada date not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idlocalestoque, _idmercadoriavariacao, _lote, _dtvalidade, _dtentrada)
);
alter table public.erp_mercadoria_estoque_lote add column if not exists qtdsaldo numeric;
alter table public.erp_mercadoria_estoque_lote add column if not exists datahora timestamptz;
alter table public.erp_mercadoria_estoque_lote add column if not exists dtfabricacao date;
alter table public.erp_mercadoria_estoque_lote enable row level security;
create index if not exists erp_mercadoria_estoque_lote_seen_idx on public.erp_mercadoria_estoque_lote (sync_seen_at);

create table if not exists public.erp_mercadoria_tabela_preco (
  _idempresa bigint not null,
  _idmercadoriavariacao bigint not null,
  _idtabela bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idempresa, _idmercadoriavariacao, _idtabela)
);
alter table public.erp_mercadoria_tabela_preco add column if not exists valpreco numeric;
alter table public.erp_mercadoria_tabela_preco add column if not exists valcusto numeric;
alter table public.erp_mercadoria_tabela_preco add column if not exists flaginativo text;
alter table public.erp_mercadoria_tabela_preco add column if not exists dtalteracao timestamptz;
alter table public.erp_mercadoria_tabela_preco enable row level security;
create index if not exists erp_mercadoria_tabela_preco_seen_idx on public.erp_mercadoria_tabela_preco (sync_seen_at);

create table if not exists public.erp_inventario (
  _idinventario bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idinventario)
);
alter table public.erp_inventario add column if not exists idempresa bigint;
alter table public.erp_inventario add column if not exists descricao text;
alter table public.erp_inventario add column if not exists idlocalestoque bigint;
alter table public.erp_inventario add column if not exists status text;
alter table public.erp_inventario add column if not exists datahora timestamptz;
alter table public.erp_inventario add column if not exists iddocumento bigint;
alter table public.erp_inventario add column if not exists tipofinalidade text;
alter table public.erp_inventario enable row level security;
create index if not exists erp_inventario_seen_idx on public.erp_inventario (sync_seen_at);

create table if not exists public.erp_inventario_mercadoria (
  _idinventario bigint not null,
  _idsequencia bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idinventario, _idsequencia)
);
alter table public.erp_inventario_mercadoria add column if not exists idmercadoriavariacao bigint;
alter table public.erp_inventario_mercadoria add column if not exists datahora timestamptz;
alter table public.erp_inventario_mercadoria add column if not exists qtdcontada numeric;
alter table public.erp_inventario_mercadoria add column if not exists qtdanterior numeric;
alter table public.erp_inventario_mercadoria add column if not exists valcusto numeric;
alter table public.erp_inventario_mercadoria add column if not exists valcustomedio numeric;
alter table public.erp_inventario_mercadoria add column if not exists lote text;
alter table public.erp_inventario_mercadoria add column if not exists dtvalidade date;
alter table public.erp_inventario_mercadoria enable row level security;
create index if not exists erp_inventario_mercadoria_seen_idx on public.erp_inventario_mercadoria (sync_seen_at);

create table if not exists public.erp_documento_cancelamento_historico (
  _iddocumento bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_iddocumento)
);
alter table public.erp_documento_cancelamento_historico add column if not exists datahora timestamptz;
alter table public.erp_documento_cancelamento_historico add column if not exists motivo text;
alter table public.erp_documento_cancelamento_historico enable row level security;
create index if not exists erp_documento_cancelamento_historico_seen_idx on public.erp_documento_cancelamento_historico (sync_seen_at);

create table if not exists public.erp_mercadoria_tabela_preco_historico (
  _idhistorico bigint not null,
  _idempresa bigint not null,
  _idmercadoriavariacao bigint not null,
  _idtabela bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idhistorico, _idempresa, _idmercadoriavariacao, _idtabela)
);
alter table public.erp_mercadoria_tabela_preco_historico add column if not exists datahora timestamptz;
alter table public.erp_mercadoria_tabela_preco_historico add column if not exists valprecotual numeric;
alter table public.erp_mercadoria_tabela_preco_historico add column if not exists valpreconovo numeric;
alter table public.erp_mercadoria_tabela_preco_historico add column if not exists idusuarioalteracao bigint;
alter table public.erp_mercadoria_tabela_preco_historico add column if not exists nomeusuarioalteracao text;
alter table public.erp_mercadoria_tabela_preco_historico enable row level security;
create index if not exists erp_mercadoria_tabela_preco_historico_seen_idx on public.erp_mercadoria_tabela_preco_historico (sync_seen_at);
create index if not exists erp_mercadoria_tabela_preco_historico_ix1 on public.erp_mercadoria_tabela_preco_historico (_idmercadoriavariacao, datahora);

create table if not exists public.erp_mercadoria_estoque_historico (
  _idhistorico bigint not null,
  _iddocumento bigint not null,
  _idlocalestoque bigint not null,
  sync_seen_at timestamptz not null default now(),
  sync_deleted_at timestamptz,
  primary key (_idhistorico, _iddocumento, _idlocalestoque)
);
alter table public.erp_mercadoria_estoque_historico add column if not exists idmercadoriavariacao bigint;
alter table public.erp_mercadoria_estoque_historico add column if not exists datahora timestamptz;
alter table public.erp_mercadoria_estoque_historico add column if not exists qtdsaldoatual numeric;
alter table public.erp_mercadoria_estoque_historico add column if not exists qtdnovosaldo numeric;
alter table public.erp_mercadoria_estoque_historico enable row level security;
create index if not exists erp_mercadoria_estoque_historico_seen_idx on public.erp_mercadoria_estoque_historico (sync_seen_at);
create index if not exists erp_mercadoria_estoque_historico_ix1 on public.erp_mercadoria_estoque_historico (idmercadoriavariacao, datahora);
