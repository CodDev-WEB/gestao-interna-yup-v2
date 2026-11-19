-- Avisos de leitura: valores impossíveis vindos do ERP que NÃO pararam a sincronização
-- (gravados em branco, ou registro pulado quando a data faz parte da chave). Idempotente.
create table if not exists public.sync_avisos (
  chave        text primary key,          -- tabela|coluna|chave do registro no ERP
  dataset      text,
  tabela       text not null,
  coluna       text not null,
  valor        text,
  motivo       text,
  acao         text not null,             -- 'em_branco' | 'ignorado'
  registro     jsonb,                     -- colunas que identificam o registro (item, lote, documento...)
  primeira_vez timestamptz not null default now(),
  ultima_vez   timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists sync_avisos_abertos_idx on public.sync_avisos (ultima_vez desc) where resolvido_em is null;
alter table public.sync_avisos enable row level security;
