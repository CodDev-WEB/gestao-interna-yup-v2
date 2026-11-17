// Cliente mínimo do Supabase (PostgREST + Auth) para o Worker.
// Usa a chave service_role, que existe só como Secret do Worker.

import type { Env } from '../types'

export class SupabaseError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

/** Recusa do Supabase Auth, com o código que ele informou (ex.: invalid_credentials). */
export class AuthError extends Error {
  constructor(public status: number, public code: string, detail: string) { super(detail || code || `Supabase Auth ${status}`) }
}

export type Row = Record<string, unknown>

export interface Session { access_token: string; refresh_token: string; expires_in: number; user?: { id: string; email?: string } }

export class Supabase {
  private url: string
  private key: string

  constructor(env: Env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SupabaseError('Secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados.', 500)
    // trim: Secrets gravados pelo terminal do Windows podem chegar com \r\n no fim.
    this.url = env.SUPABASE_URL.trim().replace(/\/+$/, '')
    this.key = env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }

  private headers(extra: Record<string, string> = {}) {
    // Chave nova (sb_secret_) vai só no apikey; a antiga service_role (JWT) também vai como Bearer.
    const auth: Record<string, string> = this.key.startsWith('eyJ') ? { Authorization: `Bearer ${this.key}` } : {}
    return { apikey: this.key, ...auth, 'Content-Type': 'application/json', ...extra }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.url}${path}`, init)
    if (!res.ok) {
      let detail = ''
      try { const body = await res.json() as { message?: string; hint?: string }; detail = [body.message, body.hint].filter(Boolean).join(' ') } catch { /* corpo vazio */ }
      throw new SupabaseError(`Supabase ${res.status}: ${detail || res.statusText}`, res.status)
    }
    return res
  }

  async select<T = Row>(table: string, query: string): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}?${query}`, { headers: this.headers() })
    return await res.json() as T[]
  }

  /** Lê todas as páginas (1000 por vez). */
  async selectAll<T = Row>(table: string, query: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const res = await this.request(`/rest/v1/${table}?${query}`, { headers: this.headers({ Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }) })
      const page = await res.json() as T[]
      out.push(...page)
      if (page.length < 1000) return out
    }
  }

  /** Uma página com o total de linhas (para tabelas paginadas). */
  async selectPage<T = Row>(table: string, query: string, limit: number, offset: number): Promise<{ rows: T[]; total: number }> {
    let res: Response
    try { res = await this.request(`/rest/v1/${table}?${query}`, { headers: this.headers({ Range: `${offset}-${offset + limit - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' }) }) }
    catch (e) { if (e instanceof SupabaseError && e.status === 416) return { rows: [], total: offset }; throw e }
    const range = res.headers.get('content-range') || ''
    const total = Number(range.split('/')[1])
    return { rows: await res.json() as T[], total: Number.isFinite(total) ? total : 0 }
  }

  async count(table: string, query: string): Promise<number> {
    const res = await this.request(`/rest/v1/${table}?${query}`, { method: 'HEAD', headers: this.headers({ Prefer: 'count=exact', Range: '0-0' }) })
    const range = res.headers.get('content-range') || ''
    const total = Number(range.split('/')[1])
    return Number.isFinite(total) ? total : 0
  }

  async insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}`, { method: 'POST', headers: this.headers({ Prefer: 'return=representation' }), body: JSON.stringify(rows) })
    return await res.json() as T[]
  }

  /** UPSERT idempotente em lotes. */
  async upsert(table: string, rows: Row[], onConflict: string, batchSize = 500): Promise<number> {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      await this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      })
    }
    return rows.length
  }

  async update<T = Row>(table: string, filter: string, values: Row): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=representation' }), body: JSON.stringify(values) })
    return await res.json() as T[]
  }

  /** PATCH sem devolver as linhas (para atualizações em massa). */
  async patch(table: string, filter: string, values: Row): Promise<void> {
    await this.request(`/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(values) })
  }

  async deleteWhere(table: string, filter: string): Promise<void> {
    await this.request(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) })
  }

  async insertMinimal(table: string, rows: Row | Row[]): Promise<void> {
    await this.request(`/rest/v1/${table}`, { method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify(rows) })
  }

  /** Chama uma função SQL (POST /rest/v1/rpc/nome). */
  async rpc<T = unknown>(fn: string, args: Row): Promise<T> {
    const res = await this.request(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(args) })
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** Login por e-mail e senha (Supabase Auth). Devolve a sessão ou null se as credenciais forem recusadas. */
  async passwordLogin(email: string, password: string): Promise<Session | null> {
    return this.token('password', { email, password })
  }

  /** Renova a sessão com o refresh token. */
  async refreshSession(refreshToken: string): Promise<Session | null> {
    return this.token('refresh_token', { refresh_token: refreshToken })
  }

  private async token(grant: string, body: Record<string, string>): Promise<Session | null> {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      let code = '', msg = ''
      const text = await res.text()
      try { const e = JSON.parse(text) as { error_code?: string; code?: string | number; error?: string; msg?: string; message?: string; error_description?: string }; code = e.error_code || e.error || (typeof e.code === 'string' ? e.code : '') || ''; msg = e.msg || e.error_description || e.message || '' } catch { msg = text.slice(0, 200) }
      code = code || res.headers.get('x-sb-error-code') || ''
      if (!msg && !code) msg = `${text.slice(0, 200)} [${[...res.headers.keys()].join(',')}]`
      throw new AuthError(res.status, code, msg)
    }
    const s = await res.json() as Session & { user?: { id: string; email?: string } }
    return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, user: s.user ? { id: s.user.id, email: s.user.email } : undefined }
  }

  /** Usuário dono do token de sessão (JWT do Supabase Auth) ou null. */
  async getUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
    const res = await fetch(`${this.url}/auth/v1/user`, { headers: { apikey: this.key, Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const user = await res.json() as { id?: string; email?: string }
    return user.id ? { id: user.id, email: user.email } : null
  }
}

/** Valor seguro para filtros do PostgREST (só datas, UUIDs, números e códigos já validados). */
export function eq(value: string) {
  if (!/^[0-9A-Za-z_.:+-]+$/.test(value)) throw new SupabaseError('Valor de filtro inválido.', 400)
  return encodeURIComponent(value)
}
