// Onde a sincronização guarda dados e estado. Em produção é o Supabase (PostgREST);
// nos testes, um Postgres local (PGlite) implementa a mesma interface.

import type { Supabase } from '../supabase/client'
import type { Aviso, TypedRow, Value } from './convert'

export interface JobState {
  dataset: string
  enabled: boolean
  kind: string | null
  cursor: Value[] | null
  window_from: string | null
  cycle_started_at: string | null
  last_completed_at: string | null
  last_synced_at: string | null
  status: string
  last_error: string | null
  rows_cycle: number
  rows_total: number
}

export interface Settings { auto_enabled: boolean; recent_days: number }

export interface RunRecord {
  trigger: string; status: string; started_at: string; finished_at: string
  rows_read: number; rows_written: number; erp_requests: number; error: string | null; details: Record<string, unknown>
}

export interface Store {
  tryLock(owner: string, ttlSeconds: number): Promise<boolean>
  releaseLock(owner: string): Promise<void>
  getSettings(): Promise<Settings>
  getStates(): Promise<JobState[]>
  saveState(state: JobState): Promise<void>
  /** UPSERT idempotente pela chave. */
  upsert(table: string, rows: TypedRow[], keys: string[]): Promise<void>
  /** Marca como removido do ERP o que não foi visto desde `before` (nada é apagado). */
  markStale(table: string, before: string, now: string): Promise<void>
  insertRun(run: RunRecord): Promise<void>
  /** Registra valores impossíveis que não pararam a leitura (um por registro+coluna). */
  saveWarnings(avisos: Aviso[]): Promise<void>
}

export const LOCK_NAME = 'erp_sync'

export class PostgrestStore implements Store {
  constructor(private db: Supabase) {}

  async tryLock(owner: string, ttlSeconds: number) {
    return (await this.db.rpc<boolean>('sync_try_lock', { p_name: LOCK_NAME, p_owner: owner, p_ttl_seconds: ttlSeconds })) === true
  }

  async releaseLock(owner: string) {
    await this.db.rpc('sync_release_lock', { p_name: LOCK_NAME, p_owner: owner })
  }

  async getSettings(): Promise<Settings> {
    const [row] = await this.db.select<Settings>('sync_settings', 'id=eq.1&select=auto_enabled,recent_days')
    if (!row) throw new Error('sync_settings vazio: execute as migrações do Supabase.')
    return row
  }

  async getStates() {
    const rows = await this.db.select<JobState>('sync_state', 'select=*')
    return rows.map(r => ({ ...r, rows_cycle: Number(r.rows_cycle ?? 0), rows_total: Number(r.rows_total ?? 0) }))
  }

  async saveState(state: JobState) {
    await this.db.upsert('sync_state', [{ ...state, updated_at: new Date().toISOString() }], 'dataset')
  }

  async upsert(table: string, rows: TypedRow[], keys: string[]) {
    if (rows.length) await this.db.upsert(table, rows, keys.join(','))
  }

  async markStale(table: string, before: string, now: string) {
    await this.db.patch(table, `sync_seen_at=lt.${encodeURIComponent(before)}&sync_deleted_at=is.null`, { sync_deleted_at: now })
  }

  async saveWarnings(avisos: Aviso[]) {
    if (!avisos.length) return
    const agora = new Date().toISOString()
    const unicos = [...new Map(avisos.map(a => [a.chave, a])).values()]
    await this.db.upsert('sync_avisos', unicos.map(a => ({
      chave: a.chave, dataset: a.dataset ?? null, tabela: a.tabela, coluna: a.coluna, valor: String(a.valor ?? '').slice(0, 200), motivo: a.motivo,
      acao: a.acao, registro: a.registro, ultima_vez: agora, resolvido_em: null,
    })), 'chave')
  }

  async insertRun(run: RunRecord) {
    await this.db.insertMinimal('sync_runs', { dataset: '*', mode: run.trigger, status: run.status, started_at: run.started_at, finished_at: run.finished_at, rows_read: run.rows_read, rows_written: run.rows_written, erp_requests: run.erp_requests, error: run.error, details: run.details })
  }
}
