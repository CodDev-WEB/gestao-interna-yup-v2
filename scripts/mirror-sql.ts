// Gera o SQL das tabelas espelho a partir de src/sync/datasets.ts.
// Uso: npm run gen:sql   (escreve supabase/migrations/20261117010000_erp_mirror.sql)

import { columnType, mirrorTables, type ColType } from '../src/sync/datasets'

const PG: Record<ColType, string> = { int: 'bigint', num: 'numeric', text: 'text', date: 'date', ts: 'timestamptz' }

// Índices para as análises (além da chave primária).
const INDEXES: Record<string, string[]> = {
  documento: ['datahora', 'idpessoa', 'tipomovimento, tipomovimentofinanceiro, status'],
  documento_mercadoria: ['idmercadoriavariacao', 'idsecao'],
  mercadoria_variacao: ['idmercadoria'],
  mercadoria_estoque_historico: ['idmercadoriavariacao, datahora'],
  mercadoria_tabela_preco_historico: ['_idmercadoriavariacao, datahora'],
}

export function mirrorSql(): string {
  const out: string[] = [
    '-- GERADO por scripts/mirror-sql.ts a partir de src/sync/datasets.ts. Não edite à mão: rode `npm run gen:sql`.',
    '-- Espelho das tabelas do ERP (Santarém Sistemas). Idempotente: cria o que falta e acrescenta colunas novas.',
    '-- RLS ligado e sem políticas: só a service_role (Worker) lê e grava.',
    '',
  ]
  for (const d of mirrorTables()) {
    const t = `public.erp_${d.table}`
    out.push(`create table if not exists ${t} (`)
    for (const k of d.keys) out.push(`  ${k} ${PG[columnType(k)]} not null,`)
    out.push('  sync_seen_at timestamptz not null default now(),')
    out.push('  sync_deleted_at timestamptz,')
    out.push(`  primary key (${d.keys.join(', ')})`)
    out.push(');')
    for (const c of d.columns.filter(c => !d.keys.includes(c))) out.push(`alter table ${t} add column if not exists ${c} ${PG[columnType(c)]};`)
    out.push(`alter table ${t} enable row level security;`)
    out.push(`create index if not exists erp_${d.table}_seen_idx on ${t} (sync_seen_at);`)
    for (const [i, cols] of (INDEXES[d.table] ?? []).entries()) out.push(`create index if not exists erp_${d.table}_ix${i + 1} on ${t} (${cols});`)
    out.push('')
  }
  return out.join('\n')
}

if (process.argv[1]?.endsWith('mirror-sql.ts')) {
  const { writeFileSync } = await import('node:fs')
  const file = new URL('../supabase/migrations/20261117010000_erp_mirror.sql', import.meta.url)
  writeFileSync(file, mirrorSql())
  console.log('Gerado:', file.pathname)
}
