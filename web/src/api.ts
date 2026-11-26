// Acesso à API do Worker. A sessão (tokens do Supabase Auth) fica no localStorage deste navegador.

import { useCallback, useEffect, useState } from 'react'

const KEY = 'yup.sessao'
type Session = { access_token: string; refresh_token: string; email?: string }

function read(): Session | null {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) as Session : null } catch { return null }
}
function write(s: Session | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY) } catch { /* sem storage */ }
}

let session = read()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export function currentUser() { return session?.email ?? null }
export function onAuthChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export async function login(email: string, password: string) {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(b.error || `Falha no login (${r.status}).`)
  session = { access_token: b.access_token, refresh_token: b.refresh_token, email: b.user?.email }
  write(session); notify()
}

export function logout() { session = null; write(null); notify() }

async function refresh() {
  if (!session) return false
  const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
  if (!r.ok) return false
  const b = await r.json()
  session = { access_token: b.access_token, refresh_token: b.refresh_token, email: b.user?.email ?? session.email }
  write(session)
  return true
}

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg) } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const call = () => fetch(`/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${session?.access_token ?? ''}` } })
  let r = await call()
  if (r.status === 401 && await refresh()) r = await call()
  if (r.status === 401) { logout(); throw new ApiError('Sessão expirada. Entre de novo.', 401) }
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(b.error || `Erro ${r.status}`, r.status)
  return b as T
}

// Quantas telas/blocos estão buscando dados agora (para o aviso "Carregando…" global).
let emAndamento = 0
const ouvintesCarga = new Set<(n: number) => void>()
const mudarCarga = (d: number) => { emAndamento = Math.max(0, emAndamento + d); ouvintesCarga.forEach(f => f(emAndamento)) }
/** Número de buscas em andamento; atualiza quando começa ou termina uma. */
export function useCarregando() {
  const [n, setN] = useState(emAndamento)
  useEffect(() => { ouvintesCarga.add(setN); setN(emAndamento); return () => { ouvintesCarga.delete(setN) } }, [])
  return n
}

/** Carrega dados de uma rota; recarrega quando a rota muda. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true, contado = true
    setLoading(true); setError(null); mudarCarga(1)
    const fim = () => { if (contado) { contado = false; mudarCarga(-1) } }
    api<T>(path).then(d => { if (alive) setData(d) }).catch(e => { if (alive) setError(e.message) }).finally(() => { fim(); if (alive) setLoading(false) })
    return () => { alive = false; fim() }
  }, [path, tick])
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, error, loading, reload }
}

export type Page<T> = { rows: T[]; total: number }
