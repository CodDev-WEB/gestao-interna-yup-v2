// Conversão dos valores devolvidos pela API do ERP para os tipos do espelho no Supabase.
// Qualquer valor que não converta é erro (com coluna e valor), nunca é gravado "aproximado".

import { columnType, type ColType, type Dataset } from './datasets'

export type Value = string | number | null
export type TypedRow = Record<string, Value>

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = value.match(ISO_DATE)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200
}

/** Número: aceita 1234.5, "1234.5" e "1.234,56". */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw new Error('não é finito') }
  if (typeof value === 'string') {
    let s = value.trim()
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
    const n = Number(s)
    if (s !== '' && Number.isFinite(n)) return n
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  throw new Error('não é número')
}

/** Data: "2026-11-10", "2026-11-10T00:00:00…", "2026-11-10 00:00:00" ou "10/11/2026". */
export function toDate(value: unknown): string {
  const s = String(value).trim()
  const iso = s.slice(0, 10)
  if (isIsoDate(iso) && (s.length === 10 || /^[T ]/.test(s.slice(10)))) return iso
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br && isIsoDate(`${br[3]}-${br[2]}-${br[1]}`)) return `${br[3]}-${br[2]}-${br[1]}`
  throw new Error('não é data')
}

/**
 * Data e hora. Valores com fuso (Z, -03:00) viram o instante exato.
 * Valores sem fuso são hora local da loja (offset do ERP, padrão -03:00 em Belém, sem horário de verão).
 */
export function toTimestamp(value: unknown, utcOffset: string): string {
  const s = String(value).trim()
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'))
    if (Number.isFinite(t)) return new Date(t).toISOString()
  }
  let m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/)
  if (!m) {
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    if (br) m = [s, `${br[3]}-${br[2]}-${br[1]}`, br[4], br[5], br[6], undefined] as unknown as RegExpMatchArray
  }
  if (!m || !isIsoDate(m[1])) throw new Error('não é data/hora')
  const [hh, mi, ss] = [m[2] ?? '00', m[3] ?? '00', m[4] ?? '00']
  if (Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) throw new Error('hora inválida')
  const t = Date.parse(`${m[1]}T${hh}:${mi}:${ss}${m[5] ?? ''}${utcOffset}`)
  if (!Number.isFinite(t)) throw new Error('não é data/hora')
  return new Date(t).toISOString()
}

/** "Data zero" usada pelo ERP para data vazia (ex.: 1899-12-30/31, 0001-01-01). */
const ZERO_DATE = /^(0{4}|0001|1[0-8]\d\d)-\d{2}-\d{2}|^\d{2}\/\d{2}\/(0{4}|0001|1[0-8]\d\d)/

export function convertValue(type: ColType, value: unknown, utcOffset: string): Value {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '' && type !== 'text') return null
  if ((type === 'date' || type === 'ts') && typeof value === 'string' && ZERO_DATE.test(value.trim())) return null
  switch (type) {
    case 'int': {
      const n = toNumber(value)
      if (!Number.isSafeInteger(n)) throw new Error('não é inteiro')
      return n
    }
    case 'num': return toNumber(value)
    case 'date': return toDate(value)
    case 'ts': return toTimestamp(value, utcOffset)
    case 'text': return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

/** Valor da coluna no registro do ERP, tolerando maiúsculas. `undefined` = coluna ausente. */
function pick(row: Record<string, unknown>, col: string): unknown {
  if (col in row) return row[col]
  const upper = col.toUpperCase()
  if (upper in row) return row[upper]
  const found = Object.keys(row).find(k => k.toLowerCase() === col)
  return found === undefined ? undefined : row[found]
}

/** Converte um registro do ERP. Coluna ausente ou valor inválido = erro com o motivo. */
export function convertRow(d: Dataset, row: Record<string, unknown>, utcOffset: string): TypedRow {
  const out: TypedRow = {}
  for (const col of d.columns) {
    const raw = pick(row, col)
    if (raw === undefined) throw new Error(`${d.table}: coluna "${col}" não veio na resposta do ERP`)
    try { out[col] = convertValue(columnType(col), raw, utcOffset) }
    catch (e) { throw new Error(`${d.table}.${col} = ${JSON.stringify(raw)}: ${e instanceof Error ? e.message : String(e)}`) }
    if (d.keys.includes(col) && out[col] === null) throw new Error(`${d.table}: chave "${col}" nula`)
  }
  return out
}

export const keyOf = (d: Dataset, row: TypedRow): Value[] => d.keys.map(k => row[k])
