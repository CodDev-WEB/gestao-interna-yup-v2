// Teste ponta a ponta, sem rede:
//  - "ERP": Postgres local (PGlite) com as tabelas do ERP; a API simulada executa o SQL que o Worker envia,
//    aplica offset/limit, corta páginas (devolve menos que o limit) e serializa como JSON.
//  - "Supabase": outro PGlite com as migrações reais de supabase/migrations.
//  - Roda o motor de sincronização até estabilizar, altera o ERP, sincroniza de novo e confere as views.
// Uso: npm test

import { PGlite } from '@electric-sql/pglite'
import { diagnosticar, lerErro } from '../src/sync/diagnostico'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { columnType, DATASETS, mirrorTables, type ColType } from '../src/sync/datasets'
import { convertValue, toTimestamp } from '../src/sync/convert'
import { assertReadOnly, buildSelect, literal } from '../src/sync/sql'
import { isDue, runSync, emptyState, type ErpLike } from '../src/sync/engine'
import type { JobState, RunRecord, Settings, Store } from '../src/sync/store'
import type { Aviso, TypedRow } from '../src/sync/convert'
import { mirrorSql } from '../scripts/mirror-sql'

let passed = 0
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log('  ok  ', name) }
  catch (e) { console.error('  FALHOU', name); throw e }
}

const root = new URL('../', import.meta.url)
const iso = (d: Date) => d.toISOString()

