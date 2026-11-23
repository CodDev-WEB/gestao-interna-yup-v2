// Auditoria de valores: os mesmos totais calculados no ERP e no sistema (espelho no Supabase), comparados
// ao centavo. Só leitura no ERP (~10 consultas, respeitando o limite de 20 por minuto).
// Roda uma vez por dia pelo cron e sob demanda (POST /api/auditoria/run). O resultado fica em sync_runs
// (dataset 'auditoria') e a tela Auditoria mostra a última.
//
// Período: tudo até ontem às 23:59 (hora de Belém). O dia de hoje fica de fora porque ainda está sendo
// sincronizado e daria diferença que não é erro.

import type { ErpClient, RawRow } from './erp/client'
import type { Supabase } from './supabase/client'
import { assertReadOnly } from './sync/sql'
import { EMPRESA_YUP } from './sync/datasets'

type Valor = string | number | null | undefined

/** Valor decimal em unidades inteiras (centavos com casas=2, milésimos com casas=3), sem erro de ponto flutuante. */
export function unidades(v: Valor, casas: number): bigint {
  if (v === null || v === undefined || v === '') return 0n
  const s = typeof v === 'number' ? v.toFixed(casas + 2) : String(v).trim()
  const m = /^([+-]?)(\d*)(?:[.,](\d*))?(?:e([+-]?\d+))?$/i.exec(s)
  if (!m) throw new Error(`Valor numérico inválido: ${s}`)
  if (m[4]) return unidades(Number(s).toFixed(casas + 2), casas)
  const neg = m[1] === '-'
  const frac = (m[3] ?? '').padEnd(casas + 1, '0')
  let n = BigInt((m[2] || '0') + frac.slice(0, casas))
  if (Number(frac[casas]) >= 5) n += 1n // meio para cima (afastando do zero), como o round do banco
  return neg ? -n : n
}

/** Unidades de volta para texto com as casas fixas (ex.: 123456n, 2 → "1234.56"). */
export function texto(n: bigint, casas: number) {
  const neg = n < 0n, a = (neg ? -n : n).toString().padStart(casas + 1, '0')
  return (neg ? '-' : '') + (casas ? a.slice(0, -casas) + '.' + a.slice(-casas) : a)
}

const CAMPOS = { docs: 0, itens: 0, qtd: 3, valor: 2, bruto: 2, desconto: 2 } as const
type Campo = keyof typeof CAMPOS
type Totais = Record<Campo, string>

export type Grupo = 'vendas' | 'devolucoes' | 'compras' | 'outros'
/** Mesmos critérios do sistema inteiro (vw_venda_item, resumo_mes, compras). */
export function grupoDe(modelo: string, tm: string, tf: string, status: string): Grupo {
  if (status !== 'E') return 'outros'
  if (tm === 'S' && tf === 'R') return 'vendas'
  if (modelo === 'TM' && tm === 'E' && tf === 'P') return 'devolucoes'
  if (tm === 'E' && tf === 'P') return 'compras'
  return 'outros'
}

export type LinhaAuditoria = {
  mes: string; chave: Record<string, string>; grupo: Grupo
  erp: Totais | null; sistema: Totais | null
  diferenca: Partial<Record<Campo, string>>; ok: boolean
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const lower = (r: RawRow) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/^_/, ''), v])) as Record<string, Valor>

function totais(r: Record<string, Valor>, campos: Campo[]): Totais {
  return Object.fromEntries(campos.map(c => [c, texto(unidades(r[c], CAMPOS[c]), CAMPOS[c])])) as Totais
}

/** Compara duas listas pela chave; cada campo em unidades inteiras. */
export function comparar(erpRows: Record<string, Valor>[], sisRows: Record<string, Valor>[], chaves: string[], campos: Campo[], grupo: (k: Record<string, string>) => Grupo): LinhaAuditoria[] {
  const id = (r: Record<string, Valor>) => chaves.map(k => str(r[k])).join('|')
  const mapa = new Map<string, { chave: Record<string, string>; erp?: Totais; sistema?: Totais }>()
  const por = (lista: Record<string, Valor>[], lado: 'erp' | 'sistema') => {
    for (const r of lista) {
      const k = id(r)
      const item = mapa.get(k) ?? { chave: Object.fromEntries(chaves.map(c => [c, str(r[c])])) }
      // Mesma chave duas vezes (ex.: modelo nulo e vazio) soma.
      const t = totais(r, campos), atual = item[lado]
      item[lado] = atual ? Object.fromEntries(campos.map(c => [c, texto(unidades(atual[c], CAMPOS[c]) + unidades(t[c], CAMPOS[c]), CAMPOS[c])])) as Totais : t
      mapa.set(k, item)
    }
  }
  por(erpRows, 'erp'); por(sisRows, 'sistema')
  return [...mapa.values()].map(({ chave, erp, sistema }) => {
    const diferenca: Partial<Record<Campo, string>> = {}
    for (const c of campos) {
      const d = unidades(sistema?.[c], CAMPOS[c]) - unidades(erp?.[c], CAMPOS[c])
      if (d !== 0n) diferenca[c] = texto(d, CAMPOS[c])
    }
    return { mes: chave.mes ?? '', chave, grupo: grupo(chave), erp: erp ?? null, sistema: sistema ?? null, diferenca, ok: Object.keys(diferenca).length === 0 }
  }).sort((a, b) => (a.mes < b.mes ? 1 : a.mes > b.mes ? -1 : 0) || JSON.stringify(a.chave).localeCompare(JSON.stringify(b.chave)))
}

