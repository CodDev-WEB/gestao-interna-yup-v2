// Descoberta de colunas do ERP (só leitura): mostra onde ficam NCM, CEST e a classificação do produto,
// para o espelho copiar o campo certo. O resultado vai para sync_runs (dataset 'erp_schema').

import type { ErpClient } from './client'
import { assertReadOnly } from '../sync/sql'

const SONDAS: { nome: string; sql: string; limite: number }[] = [
  { nome: 'colunas_fiscais', limite: 100, sql: "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND (column_name ILIKE '%ncm%' OR column_name ILIKE '%cest%' OR table_name ILIKE '%ncm%' OR table_name ILIKE '%fiscal%' OR table_name ILIKE '%tribut%') ORDER BY table_name, column_name" },
  { nome: 'mercadoria', limite: 2, sql: 'SELECT * FROM mercadoria t ORDER BY t.idmercadoria' },
  { nome: 'mercadoria_variacao', limite: 2, sql: 'SELECT * FROM mercadoria_variacao t ORDER BY t.idmercadoriavariacao' },
  { nome: 'mercadoria_grupo', limite: 3, sql: 'SELECT * FROM mercadoria_grupo t ORDER BY t.idgrupo' },
  { nome: 'mercadoria_subgrupo', limite: 3, sql: 'SELECT * FROM mercadoria_subgrupo t ORDER BY t.idsubgrupo' },
  { nome: 'ncm', limite: 3, sql: 'SELECT * FROM ncm t' },
]

export async function descobrirColunas(erp: ErpClient) {
  const resultados: Record<string, unknown> = {}
  for (const s of SONDAS) {
    try {
      assertReadOnly(s.sql)
      const { rows, shape } = await erp.page(s.sql, 0, s.limite)
      resultados[s.nome] = { colunas: shape.columns, linhas: rows.slice(0, s.limite).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v]))) }
    } catch (e) {
      resultados[s.nome] = { erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
    }
  }
  return resultados
}
