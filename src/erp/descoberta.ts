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
  const colunas = await erp.page("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND (table_name ILIKE 'usuario%' OR table_name ILIKE 'operador%' OR table_name ILIKE 'pessoa_usuario%' OR table_name ILIKE 'funcionario' OR table_name ILIKE 'pessoa_funcionario%') AND table_name NOT ILIKE '%selecao%' ORDER BY table_name, column_name", 0, 100)
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

/** Colunas dos históricos (preço e estoque) e a tabela de usuários, para saber se o ERP guarda quem alterou. */
export async function descobrirAutoria(erp: ErpClient) {
  const r: Record<string, unknown> = {}
  const tentar = async (nome: string, sql: string, limite = 100) => {
    try { assertReadOnly(sql); r[nome] = (await erp.page(sql, 0, limite)).rows.slice(0, limite) }
    catch (e) { r[nome] = { erro: String(e instanceof Error ? e.message : e).slice(0, 200) } }
  }
  await tentar('colunas_historicos', "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('mercadoria_tabela_preco_historico', 'mercadoria_estoque_historico', 'mercadoria_tabela_preco', 'mercadoria_custo', 'mercadoria_historico', 'log', 'auditoria') ORDER BY table_name, column_name")
  await tentar('tabelas_log', "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND (table_name ILIKE '%log%' OR table_name ILIKE '%auditoria%' OR table_name ILIKE '%historico%') ORDER BY table_name")
  await tentar('usuario', 'SELECT t._idusuario, t.nome FROM usuario t', 60)
  await tentar('usuario_login', 'SELECT t._idusuario, t.login FROM usuario t', 60)
  return r
}

/** Tabelas de auditoria/histórico de documentos do ERP: colunas e um exemplo (sem dados sensíveis). */
export async function descobrirAuditoriaDocs(erp: ErpClient) {
  const r: Record<string, unknown> = {}
  const tentar = async (nome: string, sql: string, limite = 100) => {
    try { assertReadOnly(sql); r[nome] = (await erp.page(sql, 0, limite)).rows.slice(0, limite) }
    catch (e) { r[nome] = { erro: String(e instanceof Error ? e.message : e).slice(0, 200) } }
  }
  await tentar('colunas', "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('documento_historico', 'documento_auditoria', 'documento_mercadoria_historico', 'mercadoria_estoque_lote_historico') ORDER BY table_name, column_name")
  for (const t of ['documento_historico', 'documento_auditoria', 'documento_mercadoria_historico']) await tentar(t, `SELECT * FROM ${t} t ORDER BY 1 DESC`, 3)
  return r
}

/** Nome de coluna que pode ter dado pessoal ou de cartão: nunca é lido na descoberta. */
const SENSIVEL = /(senha|token|secret|cpf|cnpj|^rg$|cartao.*num|num.*cartao|bin|nsu|autoriz|seguranca|cvv|chave|email|telefone|celular|fone|endereco|logradouro)/i

/**
 * Onde o ERP guarda o caixa (abertura, fechamento, sangria, suprimento) e as formas de pagamento das vendas, para
 * montar a conferência de caixa diária. Só leitura: colunas das tabelas candidatas e até 3 linhas de exemplo de cada
 * uma, sem as colunas sensíveis. O resultado vai para sync_runs (dataset 'erp_caixa').
 */
export async function descobrirCaixa(erp: ErpClient) {
  const r: Record<string, unknown> = {}
  const padroes = ['%caixa%', '%pagamento%', '%recebimento%', '%forma%pag%', '%financeiro%', '%titulo%', '%sangria%', '%suprimento%', '%fechamento%', '%parcela%', '%cartao%', '%tef%', '%pix%', '%turno%']
  const sql = `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND (${padroes.map(p => `table_name ILIKE '${p}'`).join(' OR ')}) AND table_name NOT ILIKE '%selecao%' ORDER BY table_name, ordinal_position`
  let colunas: { table_name: string; column_name: string; data_type: string }[] = []
  try { assertReadOnly(sql); colunas = (await erp.page(sql, 0, 1500)).rows as typeof colunas }
  catch (e) { r.erro_colunas = String(e instanceof Error ? e.message : e).slice(0, 300) }
  const porTabela = new Map<string, string[]>()
  for (const c of colunas) {
    if (!c.table_name || !c.column_name) continue
    porTabela.set(c.table_name, [...(porTabela.get(c.table_name) ?? []), `${c.column_name}:${c.data_type}`])
  }
  r.tabelas = Object.fromEntries(porTabela)
  // Exemplos: primeiro as de caixa, depois pagamento/forma, depois o resto (até 14 tabelas).
  const peso = (t: string) => /caixa/i.test(t) ? 0 : /pagamento|forma/i.test(t) ? 1 : /sangria|suprimento|fechamento|turno/i.test(t) ? 2 : 3
  const escolhidas = [...porTabela.keys()].filter(t => /^[a-z0-9_]+$/.test(t)).sort((a, b) => peso(a) - peso(b) || a.localeCompare(b)).slice(0, 14)
  const exemplos: Record<string, unknown> = {}
  for (const t of escolhidas) {
    const cols = (porTabela.get(t) ?? []).map(c => c.split(':')[0]).filter(c => /^[a-z0-9_]+$/.test(c) && !SENSIVEL.test(c))
    if (!cols.length) continue
    const q = `SELECT ${cols.map(c => `t.${c}`).join(', ')} FROM ${t} t ORDER BY 1 DESC`
    try {
      assertReadOnly(q)
      exemplos[t] = (await erp.page(q, 0, 3)).rows.slice(0, 3).map(l => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v])))
    } catch (e) { exemplos[t] = { erro: String(e instanceof Error ? e.message : e).slice(0, 200) } }
  }
  r.exemplos = exemplos
  return r
}