function hojeBelem(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

async function consultar(erp: ErpClient, sql: string) {
  assertReadOnly(sql)
  const r = await erp.all(sql, 40)
  if (!r.complete) throw new Error('Leitura do ERP incompleta: ' + (r.note ?? 'sem detalhe'))
  return r.rows.map(lower)
}

export async function auditar(erp: ErpClient, db: Supabase, agora = new Date()) {
  const hoje = hojeBelem(agora)
  const corteErp = `'${hoje} 00:00:00'` // datahora no ERP é a hora local da loja
  const corteSistema = `${hoje}T00:00:00-03:00` // Belém: UTC-3, sem horário de verão

  const sqlClasses = `SELECT to_char(d.datahora, 'YYYY-MM') AS mes, COALESCE(d.modelo, '') AS modelo, COALESCE(d.tipomovimento, '') AS tm, COALESCE(d.tipomovimentofinanceiro, '') AS tf, COALESCE(d.status, '') AS status, COUNT(DISTINCT d._iddocumento) AS docs, COUNT(*) AS itens, COALESCE(SUM(dm.qtd), 0) AS qtd, COALESCE(SUM(dm.valtotalliquido), 0) AS valor, COALESCE(SUM(dm.valtotalbruto), 0) AS bruto, COALESCE(SUM(dm.valdesconto), 0) AS desconto FROM documento d JOIN documento_mercadoria dm ON dm._iddocumento = d._iddocumento WHERE d.idempresa = ${EMPRESA_YUP} AND d.datahora < ${corteErp} GROUP BY to_char(d.datahora, 'YYYY-MM'), COALESCE(d.modelo, ''), COALESCE(d.tipomovimento, ''), COALESCE(d.tipomovimentofinanceiro, ''), COALESCE(d.status, '') ORDER BY 1, 2, 3, 4, 5`
  const sqlVendedoras = `SELECT to_char(d.datahora, 'YYYY-MM') AS mes, COALESCE(dm.idpessoafuncionario, 0) AS vendedora, COUNT(DISTINCT d._iddocumento) AS docs, COUNT(*) AS itens, COALESCE(SUM(dm.qtd), 0) AS qtd, COALESCE(SUM(dm.valtotalliquido), 0) AS valor FROM documento d JOIN documento_mercadoria dm ON dm._iddocumento = d._iddocumento WHERE d.idempresa = ${EMPRESA_YUP} AND d.datahora < ${corteErp} AND d.tipomovimento = 'S' AND d.tipomovimentofinanceiro = 'R' AND d.status = 'E' GROUP BY to_char(d.datahora, 'YYYY-MM'), COALESCE(dm.idpessoafuncionario, 0) ORDER BY 1, 2`
  const sqlEstoque = `SELECT COUNT(*) AS linhas, COALESCE(SUM(e.qtdsaldo), 0) AS qtd FROM mercadoria_estoque e WHERE e._idempresa = ${EMPRESA_YUP}`

  const inicio = Date.now()
  const sistema = await db.rpc<{ classes: Record<string, Valor>[]; vendedoras: Record<string, Valor>[]; estoque: Record<string, Valor>; orfaos: number[] }>('auditoria_espelho', { p_ate: corteSistema })
  const [erpClasses, erpVendedoras, erpEstoque] = [await consultar(erp, sqlClasses), await consultar(erp, sqlVendedoras), await consultar(erp, sqlEstoque)]

  const classes = comparar(erpClasses, sistema.classes, ['mes', 'modelo', 'tm', 'tf', 'status'], ['docs', 'itens', 'qtd', 'valor', 'bruto', 'desconto'], k => grupoDe(k.modelo, k.tm, k.tf, k.status))
  const vendedoras = comparar(erpVendedoras, sistema.vendedoras, ['mes', 'vendedora'], ['docs', 'itens', 'qtd', 'valor'], () => 'vendas')

  // Totais por grupo (vendas, devoluções, compras, outros), somados em centavos.
  const grupos = (['vendas', 'devolucoes', 'compras', 'outros'] as Grupo[]).map(g => {
    const ls = classes.filter(l => l.grupo === g)
    const soma = (lado: 'erp' | 'sistema', c: Campo) => texto(ls.reduce((a, l) => a + unidades(l[lado]?.[c], CAMPOS[c]), 0n), CAMPOS[c])
    const campos: Campo[] = ['docs', 'itens', 'qtd', 'valor', 'bruto', 'desconto']
    const erpT = Object.fromEntries(campos.map(c => [c, soma('erp', c)])) as Totais
    const sisT = Object.fromEntries(campos.map(c => [c, soma('sistema', c)])) as Totais
    const diferenca = Object.fromEntries(campos.map(c => [c, texto(unidades(sisT[c], CAMPOS[c]) - unidades(erpT[c], CAMPOS[c]), CAMPOS[c])]).filter(([, v]) => unidades(v, 3) !== 0n))
    return { grupo: g, erp: erpT, sistema: sisT, diferenca, ok: Object.keys(diferenca).length === 0, meses_divergentes: [...new Set(ls.filter(l => !l.ok).map(l => l.mes))] }
  })

  const e0 = erpEstoque[0] ?? {}
  const estoque = {
    erp: { linhas: texto(unidades(e0.linhas, 0), 0), qtd: texto(unidades(e0.qtd, 3), 3) },
    sistema: { linhas: texto(unidades(sistema.estoque.linhas, 0), 0), qtd: texto(unidades(sistema.estoque.qtd, 3), 3) },
  }
  const estoqueDif = { linhas: texto(unidades(estoque.sistema.linhas, 0) - unidades(estoque.erp.linhas, 0), 0), qtd: texto(unidades(estoque.sistema.qtd, 3) - unidades(estoque.erp.qtd, 3), 3) }

  // Itens no sistema sem o documento: o ERP ainda tem esse documento?
  let orfaos: { iddocumento: number; no_erp: Record<string, Valor> | null }[] = []
  const ids = (sistema.orfaos ?? []).filter(n => Number.isInteger(Number(n))).slice(0, 50).map(Number)
  if (ids.length) {
    const rows = await consultar(erp, `SELECT d._iddocumento AS iddocumento, d.modelo AS modelo, d.tipomovimento AS tm, d.tipomovimentofinanceiro AS tf, d.status AS status, d.datahora AS datahora FROM documento d WHERE d._iddocumento IN (${ids.join(', ')}) ORDER BY 1`)
    const por = new Map(rows.map(r => [Number(r.iddocumento), r]))
    orfaos = ids.map(id => ({ iddocumento: id, no_erp: por.get(id) ?? null }))
  }

  const divergencias = classes.filter(l => !l.ok).length + vendedoras.filter(l => !l.ok).length
  return {
    gerado_em: new Date().toISOString(),
    periodo_ate: hoje, // exclusivo: até ontem 23:59
    segundos: Math.round((Date.now() - inicio) / 1000),
    requisicoes_erp: erp.requests,
    ok: divergencias === 0 && unidades(estoqueDif.qtd, 3) === 0n && unidades(estoqueDif.linhas, 0) === 0n && orfaos.length === 0,
    divergencias,
    grupos,
    classes,
    vendedoras,
    estoque: { ...estoque, diferenca: estoqueDif, ok: unidades(estoqueDif.qtd, 3) === 0n && unidades(estoqueDif.linhas, 0) === 0n },
    orfaos,
  }
}

export type ResultadoAuditoria = Awaited<ReturnType<typeof auditar>>

/** Roda e grava em sync_runs; erros também ficam gravados, para a tela mostrar. */
export async function auditarEGravar(erp: ErpClient, db: Supabase) {
  const inicio = new Date().toISOString()
  try {
    const r = await auditar(erp, db)
    await db.insertMinimal('sync_runs', { dataset: 'auditoria', mode: 'auditoria', status: r.ok ? 'ok' : 'divergente', started_at: inicio, finished_at: new Date().toISOString(), rows_read: r.classes.length + r.vendedoras.length, rows_written: 0, erp_requests: erp.requests, error: null, details: r })
    return r
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.insertMinimal('sync_runs', { dataset: 'auditoria', mode: 'auditoria', status: 'error', started_at: inicio, finished_at: new Date().toISOString(), rows_read: 0, rows_written: 0, erp_requests: erp.requests, error: msg.slice(0, 1000), details: null }).catch(() => undefined)
    throw e
  }
}
