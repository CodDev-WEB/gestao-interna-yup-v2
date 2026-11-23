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

/**
 * Onde o ERP guarda os usuários (quem lança os documentos: documento.idusuario). Só leitura e só colunas de
 * identificação (código, nome, login, pessoa ligada) — nunca senha ou token.
 */
export async function descobrirUsuarios(erp: ErpClient) {
  const resultados: Record<string, unknown> = {}
  const colunas = await erp.page("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND (table_name ILIKE '%usuario%' OR table_name ILIKE '%operador%' OR table_name ILIKE '%funcionario%') ORDER BY table_name, column_name", 0, 100)
    .then(r => r.rows).catch(e => { resultados.erro_colunas = String(e instanceof Error ? e.message : e).slice(0, 300); return [] })
  resultados.colunas = colunas
  const porTabela = new Map<string, string[]>()
  for (const c of colunas as { table_name?: string; column_name?: string }[]) {
    if (!c.table_name || !c.column_name) continue
    porTabela.set(c.table_name, [...(porTabela.get(c.table_name) ?? []), c.column_name])
  }
  const seguras = /^_?id|nome|login|apelido|usuario|flaginativo|email$/i
  const proibidas = /senha|password|hash|token|secret|chave/i
  for (const [tabela, cols] of porTabela) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tabela)) continue
    const escolhidas = cols.filter(c => /^[a-z_][a-z0-9_]*$/.test(c) && seguras.test(c) && !proibidas.test(c)).slice(0, 8)
    if (!escolhidas.length) continue
    const sql = `SELECT ${escolhidas.map(c => `t.${c}`).join(', ')} FROM ${tabela} t`
    try { assertReadOnly(sql); resultados[tabela] = (await erp.page(sql, 0, 60)).rows.slice(0, 60) }
    catch (e) { resultados[tabela] = { erro: String(e instanceof Error ? e.message : e).slice(0, 200) } }
  }
  return resultados
}
