// Motor de sincronização ERP → Supabase.
//
// Cada execução (cron a cada 5 min ou manual) tem um orçamento de subrequests (limite do Cloudflare:
// 50 no plano Free, 1000 no pago). Os jobs são processados em ordem de prioridade; cada página custa
// 3 subrequests (ERP + gravação + estado) e o estado é salvo a cada página, então uma execução
// interrompida continua de onde parou na próxima.

import { convertRow, keyOf, type TypedRow, type Value } from './convert'
import { DATASETS, target, type Dataset } from './datasets'
import { buildSelect } from './sql'
import type { JobState, Store } from './store'

export interface ErpLike {
  page(sql: string, offset: number, limit?: number): Promise<{ rows: Record<string, unknown>[] }>
  readonly pageSize: number
  readonly requests: number
}

export type Trigger = 'cron' | 'manual'

export interface SyncOptions {
  trigger: Trigger
  /** Só estes datasets (manual). Ignora o intervalo de atualização. */
  only?: string[]
  maxSubrequests: number
  utcOffset: string
  timeZone: string
  now?: () => Date
}

export interface JobSummary { dataset: string; pages: number; rows: number; status: string; completed: boolean; error?: string }

export interface SyncResult {
  status: 'ok' | 'partial' | 'error' | 'skipped'
  message: string
  erpRequests: number
  rows: number
  jobs: JobSummary[]
}

const LOCK_TTL_SECONDS = 900
const ERROR_RETRY_MINUTES = 15

class Budget {
  constructor(private left: number) {}
  get remaining() { return this.left }
  take(n = 1) { if (this.left < n) throw new BudgetExhausted(); this.left -= n }
}
class BudgetExhausted extends Error { constructor() { super('Orçamento de subrequests esgotado.') } }

/** Erros que impedem qualquer job (credencial, configuração): param a execução inteira. */
function isFatal(e: unknown) {
  const kind = (e as { kind?: string })?.kind
  return kind === 'auth' || kind === 'config' || kind === 'rate_limit' || kind === 'unavailable'
}

export function emptyState(d: Dataset): JobState {
  return { dataset: d.name, enabled: true, kind: d.kind, cursor: null, window_from: null, cycle_started_at: null, last_completed_at: null, last_synced_at: null, status: 'idle', last_error: null, rows_cycle: 0, rows_total: 0 }
}