// ---------- Unidades ----------
console.log('Unidades')
await test('toTimestamp: hora local sem fuso vira instante com -03:00', () => {
  assert.equal(toTimestamp('2026-11-10 14:22:33', '-03:00'), '2026-11-10T17:22:33.000Z')
  assert.equal(toTimestamp('2026-11-10T14:22:33.5', '-03:00'), '2026-11-10T17:22:33.500Z')
  assert.equal(toTimestamp('10/11/2026 14:22', '-03:00'), '2026-11-10T17:22:00.000Z')
  assert.equal(toTimestamp('2026-11-10', '-03:00'), '2026-11-10T03:00:00.000Z')
  assert.equal(toTimestamp('2026-11-10T17:22:33Z', '-03:00'), '2026-11-10T17:22:33.000Z')
  assert.throws(() => toTimestamp('2026-02-30 10:00', '-03:00'))
  assert.throws(() => toTimestamp('ontem', '-03:00'))
})
await test('convertValue: números BR, inteiros, datas, vazio', () => {
  assert.equal(convertValue('num', '1.234,56', '-03:00'), 1234.56)
  assert.equal(convertValue('int', '42', '-03:00'), 42)
  assert.equal(convertValue('int', 42.0, '-03:00'), 42)
  assert.throws(() => convertValue('int', 4.5, '-03:00'))
  assert.equal(convertValue('date', '2026-11-10T00:00:00', '-03:00'), '2026-11-10')
  assert.equal(convertValue('num', '', '-03:00'), null)
  assert.equal(convertValue('text', '', '-03:00'), '')
  // "Data zero" do ERP = data vazia (visto no ERP real: pessoa.datacadastro = "1899-12-31T00:00:00").
  assert.equal(convertValue('ts', '1899-12-31T00:00:00', '-03:00'), null)
  assert.equal(convertValue('date', '1899-12-30', '-03:00'), null)
  assert.equal(convertValue('date', '0001-01-01', '-03:00'), null)
  assert.equal(convertValue('date', '1900-01-01', '-03:00'), '1900-01-01')
})
await test('literal: escapa texto e recusa valores perigosos', () => {
  assert.equal(literal('text', "L'1"), "'L''1'")
  assert.throws(() => literal('text', 'a\\b'))
  assert.throws(() => literal('int', 1.5))
  assert.throws(() => literal('date', "2026-01-01' OR 1=1"))
})
await test('assertReadOnly: só SELECT, sem ; ou comentário', () => {
  assertReadOnly("SELECT t.a FROM x t WHERE t.b > 'DELETE; --'")
  assert.throws(() => assertReadOnly('SELECT 1; DROP TABLE x'))
  assert.throws(() => assertReadOnly('DELETE FROM x'))
  assert.throws(() => assertReadOnly('SELECT 1 -- x'))
})
await test('buildSelect: keyset composto e janela', () => {
  const d = DATASETS.find(x => x.name === 'documento_mercadoria_recente')!
  const sql = buildSelect(d, [10, 2], '2026-11-01')
  assert.match(sql, /WHERE t\._iddocumento IN \(SELECT d\._iddocumento FROM documento d WHERE d\.datahora >= '2026-11-01'\) AND \(t\._iddocumento, t\._idsequencia\) > \(10, 2\) ORDER BY t\._iddocumento, t\._idsequencia$/)
})
await test('isDue: intervalo, ciclo em andamento e espera após erro', () => {
  const d = DATASETS.find(x => x.name === 'mercadoria_estoque')!
  const now = new Date('2026-11-17T12:00:00Z')
  const s = emptyState(d)
  assert.equal(isDue(d, s, now), true)
  assert.equal(isDue(d, { ...s, last_completed_at: '2026-11-17T11:50:00Z' }, now), false)
  assert.equal(isDue(d, { ...s, last_completed_at: '2026-11-17T11:50:00Z', cycle_started_at: '2026-11-17T11:55:00Z' }, now), true)
  assert.equal(isDue(d, { ...s, status: 'error', last_synced_at: '2026-11-17T11:55:00Z', cycle_started_at: 'x' }, now), false)
  assert.equal(isDue(d, { ...s, enabled: false }, now), false)
})
await test('migração do espelho está atualizada com datasets.ts', () => {
  const file = readFileSync(new URL('supabase/migrations/20261117010000_erp_mirror.sql', root), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(file, mirrorSql(), 'Rode `npm run gen:sql`.')
})

// ---------- Bancos ----------
console.log('Integração')
const sb = new PGlite()
const migrations = readdirSync(new URL('supabase/migrations/', root)).filter(f => f.endsWith('.sql')).sort()
await test(`migrações aplicam do zero (${migrations.length}) e de novo (idempotentes)`, async () => {
  for (let pass = 0; pass < 2; pass++)
    for (const f of migrations) await sb.exec(readFileSync(new URL(`supabase/migrations/${f}`, root), 'utf8'))
})

const ERP_PG: Record<ColType, string> = { int: 'bigint', num: 'numeric', text: 'text', date: 'date', ts: 'timestamp' }
const erp = new PGlite()
for (const d of mirrorTables())
  await erp.exec(`create table ${d.table} (${d.columns.map(c => `${c} ${ERP_PG[columnType(c)]}`).join(', ')}, primary key (${d.keys.join(', ')}))`)

// Datas relativas ao dia de hoje em Belém.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const day = (n: number) => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const at = (n: number, h = '10:00:00') => `${day(n)} ${h}`

async function ins(table: string, rows: Record<string, unknown>[]) {
  for (const r of rows) {
    const cols = Object.keys(r)
    await erp.query(`insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map(c => r[c]))
  }
}

// Cenário
await ins('mercadoria_secao', [{ _idsecao: 1, descricao: 'RAÇÕES', flaginativo: 'N' }, { _idsecao: 2, descricao: 'FARMÁCIA', flaginativo: 'N' }])
await ins('mercadoria_grupo', [{ _idgrupo: 1, descricao: 'CÃES', flaginativo: 'N' }])
await ins('mercadoria_subgrupo', [{ _idsubgrupo: 1, descricao: 'SECA', flaginativo: 'N' }])
await ins('mercadoria_marca', [{ _idmarca: 1, descricao: 'MARCA', flaginativo: 'N' }])
await ins('natureza_operacao', [{ _idempresa: 1, _idnatureza: 1, descricao: 'VENDA', tipomovimento: 'S', flagmovimentarestoque: 'S' }])
await ins('local_estoque', [{ _idempresa: 1, _idlocal: 1, descricao: 'LOJA', flaginativo: 'N' }])
const produtos: [number, number, number, string][] = [[10, 100, 1, 'RAÇÃO 10KG'], [11, 110, 2, 'VERMÍFUGO'], [12, 120, 1, 'PETISCO PARADO'], [13, 130, 1, 'AREIA'], [99, 999, 1, 'ITEM VOLUME']]
await ins('mercadoria', produtos.map(([m, , s, desc]) => ({ _idmercadoria: m, descricao: desc, idsecao: s, idgrupo: 1, idsubgrupo: 1, dtalteracao: at(-200) })))
await ins('mercadoria_variacao', produtos.map(([m, v, , desc]) => ({ _idmercadoriavariacao: v, idmercadoria: m, descricao: desc, codigobarras: `789${v}`, embalagem: 'UN' })))
await ins('pessoa', [
  { _idpessoa: 500, nome: "DISTRIBUIDORA D'OESTE", tipo: 'J', datacadastro: at(-400) },
  { _idpessoa: 600, nome: 'CLIENTE X', tipo: 'F', datacadastro: at(-300) },
  { _idpessoa: 700, nome: 'VENDEDORA', tipo: 'F', datacadastro: at(-300) },
])
await ins('mercadoria_fornecedor', [{ _idmercadoriavariacao: 100, _idpessoa: 500, _embalagem: 'UN', qtdfator: 1 }])
await ins('mercadoria_estoque', [[100, 26], [110, 4], [120, 10], [130, 5], [999, 100]].map(([v, q]) => ({ _idempresa: 1, _idlocalestoque: 1, _idmercadoriavariacao: v, qtdsaldo: q, datahora: at(0) })))
await ins('mercadoria_custo', [[100, 10.5], [110, 8], [120, 5], [130, 8], [999, 1]].map(([v, c]) => ({ _idempresa: 1, _idmercadoriavariacao: v, valcusto: c, valcustomedio: c, datahora: at(0) })))
await ins('mercadoria_estoque_lote', [
  { _idempresa: 1, _idlocalestoque: 1, _idmercadoriavariacao: 110, _lote: "L'1", _dtvalidade: day(5), _dtentrada: day(-60), qtdsaldo: 4, datahora: at(0) },
  { _idempresa: 1, _idlocalestoque: 1, _idmercadoriavariacao: 100, _lote: 'L2', _dtvalidade: day(200), _dtentrada: day(-30), qtdsaldo: 26, datahora: at(0) },
])
await ins('mercadoria_tabela_preco', [{ _idempresa: 1, _idmercadoriavariacao: 100, _idtabela: 1, valpreco: 15, valcusto: 10.5, flaginativo: 'N' }])

type Doc = { id: number; empresa?: number; pessoa: number; dia: number; tm: string; tf: string; status: string; modelo: string; itens: [number, number, number, number, number?][] } // [seq, variacao, qtd, total, custo]
const doc = async (x: Doc) => {
  await ins('documento', [{ _iddocumento: x.id, idempresa: x.empresa ?? 1, idpessoa: x.pessoa, datahora: at(x.dia), numero: String(x.id), modelo: x.modelo, tipomovimento: x.tm, tipomovimentofinanceiro: x.tf, status: x.status }])
  for (const [seq, v, qtd, total, custo] of x.itens) {
    const merc = Math.floor(v / 10)
    await ins('documento_mercadoria', [{ _iddocumento: x.id, _idsequencia: seq, idmercadoria: merc, idmercadoriavariacao: v, descricao: `ITEM ${v}`, qtd, valtotalliquido: total, valtotalbruto: total, valdesconto: 0, valunitarioliquido: total / qtd, idsecao: produtos.find(p => p[1] === v)![2], idpessoafuncionario: 700 }])
    if (custo !== undefined) await ins('documento_mercadoria_custo', [{ _iddocumento: x.id, _idsequencia: seq, idmercadoriavariacao: v, valcusto: custo, valcustomedio: custo }])
  }
}
const compra = { tm: 'E', tf: 'P', status: 'E', modelo: '55', pessoa: 500 }
const venda = { tm: 'S', tf: 'R', status: 'E', modelo: '65', pessoa: 600 }
await doc({ id: 1, ...compra, dia: -120, itens: [[1, 100, 20, 200, 10], [2, 120, 10, 50, 5], [3, 130, 10, 80, 8]] })
await doc({ id: 2, ...compra, dia: -30, itens: [[1, 100, 10, 110, 11]] })
await doc({ id: 10, ...venda, dia: -10, itens: [[1, 100, 2, 30, 10]] })
await doc({ id: 11, ...venda, dia: -5, itens: [[1, 100, 1, 15, 10], [2, 110, 1, 20, 8]] })
await doc({ id: 12, ...venda, dia: -100, itens: [[1, 130, 5, 60, 8]] })
await doc({ id: 13, ...venda, status: 'C', dia: -3, itens: [[1, 100, 50, 750, 10]] })
await doc({ id: 20, tm: 'E', tf: 'P', status: 'E', modelo: 'TM', pessoa: 600, dia: -4, itens: [[1, 100, 1, 15]] })
// Volume para paginação (empresa 2, item próprio): 230 documentos × 2 itens.
for (let i = 0; i < 230; i++) await doc({ id: 1000 + i, empresa: 2, ...venda, pessoa: 0, dia: -(i % 60), itens: [[1, 999, 1, 2, 1], [2, 999, 2, 4, 1]] })
await ins('mercadoria_estoque_historico', Array.from({ length: 140 }, (_, i) => ({ _idhistorico: i + 1, _iddocumento: 1000 + (i % 230), _idlocalestoque: 1, idmercadoriavariacao: 999, datahora: at(-(i % 60)), qtdsaldoatual: i, qtdnovosaldo: i - 1 })))
await ins('mercadoria_tabela_preco_historico', [{ _idhistorico: 1, _idempresa: 1, _idmercadoriavariacao: 100, _idtabela: 1, datahora: at(-20), valprecotual: 14, valpreconovo: 15 }])
await ins('inventario', [{ _idinventario: 1, idempresa: 1, descricao: 'GERAL', idlocalestoque: 1, status: 'F', datahora: at(-15) }])
await ins('inventario_mercadoria', [{ _idinventario: 1, _idsequencia: 1, idmercadoriavariacao: 100, datahora: at(-15), qtdcontada: 25, qtdanterior: 26, valcusto: 10 }])
await ins('documento_cancelamento_historico', [{ _iddocumento: 13, datahora: at(-3, '11:00:00'), motivo: 'DESISTÊNCIA' }])
await sb.exec(`insert into cfg_secao_setor (idsecao, setor) values (1, 'Alimentação'), (2, 'Farmácia')`)

// ---------- API do ERP simulada ----------
class FakeErp implements ErpLike {
  requests = 0
  constructor(readonly pageSize: number, private cap: number) {}
  async page(sql: string, offset: number, limit = this.pageSize) {
    this.requests++
    assertReadOnly(sql)
    const res = await erp.query<Record<string, unknown>>(`SELECT * FROM (${sql}) q LIMIT ${Math.min(limit, this.cap)} OFFSET ${offset}`)
    const types = new Map(res.fields.map(f => [f.name, f.dataTypeID]))
    // O PGlite lê date como meia-noite UTC e timestamp sem fuso no fuso desta máquina: formata cada um
    // com os componentes correspondentes, devolvendo o texto exatamente como está gravado no "ERP".
    const p2 = (n: number) => String(n).padStart(2, '0')
    const localText = (v: Date) => `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())} ${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`
    const rows = res.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
      if (v instanceof Date) return [k, types.get(k) === 1082 ? v.toISOString().slice(0, 10) : localText(v)]
      return [k, v]
    })))
    return { rows: JSON.parse(JSON.stringify(rows, (_k, v) => typeof v === 'bigint' ? Number(v) : v)) as Record<string, unknown>[] }
  }
}

// ---------- Store em Postgres local ----------
const str = (v: unknown) => v instanceof Date ? v.toISOString() : (v as string | null)
class PgStore implements Store {
  async tryLock(owner: string, ttl: number) { return (await sb.query<{ ok: boolean }>('select sync_try_lock($1, $2, $3) as ok', ['erp_sync', owner, ttl])).rows[0].ok }
  async releaseLock(owner: string) { await sb.query('select sync_release_lock($1, $2)', ['erp_sync', owner]) }
  async getSettings() { return (await sb.query<Settings>('select auto_enabled, recent_days from sync_settings where id = 1')).rows[0] }
  async getStates(): Promise<JobState[]> {
    const rows = (await sb.query<Record<string, unknown>>('select * from sync_state')).rows
    return rows.map(r => ({
      dataset: r.dataset as string, enabled: r.enabled as boolean, kind: r.kind as string, cursor: r.cursor as JobState['cursor'],
      window_from: r.window_from instanceof Date ? r.window_from.toISOString().slice(0, 10) : r.window_from as string | null,
      cycle_started_at: str(r.cycle_started_at), last_completed_at: str(r.last_completed_at), last_synced_at: str(r.last_synced_at),
      status: r.status as string, last_error: r.last_error as string | null, rows_cycle: Number(r.rows_cycle), rows_total: Number(r.rows_total),
    }))
  }
  async saveState(s: JobState) {
    const cols = Object.keys(s) as (keyof JobState)[]
    await sb.query(`insert into sync_state (${cols.join(', ')}, updated_at) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, now())
      on conflict (dataset) do update set ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, updated_at = now()`,
      cols.map(c => c === 'cursor' ? (s.cursor === null ? null : JSON.stringify(s.cursor)) : s[c]))
  }
  async upsert(table: string, rows: TypedRow[], keys: string[]) {
    for (const r of rows) {
      const cols = Object.keys(r)
      await sb.query(`insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
        on conflict (${keys.join(', ')}) do update set ${cols.filter(c => !keys.includes(c)).map(c => `${c} = excluded.${c}`).join(', ')}`, cols.map(c => r[c]))
    }
  }
  async markStale(table: string, before: string, now: string) {
    await sb.query(`update ${table} set sync_deleted_at = $1 where sync_seen_at < $2 and sync_deleted_at is null`, [now, before])
  }
  async saveWarnings(avisos: Aviso[]) {
    for (const a of avisos) await sb.query(`insert into sync_avisos (chave, dataset, tabela, coluna, valor, motivo, acao, registro, ultima_vez, resolvido_em) values ($1,$2,$3,$4,$5,$6,$7,$8, now(), null)
      on conflict (chave) do update set valor = excluded.valor, ultima_vez = now(), resolvido_em = null`, [a.chave, a.dataset ?? null, a.tabela, a.coluna, String(a.valor), a.motivo, a.acao, JSON.stringify(a.registro)])
  }
  async insertRun(r: RunRecord) {
    await sb.query('insert into sync_runs (dataset, mode, status, started_at, finished_at, rows_read, rows_written, erp_requests, error, details) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      ['*', r.trigger, r.status, r.started_at, r.finished_at, r.rows_read, r.rows_written, r.erp_requests, r.error, JSON.stringify(r.details)])
  }
}
const store = new PgStore()
const opts = { maxSubrequests: 45, utcOffset: '-03:00', timeZone: 'America/Belem' }

/** Roda execuções até não haver mais nada devido. */
async function settle(clock: Date, label: string) {
  const api = new FakeErp(25, 17) // pede 25, a API devolve no máximo 17
  let runs = 0
  for (;;) {
    runs++
    const r = await runSync({ erp: api, store }, { ...opts, trigger: 'manual', now: () => clock })
    assert.notEqual(r.status, 'error', `${label}: ${r.message}`)
    assert.notEqual(r.status, 'partial', `${label}: ${r.message}`)
    if (r.message === 'Nada a sincronizar agora.') break
    assert.ok(runs < 200, `${label}: não estabilizou`)
  }
  return { runs, requests: api.requests }
}

const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n)
const one = async <T = Record<string, unknown>>(sql: string) => (await sb.query<T>(sql)).rows[0]

const t0 = new Date()
let first = { runs: 0, requests: 0 }
await test('carga inicial completa (páginas curtas, orçamento de 45 subrequests)', async () => {
  first = await settle(t0, 'carga inicial')
  for (const d of mirrorTables()) {
    const a = await count(erp, `select count(*) as n from ${d.table}`)
    const b = await count(sb, `select count(*) as n from erp_${d.table} where sync_deleted_at is null`)
    assert.equal(b, a, `erp_${d.table}: ${b} no Supabase, ${a} no ERP`)
  }
  console.log(`        ${first.runs} execuções, ${first.requests} requisições ao ERP`)
})
await test('cron com sincronização automática desligada não faz nada', async () => {
  const r = await runSync({ erp: new FakeErp(25, 25), store }, { ...opts, trigger: 'cron', now: () => t0 })
  assert.equal(r.status, 'skipped')
})
await test('trava impede execução simultânea', async () => {
  assert.equal(await store.tryLock('outro', 60), true)
  const r = await runSync({ erp: new FakeErp(25, 25), store }, { ...opts, trigger: 'manual', now: () => t0 })
  assert.equal(r.status, 'skipped')
  await store.releaseLock('outro')
})
await test('valores convertidos com fidelidade (hora local → UTC, texto com aspas, decimais)', async () => {
  const d = await one<{ datahora: Date }>('select datahora from erp_documento where _iddocumento = 10')
  assert.equal(d.datahora.toISOString(), `${day(-10)}T13:00:00.000Z`)
  const l = await one<{ _lote: string; qtdsaldo: string }>(`select _lote, qtdsaldo from erp_mercadoria_estoque_lote where _idmercadoriavariacao = 110`)
  assert.equal(l._lote, "L'1")
  assert.equal(Number(l.qtdsaldo), 4)
  const p = await one<{ nome: string }>('select nome from erp_pessoa where _idpessoa = 500')
  assert.equal(p.nome, "DISTRIBUIDORA D'OESTE")
})
await test('views: vendas, cancelada fora, lucro, devolução, margem', async () => {
  assert.equal(await count(sb, 'select count(*) as n from vw_venda_item where iddocumento = 13'), 0)
  const dia = await one<Record<string, string>>(`select * from vw_venda_diaria where idempresa = 1 and data = '${day(-10)}'`)
  assert.equal(Number(dia.faturamento_bruto), 30); assert.equal(Number(dia.lucro_bruto), 10); assert.equal(Number(dia.margem_pct), 33.33); assert.equal(Number(dia.ticket_medio), 30)
  const dev = await one<Record<string, string>>(`select * from vw_venda_diaria where idempresa = 1 and data = '${day(-4)}'`)
  assert.equal(Number(dev.devolucoes), 15); assert.equal(Number(dev.faturamento_liquido), -15)
})
await test('views: situação dos produtos (sem saída, parado, excesso, saudável)', async () => {
  const sit = Object.fromEntries((await sb.query<{ idmercadoriavariacao: string; situacao: string }>('select idmercadoriavariacao, situacao from vw_produto_desempenho')).rows.map(r => [Number(r.idmercadoriavariacao), r.situacao]))
  assert.equal(sit[120], 'sem_saida_historica')
  assert.equal(sit[130], 'parado')
  assert.equal(sit[100], 'excesso_estoque') // 26 em estoque, 3 vendidos em 90 dias: ~780 dias de cobertura
  assert.equal(sit[999], 'saudavel') // 100 em estoque, ~7,7/dia: ~13 dias de cobertura
  const p = await one<Record<string, string>>('select * from vw_produto_desempenho where idmercadoriavariacao = 120')
  assert.equal(Number(p.valor_estoque), 50)
  // Nome vem da mercadoria quando a descrição da variação é vazia (como no ERP real).
  await sb.exec(`update erp_mercadoria_variacao set descricao = '' where _idmercadoriavariacao = 120`)
  assert.equal((await one<{ descricao: string }>('select descricao from vw_produto_desempenho where idmercadoriavariacao = 120')).descricao, 'PETISCO PARADO')
  assert.equal(p.setor, 'Alimentação')
})
await test('views: lote crítico com risco de perda; preço do fornecedor +10%', async () => {
  const l = await one<Record<string, unknown>>(`select * from vw_lote_validade where idmercadoriavariacao = 110`)
  assert.equal(l.faixa, 'critico_7d'); assert.equal(l.risco_perda, true); assert.equal(Number(l.valor_em_risco), 32)
  const f = await one<Record<string, string>>('select * from vw_fornecedor_preco_item where idfornecedor = 500 and idmercadoriavariacao = 100')
  assert.equal(Number(f.ultimo_preco), 11); assert.equal(Number(f.penultimo_preco), 10); assert.equal(Number(f.variacao_ultima_pct), 10)
  const r = await one<Record<string, string>>('select * from vw_fornecedor_resumo where idfornecedor = 500')
  assert.equal(Number(r.total_comprado), 440); assert.equal(Number(r.compras), 2)
})
await test('views: clientes, setores, declínio e resumo executam', async () => {
  const c = await one<Record<string, string>>('select * from vw_cliente_rfm where idcliente = 600')
  assert.equal(Number(c.compras), 3)
  assert.ok(await count(sb, `select count(*) as n from vw_setor_mensal where setor = 'Alimentação'`) > 0)
  await sb.query('select * from vw_produto_declinio')
  const resumo = await one<Record<string, string>>('select * from vw_resumo_gestao')
  assert.equal(Number(resumo.produtos_sem_saida), 1); assert.equal(Number(resumo.lotes_criticos), 1); assert.equal(Number(resumo.itens_aumento_custo_10pct), 1)
})

await test('resumo do mês: vendas, compras, rankings e histórico batem com as views', async () => {
  const ref = day(-10)
  const ini = ref.slice(0, 8) + '01'
  const r = (await sb.query<{ r: Record<string, any> }>(`select resumo_mes('${ref}') as r`)).rows[0].r
  const soma = async (view: string) => Number((await one<{ s: string }>(`select coalesce(sum(valtotalliquido), 0) as s from ${view} where data >= '${ini}' and data < (date '${ini}' + interval '1 month')`)).s)
  const fat = await soma('vw_venda_item'), comp = await soma('vw_compra_item'), dev = await soma('vw_devolucao_item')
  assert.equal(r.mes, ref.slice(0, 7))
  assert.equal(Number(r.kpis.faturamento), fat)
  assert.equal(Number(r.kpis.compras), comp)
  assert.equal(Number(r.kpis.faturamento_liquido), Math.round((fat - dev) * 100) / 100)
  assert.equal(r.historico.length, 12)
  assert.equal(r.historico[11].mes, r.mes)
  assert.equal(r.por_dia.length, r.dias_no_mes)
  assert.equal(r.por_dia.reduce((a: number, d: any) => a + Number(d.faturamento), 0), fat)
  if (fat > 0) {
    assert.ok(r.top_faturamento.length > 0)
    const pct = r.setores.reduce((a: number, x: any) => a + Number(x.pct), 0)
    assert.ok(Math.abs(pct - 100) < 0.1, `setores somam ${pct}%`)
  }
  if (comp > 0) assert.ok(Math.abs(r.fornecedores_compra.reduce((a: number, x: any) => a + Number(x.pct), 0) - 100) < 0.1)
  // Mês do pedido de compra de 30 dias atrás: fornecedor 500, 10 un. a 11.
  const rc = (await sb.query<{ r: Record<string, any> }>(`select resumo_mes('${day(-30)}') as r`)).rows[0].r
  const f = rc.fornecedores_compra.find((x: any) => Number(x.id) === 500)
  assert.ok(f, 'fornecedor 500 deveria aparecer nas compras do mês')
  assert.equal(f.nome, "DISTRIBUIDORA D'OESTE")
  assert.ok(Number(f.valor) >= 110)
})

// ---------- Mudanças no ERP ----------
await erp.exec(`update documento set status = 'C' where _iddocumento = 11`)
await erp.exec(`delete from mercadoria_estoque_lote where _lote = 'L2'`)
await erp.exec(`update mercadoria_estoque set qtdsaldo = 9 where _idmercadoriavariacao = 120`)
await doc({ id: 14, ...venda, dia: 0, itens: [[1, 120, 1, 9, 5]] })
const t1 = new Date(t0.getTime() + 25 * 3600 * 1000)

await test('nova rodada pega cancelamento (releitura), item novo (append), saldo novo e lote removido', async () => {
  const r = await settle(t1, 'segunda rodada')
  assert.ok(r.requests < first.requests, 'segunda rodada deveria ser incremental')
  assert.equal((await one<{ status: string }>('select status from erp_documento where _iddocumento = 11')).status, 'C')
  assert.equal(await count(sb, 'select count(*) as n from erp_documento where _iddocumento = 14'), 1)
  assert.equal(Number((await one<{ q: string }>('select qtdsaldo as q from erp_mercadoria_estoque where _idmercadoriavariacao = 120')).q), 9)
  assert.ok((await one<{ sync_deleted_at: Date | null }>(`select sync_deleted_at from erp_mercadoria_estoque_lote where _lote = 'L2'`)).sync_deleted_at, 'L2 deveria estar marcado como removido')
  assert.equal(await count(sb, 'select count(*) as n from vw_venda_item where iddocumento = 11'), 0)
  const p = await one<{ situacao: string }>('select situacao from vw_produto_desempenho where idmercadoriavariacao = 120')
  assert.equal(p.situacao, 'excesso_estoque')
})
await test('erro de dados num job não para os outros e fica registrado', async () => {
  await erp.exec(`insert into mercadoria_marca (_idmarca, descricao) values (2, 'NOVA')`)
  await erp.exec(`alter table mercadoria_grupo rename column descricao to descricao_x`)
  const clock = new Date(t1.getTime() + 25 * 3600 * 1000)
  const r = await runSync({ erp: new FakeErp(25, 25), store }, { ...opts, trigger: 'manual', now: () => clock })
  assert.equal(r.status, 'partial')
  const g = (await store.getStates()).find(s => s.dataset === 'mercadoria_grupo')!
  assert.equal(g.status, 'error'); assert.match(g.last_error!, /descricao/)
  assert.equal(await count(sb, 'select count(*) as n from erp_mercadoria_marca where _idmarca = 2'), 1)
})

await test('data impossível em campo secundário não para a leitura: fica em branco ou o lote é pulado, e vira aviso', async () => {
  await erp.exec(`alter table mercadoria_grupo rename column descricao_x to descricao`)
  // Lote com validade no ano 0206 (a validade é chave do lote) e um lote válido depois dele na ordem da chave.
  await erp.exec(`insert into mercadoria_estoque_lote (_idempresa, _idlocalestoque, _idmercadoriavariacao, _lote, _dtvalidade, _dtentrada, qtdsaldo, datahora) values
    (1, 1, 110, 'LX9', '0206-01-30', '${day(-15)}', 7, '${at(0)}'), (1, 1, 120, 'LZ', '${day(90)}', '${day(-15)}', 3, '${at(0)}')`)
  // Item de nota com validade digitada no ano 0026 (campo secundário).
  await doc({ id: 2000, ...compra, dia: 0, itens: [[1, 120, 5, 25, 5]] })
  await erp.exec(`update documento_mercadoria set dtvalidade = '0026-12-01', lote = 'W1' where _iddocumento = 2000`)
  const clock = new Date(t1.getTime() + 50 * 3600 * 1000)
  for (let i = 0; i < 6; i++) {
    const r = await runSync({ erp: new FakeErp(25, 25), store }, { ...opts, trigger: 'manual', only: ['mercadoria_estoque_lote', 'documento', 'documento_mercadoria'], now: () => new Date(clock.getTime() + i * 60_000) })
    assert.notEqual(r.status, 'error')
  }
  const states = await store.getStates()
  for (const ds of ['mercadoria_estoque_lote', 'documento_mercadoria']) assert.notEqual(states.find(x => x.dataset === ds)!.status, 'error', `${ds} não deveria parar`)
  assert.equal(await count(sb, `select count(*) as n from erp_mercadoria_estoque_lote where _lote = 'LZ' and sync_deleted_at is null`), 1, 'lote depois do inválido deveria entrar')
  assert.equal(await count(sb, `select count(*) as n from erp_mercadoria_estoque_lote where _lote = 'LX9'`), 0)
  const item = await one<{ dtvalidade: Date | null; lote: string }>('select dtvalidade, lote from erp_documento_mercadoria where _iddocumento = 2000')
  assert.equal(item.dtvalidade, null); assert.equal(item.lote, 'W1')
  const av = (await sb.query<{ tabela: string; coluna: string; acao: string; valor: string; registro: Record<string, unknown> }>('select tabela, coluna, acao, valor, registro from sync_avisos where resolvido_em is null order by tabela')).rows
  const lote = av.find(a => a.tabela === 'mercadoria_estoque_lote')!, nota = av.find(a => a.tabela === 'documento_mercadoria')!
  assert.equal(lote.acao, 'ignorado'); assert.equal(Number(lote.registro._idmercadoriavariacao), 110); assert.equal(lote.registro._lote, 'LX9')
  assert.equal(nota.acao, 'em_branco'); assert.equal(nota.coluna, 'dtvalidade'); assert.equal(Number(nota.registro._iddocumento), 2000)
  // O diagnóstico do aviso diz que a leitura não parou e onde corrigir.
  const fakeDb = { select: async (t: string, q: string) => (await sb.query(t === 'vw_produto_desempenho' ? `select descricao, codigobarras, secao, setor, estoque_atual from vw_produto_desempenho where idmercadoriavariacao = ${q.match(/eq\.(\d+)/)![1]}` : 'select 1 where false')).rows }
  const dg = await diagnosticar({ ...lote, valor: lote.valor, motivo: 'não é data' }, '', fakeDb as never, lote.acao as 'ignorado')
  assert.equal(dg.valor_recebido, '30/01/0206'); assert.match(dg.problema, /ano 0206/); assert.match(dg.impacto, /não foi copiado/)
  assert.ok(dg.passos.some(p => p.includes('LX9')))
})

await test('data impossível em campo essencial (data do documento) ainda para a leitura, com diagnóstico', async () => {
  await erp.exec(`insert into documento (_iddocumento, idempresa, idpessoa, datahora, numero, modelo, tipomovimento, tipomovimentofinanceiro, status) values (2001, 1, 600, '0026-05-01 10:00', '2001', '65', 'S', 'R', 'E')`)
  const clock = new Date(t1.getTime() + 60 * 3600 * 1000)
  await runSync({ erp: new FakeErp(25, 25), store }, { ...opts, trigger: 'manual', only: ['documento'], now: () => clock })
  const st = (await store.getStates()).find(x => x.dataset === 'documento')!
  assert.equal(st.status, 'error')
  const { mensagem, info } = lerErro(st.last_error)
  assert.match(mensagem, /datahora/); assert.equal(Number(info!.registro._iddocumento), 2001)
  const dg = await diagnosticar(info!, mensagem, { select: async () => [] } as never)
  assert.match(dg.impacto, /parada/); assert.ok(dg.passos.some(p => p.includes('2001')))
  await erp.exec(`delete from documento where _iddocumento = 2001`)
})

console.log(`\n${passed} testes passaram.`)
