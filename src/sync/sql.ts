// Montagem das consultas enviadas ao ERP. Só SELECT; identificadores vêm de datasets.ts (validados)
// e valores (cursor, data da janela) passam por `literal`, que valida o tipo antes de escrever.

import { columnType, type ColType, type Dataset } from './datasets'
import { isIsoDate, type Value } from './convert'

export function literal(type: ColType, value: Value): string {
  if (value === null) throw new Error('Valor nulo não pode ir para o SQL.')
  switch (type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Inteiro inválido: ${value}`)
      return String(value)
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Número inválido: ${value}`)
      return String(value)
    case 'date':
      if (!isIsoDate(value)) throw new Error(`Data inválida: ${value}`)
      return `'${value}'`
    case 'ts':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) throw new Error(`Data/hora inválida: ${value}`)
      return `'${value}'`
    case 'text': {
      const s = String(value)
      if (/[\u0000-\u001f\\]/.test(s)) throw new Error('Texto com caractere de controle ou barra invertida não vai para o SQL.')
      return `'${s.replace(/'/g, "''")}'`
    }
  }
}

/**
 * SELECT das colunas, filtrado pelo cursor (keyset: chave > última lida) e, no modo 'recent', pela janela.
 * A ordem pela chave completa garante que nenhuma linha é pulada nem repetida entre páginas,
 * mesmo que a API devolva menos linhas que o limit pedido.
 */
export function buildSelect(d: Dataset, cursor: Value[] | null, windowFrom: string | null): string {
  const where: string[] = []
  if (d.kind === 'recent') {
    if (!windowFrom || !isIsoDate(windowFrom)) throw new Error(`${d.name}: janela sem data inicial.`)
    where.push(d.recentFilter!(literal('date', windowFrom)))
  }
  if (cursor) {
    if (cursor.length !== d.keys.length) throw new Error(`${d.name}: cursor com ${cursor.length} valores para ${d.keys.length} chaves.`)
    const lits = d.keys.map((k, i) => literal(columnType(k), cursor[i]))
    where.push(d.keys.length === 1
      ? `t.${d.keys[0]} > ${lits[0]}`
      : `(${d.keys.map(k => `t.${k}`).join(', ')}) > (${lits.join(', ')})`)
  }
  const sql = `SELECT ${d.columns.map(c => `t.${c}`).join(', ')} FROM ${d.table} t`
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + ` ORDER BY ${d.keys.map(k => `t.${k}`).join(', ')}`
  assertReadOnly(sql)
  return sql
}

/** Contagem simples de uma tabela da lista fixa. */
export function buildCount(d: Dataset): string {
  const sql = `SELECT COUNT(*) AS total FROM ${d.table}`
  assertReadOnly(sql)
  return sql
}

/** Defesa extra: um único SELECT/WITH, sem comandos de escrita (texto entre aspas é ignorado na checagem). */
export function assertReadOnly(sql: string) {
  const s = sql.replace(/'(?:[^']|'')*'/g, "''")
  if (!/^\s*(WITH|SELECT)\b/i.test(s)) throw new Error('Consulta precisa começar com SELECT ou WITH.')
  if (s.includes(';') || s.includes('--') || s.includes('/*')) throw new Error('Consulta com ";" ou comentário não é permitida.')
  if (/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|INTO)\b/i.test(s)) throw new Error('Consulta contém comando não permitido.')
}