/** Data local (AAAA-MM-DD) no fuso da loja. */
export function localDate(timeZone: string, at: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const minutesSince = (iso: string | null, now: Date) => iso ? (now.getTime() - Date.parse(iso)) / 60000 : Infinity

export function isDue(d: Dataset, s: JobState, now: Date): boolean {
  if (!s.enabled) return false
  if (s.status === 'error' && minutesSince(s.last_synced_at, now) < ERROR_RETRY_MINUTES) return false
  if (s.cycle_started_at) return true
  return minutesSince(s.last_completed_at, now) >= d.refreshMinutes
}

const sameKey = (a: Value[] | null, b: Value[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i])

/** Processa páginas de um job até completar o ciclo ou acabar o orçamento. */
async function runJob(d: Dataset, s: JobState, deps: { erp: ErpLike; store: Store }, budget: Budget, opts: SyncOptions & { recentDays: number }, summary: JobSummary) {
  const now = () => (opts.now ?? (() => new Date()))()
  if (!s.cycle_started_at) {
    s.cycle_started_at = now().toISOString()
    s.rows_cycle = 0
    if (d.kind !== 'append') s.cursor = null
    s.window_from = d.kind === 'recent' ? addDays(localDate(opts.timeZone, now()), -opts.recentDays) : null
  }
  for (;;) {
    if (budget.remaining < 3) return
    const sql = buildSelect(d, s.cursor, s.window_from)
    budget.take()
    const { rows } = await deps.erp.page(sql, 0, deps.erp.pageSize)
    summary.pages++

    if (!rows.length) {
      // Fim do ciclo. Snapshot: o que não foi visto nesta varredura completa saiu do ERP.
      if (d.kind === 'snapshot') { budget.take(); await deps.store.markStale(target(d), s.cycle_started_at!, now().toISOString()) }
      s.cycle_started_at = null
      s.last_completed_at = now().toISOString()
      s.last_synced_at = s.last_completed_at
      if (d.kind !== 'append') s.cursor = null
      s.status = 'ok'
      s.last_error = null
      summary.completed = true
      summary.status = 'ok'
      budget.take(); await deps.store.saveState(s)
      return
    }

    const seenAt = now().toISOString()
    const byKey = new Map<string, TypedRow>()
    let last: Value[] | null = null
    for (const raw of rows) {
      const row = convertRow(d, raw, opts.utcOffset)
      const key = keyOf(d, row)
      byKey.set(JSON.stringify(key), { ...row, sync_seen_at: seenAt, sync_deleted_at: null })
      last = key
    }
    if (sameKey(s.cursor, last!)) throw new Error(`${d.name}: a API repetiu a mesma página (cursor não avançou).`)

    budget.take(); await deps.store.upsert(target(d), [...byKey.values()], d.keys)
    s.cursor = last
    s.rows_cycle += byKey.size
    s.rows_total += byKey.size
    s.status = 'running'
    s.last_error = null
    s.last_synced_at = seenAt
    summary.rows += byKey.size
    summary.status = 'running'
    budget.take(); await deps.store.saveState(s)
  }
}

export async function runSync(deps: { erp: ErpLike; store: Store }, opts: SyncOptions): Promise<SyncResult> {
  const now = () => (opts.now ?? (() => new Date()))()
  const startedAt = now().toISOString()
  const budget = new Budget(opts.maxSubrequests)
  const jobs: JobSummary[] = []
  const owner = crypto.randomUUID()
  const base = (status: SyncResult['status'], message: string): SyncResult =>
    ({ status, message, erpRequests: deps.erp.requests, rows: jobs.reduce((n, j) => n + j.rows, 0), jobs })

  const unknown = (opts.only ?? []).filter(n => !DATASETS.some(d => d.name === n))
  if (unknown.length) return base('error', `Dataset(s) desconhecido(s): ${unknown.join(', ')}`)

  budget.take()
  if (!(await deps.store.tryLock(owner, LOCK_TTL_SECONDS))) return base('skipped', 'Outra sincronização está em andamento.')
  let fatal: string | null = null
  try {
    budget.take(2)
    const settings = await deps.store.getSettings()
    if (opts.trigger === 'cron' && !settings.auto_enabled) return base('skipped', 'Sincronização automática desligada.')
    const states = new Map((await deps.store.getStates()).map(s => [s.dataset, s]))
    budget.take(2) // reserva: registro da execução + liberação da trava

    const list = opts.only?.length ? DATASETS.filter(d => opts.only!.includes(d.name)) : DATASETS
    for (const d of list) {
      if (budget.remaining < 3) break
      const s = { ...emptyState(d), ...states.get(d.name), kind: d.kind }
      if (!s.enabled && !opts.only) continue
      if (!opts.only && !isDue(d, s, now())) continue
      const summary: JobSummary = { dataset: d.name, pages: 0, rows: 0, status: s.status, completed: false }
      jobs.push(summary)
      try {
        await runJob(d, s, deps, budget, { ...opts, recentDays: settings.recent_days }, summary)
      } catch (e) {
        if (e instanceof BudgetExhausted) break
        const message = e instanceof Error ? e.message : String(e)
        summary.status = 'error'
        summary.error = message
        if (isFatal(e)) { fatal = message; break }
        s.status = 'error'
        s.last_error = message.slice(0, 2000)
        s.last_synced_at = now().toISOString()
        if (budget.remaining >= 3) { budget.take(); await deps.store.saveState(s) }
      }
    }
    const errors = jobs.filter(j => j.status === 'error')
    const pending = jobs.some(j => !j.completed && j.status !== 'error')
    const result = fatal
      ? base('error', fatal)
      : errors.length ? base('partial', `${errors.length} job(s) com erro: ${errors.map(j => `${j.dataset}: ${j.error}`).join(' | ').slice(0, 1000)}`)
        : base('ok', jobs.length ? (pending ? 'Execução parcial; continua na próxima.' : 'Jobs devidos concluídos.') : 'Nada a sincronizar agora.')
    await deps.store.insertRun({ trigger: opts.trigger, status: result.status, started_at: startedAt, finished_at: now().toISOString(), rows_read: result.rows, rows_written: result.rows, erp_requests: deps.erp.requests, error: result.status === 'ok' ? null : result.message, details: { jobs } }).catch(() => undefined)
    return result
  } finally {
    await deps.store.releaseLock(owner).catch(() => undefined)
  }
}
