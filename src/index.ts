// YUP Intelligence — Worker de integração Santarém Sistemas (Meu ERP Online) → Supabase.
// Rotas de administração (/api/*, exigem Bearer ADMIN_TOKEN) e sincronização agendada (cron a cada 5 min).
// O navegador nunca envia SQL: toda consulta ao ERP é montada no Worker a partir de src/sync/datasets.ts.

import type { Env } from './types'
import { ErpClient, ErpError } from './erp/client'
import { AuthError, Supabase, SupabaseError } from './supabase/client'
import { DATASETS, DATASET_BY_NAME, type Dataset } from './sync/datasets'
import { convertRow } from './sync/convert'
import { buildCount, buildSelect } from './sync/sql'
import { runSync, type SyncOptions } from './sync/engine'
import { PostgrestStore } from './sync/store'
import { dash, DashError, salvarSecao } from './dash'
import { diagnosticar, diagnosticarVarios, lerErro } from './sync/diagnostico'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

// Compara os resumos SHA-256 (mesmo tamanho) em tempo constante, sem vazar tamanho nem conteúdo do token.
async function sameSecret(a: string, b: string) {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  return crypto.subtle.timingSafeEqual(x, y)
}

type Auth = { ok: true; who: string } | { ok: false; status: 401 | 403; error: string }

/** Perfil ativo com papel admin na tabela profiles. */
async function isAdmin(db: Supabase, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false
  const [p] = await db.select<{ role: string; active: boolean }>('profiles', `id=eq.${userId}&select=role,active`)
  return !!p && p.active && p.role === 'admin'
}

/**
 * Acesso às rotas /api/*: sessão do Supabase Auth (login e senha) de um perfil admin ativo.
 * ADMIN_TOKEN é opcional, só para automações sem usuário.
 */
async function authorize(req: Request, env: Env): Promise<Auth> {
  const header = req.headers.get('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, error: 'Faça login: POST /api/auth/login.' }
  if (env.ADMIN_TOKEN?.trim() && await sameSecret(token, env.ADMIN_TOKEN.trim())) return { ok: true, who: 'admin-token' }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 401, error: 'Supabase não configurado no Worker.' }
  const db = new Supabase(env)
  const user = await db.getUser(token)
  if (!user) return { ok: false, status: 401, error: 'Sessão inválida ou expirada.' }
  if (!(await isAdmin(db, user.id))) return { ok: false, status: 403, error: 'Usuário sem perfil admin ativo.' }
  return { ok: true, who: user.email ?? user.id }
}

class BadRequest extends Error {}

function errorResponse(e: unknown) {
  if (e instanceof BadRequest) return json({ ok: false, error: e.message }, 400)
  // Secret ausente é configuração do Worker (503); falha do serviço externo é 502.
  if (e instanceof ErpError) return json({ ok: false, source: 'erp', kind: e.kind, status: e.status, error: e.message }, e.kind === 'config' ? 503 : 502)
  if (e instanceof SupabaseError) return json({ ok: false, source: 'supabase', status: e.status, error: e.message }, e.status === 500 ? 503 : 502)
  return json({ ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }, 500)
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* abaixo */ }
  throw new BadRequest('Corpo precisa ser um objeto JSON.')
}

/** Lista de datasets pedida no corpo ({"datasets": [...]}); valida contra a lista fixa. */
function pickDatasets(b: Record<string, unknown>, fallback: Dataset[]): Dataset[] {
  if (b.datasets === undefined) return fallback
  if (!Array.isArray(b.datasets) || !b.datasets.every(x => typeof x === 'string')) throw new BadRequest('"datasets" precisa ser uma lista de nomes.')
  const unknown = b.datasets.filter(n => !DATASET_BY_NAME.has(n))
  if (unknown.length) throw new BadRequest(`Dataset(s) desconhecido(s): ${unknown.join(', ')}. Válidos: ${DATASETS.map(d => d.name).join(', ')}`)
  return b.datasets.map(n => DATASET_BY_NAME.get(n)!)
}

const uniqueTables = (list: Dataset[]) => [...new Map(list.map(d => [d.table, d])).values()]

function syncOptions(env: Env, extra: Partial<SyncOptions> & Pick<SyncOptions, 'trigger'>): SyncOptions {
  const max = Number(env.SYNC_MAX_SUBREQUESTS || 45)
  return {
    maxSubrequests: Number.isInteger(max) && max >= 10 && max <= 1000 ? max : 45,
    utcOffset: /^[+-]\d{2}:\d{2}$/.test(env.ERP_UTC_OFFSET || '') ? env.ERP_UTC_OFFSET! : '-03:00',
    timeZone: env.STORE_TIME_ZONE || 'America/Belem',
    ...extra,
  }
}

const configured = (env: Env) => Boolean(env.ERP_TOKEN && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`

    // Diagnóstico de configuração sem expor valores: formato dos Secrets e alcance do Supabase.
    if (route === 'GET /api/health' && url.searchParams.has('diag')) {
      const raw = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      const key = raw.trim()
      const shape = (s: string) => ({ length_ok: s.length > 20, trailing_whitespace: s !== s.trim(), inner_whitespace: /\s/.test(s.trim()), non_ascii: /[^\x21-\x7e]/.test(s.trim()), quotes: /["']/.test(s) })
      let host = null as string | null
      try { host = new URL((env.SUPABASE_URL ?? '').trim()).host } catch { /* inválida */ }
      const status = async (path: string, init: RequestInit) => { try { const r = await fetch(`https://${host}${path}`, init); return r.status } catch (e) { return String(e).slice(0, 80) } }
      return json({
        supabase_url_host: host,
        supabase_url_trailing_whitespace: (env.SUPABASE_URL ?? '') !== (env.SUPABASE_URL ?? '').trim(),
        service_key_format: key.startsWith('sb_secret_') ? 'sb_secret' : key.startsWith('sb_publishable_') ? 'sb_publishable (ERRADA: precisa ser a secret/service_role)' : key.startsWith('eyJ') ? 'jwt' : 'desconhecido',
        service_key: shape(raw),
        erp_token: shape(env.ERP_TOKEN ?? ''),
        rest_status: host ? await status('/rest/v1/sync_settings?select=id', { headers: { apikey: key, Authorization: key.startsWith('eyJ') ? `Bearer ${key}` : '' } }) : null,
        auth_health_status: host ? await status('/auth/v1/health', { headers: { apikey: key } }) : null,
      })
    }

    // O site (arquivos do Vite) é servido direto pelos assets; só /api/* chega ao código.
    if (!url.pathname.startsWith('/api/') && env.ASSETS) return env.ASSETS.fetch(req)

    if (route === 'GET /api/health') {
      return json({
        ok: true,
        service: 'gestao-interna-yup-v2',
        configured: {
          erp: Boolean(env.ERP_TOKEN),
          supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          admin: Boolean(env.ADMIN_TOKEN),
        },
      })
    }

    if (!url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Não encontrado.' }, 404)

    try {
      // Login por e-mail e senha (Supabase Auth). Só perfis admin ativos recebem a sessão.
      if (route === 'POST /api/auth/login' || route === 'POST /api/auth/refresh') {
        const b = await body(req)
        const login = route === 'POST /api/auth/login'
        if (login && (typeof b.email !== 'string' || typeof b.password !== 'string' || !b.email || !b.password)) throw new BadRequest('Informe {"email", "password"}.')
        if (!login && (typeof b.refresh_token !== 'string' || !b.refresh_token)) throw new BadRequest('Informe {"refresh_token"}.')
        const db = new Supabase(env)
        let session
        try {
          session = login
            ? await db.passwordLogin((b.email as string).trim(), b.password as string)
            : await db.refreshSession(b.refresh_token as string)
        } catch (e) {
          if (!(e instanceof AuthError)) throw e
          const motivo = e.code === 'invalid_credentials' ? 'E-mail ou senha inválidos.'
            : e.code === 'email_not_confirmed' ? 'E-mail não confirmado no Supabase Auth.'
              : `Supabase Auth recusou (${e.status}${e.code ? ` ${e.code}` : ''}): ${e.message}`
          return json({ ok: false, error: motivo, code: e.code || null }, e.status >= 500 ? 502 : 401)
        }
        if (!session?.user) return json({ ok: false, error: 'Sessão não retornada pelo Supabase.' }, 401)
        if (!(await isAdmin(db, session.user.id))) return json({ ok: false, error: 'Usuário sem perfil admin ativo.' }, 403)
        return json({ ok: true, access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, user: session.user })
      }

      const auth = await authorize(req, env)
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

      // Dados do site.
      if (req.method === 'GET' && url.pathname.startsWith('/api/dash/')) {
        try { return json(await dash(url.pathname.slice('/api/dash/'.length), url.searchParams, new Supabase(env))) }
        catch (e) { if (e instanceof DashError) throw new BadRequest(e.message); throw e }
      }
      if (route === 'POST /api/dash/secoes') {
        try { return json(await salvarSecao(new Supabase(env), await body(req))) }
        catch (e) { if (e instanceof DashError) throw new BadRequest(e.message); throw e }
      }

      switch (route) {
        case 'GET /api/auth/me':
          return json({ ok: true, user: auth.who })

        // Testa autenticação e mostra o formato real da resposta do ERP.
        case 'POST /api/erp/test': {
          const erp = new ErpClient(env)
          const page = await erp.page(buildCount(DATASET_BY_NAME.get('mercadoria')!), 0, 1)
          return json({ ok: true, status: page.status, shape: page.shape, sample: page.rows.slice(0, 1) })
        }

        // Confere, tabela por tabela, se todas as colunas esperadas existem no ERP e convertem para o tipo do espelho.
        // Corpo opcional {"datasets": [...]}; as 22 tabelas levam ~70 s (limite do ERP: 20 req/min).
        case 'POST /api/erp/schema-check': {
          const tables = uniqueTables(pickDatasets(await body(req), DATASETS.filter(d => d.kind !== 'recent')))
          const erp = new ErpClient(env)
          const { utcOffset } = syncOptions(env, { trigger: 'manual' })
          const result: Record<string, unknown> = {}
          for (const d of tables) {
            try {
              const { rows, shape } = await erp.page(buildSelect({ ...d, kind: 'snapshot' }, null, null), 0, 1)
              const missing = d.columns.filter(c => rows[0] && !shape.columns.map(x => x.toLowerCase()).includes(c))
              result[d.table] = rows.length
                ? { ok: missing.length === 0, missing, sample: convertRow(d, rows[0], utcOffset) }
                : { ok: true, empty: true }
            } catch (e) {
              if (e instanceof ErpError && (e.kind === 'auth' || e.kind === 'config')) throw e
              result[d.table] = { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
          }
          const ok = Object.values(result).every(r => (r as { ok: boolean }).ok)
          return json({ ok, requests: erp.requests, tables: result })
        }

        // Quantos registros cada tabela tem no ERP (para estimar a carga inicial).
        case 'POST /api/erp/counts': {
          const tables = uniqueTables(pickDatasets(await body(req), DATASETS))
          const erp = new ErpClient(env)
          const counts: Record<string, unknown> = {}
          for (const d of tables) {
            try {
              const { rows } = await erp.page(buildCount(d), 0, 1)
              const first = rows[0] ?? {}
              counts[d.table] = first.total ?? first.TOTAL ?? Object.values(first)[0] ?? null
            } catch (e) {
              if (e instanceof ErpError && (e.kind === 'auth' || e.kind === 'config')) throw e
              counts[d.table] = { error: e instanceof Error ? e.message : String(e) }
            }
          }
          return json({ ok: true, requests: erp.requests, counts })
        }

        // Confirma acesso ao Supabase e as migrações aplicadas.
        case 'GET /api/supabase/test': {
          const db = new Supabase(env)
          const [settings] = await db.select('sync_settings', 'id=eq.1&select=auto_enabled,recent_days')
          const runs = await db.select('sync_runs', 'select=id,started_at,status&order=started_at.desc&limit=1')
          return json({ ok: true, settings: settings ?? null, last_run: runs[0] ?? null })
        }

        // Estado de cada job e últimas execuções.
        case 'GET /api/sync/status': {
          const db = new Supabase(env)
          const [settings, states, runs] = await Promise.all([
            db.select('sync_settings', 'id=eq.1&select=auto_enabled,recent_days,updated_at'),
            db.select<{ dataset: string }>('sync_state', 'select=*'),
            db.select('sync_runs', 'select=id,mode,status,started_at,finished_at,rows_written,erp_requests,error&order=started_at.desc&limit=10'),
          ])
          const byName = new Map(states.map(s => [s.dataset, s as { dataset: string; last_error?: string | null }]))
          // Erro de registro: separa a mensagem do detalhe e monta o "o que corrigir" com item, lote e documento.
          const jobs = await Promise.all(DATASETS.map(async d => {
            const st = byName.get(d.name)
            const { mensagem, info } = lerErro(st?.last_error)
            const diagnostico = info ? await diagnosticar(info, mensagem, db).catch(() => null) : null
            return { dataset: d.name, kind: d.kind, refresh_minutes: d.refreshMinutes, description: d.description, state: st ? { ...st, last_error: st.last_error ? mensagem : null } : null, diagnostico }
          }))
          // Avisos: valores impossíveis que não pararam a leitura (tabela sync_avisos; sem ela, os das últimas execuções).
          type AvisoRow = { chave: string; tabela: string; coluna: string; valor: string; motivo: string; acao: 'em_branco' | 'ignorado'; registro: Record<string, unknown>; dataset: string | null; primeira_vez?: string; ultima_vez?: string }
          let abertos: AvisoRow[] = [], totalAvisos = 0, tabelaAvisos = true
          try {
            const pg = await db.selectPage<AvisoRow>('sync_avisos', 'resolvido_em=is.null&select=*&order=ultima_vez.desc', 30, 0)
            abertos = pg.rows; totalAvisos = pg.total
          } catch {
            tabelaAvisos = false
            const det = await db.select<{ details: { jobs?: { avisos_nao_gravados?: AvisoRow[] }[] } | null }>('sync_runs', 'select=details&order=started_at.desc&limit=30').catch(() => [])
            abertos = [...new Map(det.flatMap(r => (r.details?.jobs ?? []).flatMap(j => j.avisos_nao_gravados ?? [])).map(a => [a.chave, a])).values()].slice(0, 30)
            totalAvisos = abertos.length
          }
          const avisos = abertos.length ? (await diagnosticarVarios(abertos.map(a => ({ chave: a.chave, acao: a.acao, info: a })), db).catch(() => []))
            .map((dg, i) => ({ ...dg, dataset: abertos[i].dataset, primeira_vez: abertos[i].primeira_vez ?? null, ultima_vez: abertos[i].ultima_vez ?? null })) : []
          return json({
            ok: true,
            settings: settings[0] ?? null,
            avisos, total_avisos: totalAvisos, tabela_avisos: tabelaAvisos,
            jobs,
            runs,
          })
        }

        // Marca avisos de leitura como resolvidos (corrigidos no ERP ou aceitos). Corpo {"chave": "..."} ou {"todos": true}.
        case 'POST /api/sync/avisos/resolver': {
          const b = await body(req)
          const db = new Supabase(env)
          const agora = new Date().toISOString()
          if (b.todos === true) await db.patch('sync_avisos', 'resolvido_em=is.null', { resolvido_em: agora })
          else if (typeof b.chave === 'string' && b.chave.length <= 500) await db.patch('sync_avisos', `chave=eq.${encodeURIComponent(b.chave)}`, { resolvido_em: agora })
          else throw new BadRequest('Informe {"chave": "..."} ou {"todos": true}.')
          return json({ ok: true, message: b.todos ? 'Todos os avisos foram marcados como resolvidos.' : 'Aviso marcado como resolvido.' })
        }

        // Executa agora (respeita a trava e o orçamento). Corpo opcional {"datasets": [...]} força esses jobs.
        case 'POST /api/sync/run': {
          const b = await body(req)
          const only = b.datasets === undefined ? undefined : pickDatasets(b, []).map(d => d.name)
          const result = await runSync(
            { erp: new ErpClient(env), store: new PostgrestStore(new Supabase(env)) },
            syncOptions(env, { trigger: 'manual', only }),
          )
          return json({ ok: result.status === 'ok' || result.status === 'skipped', ...result }, result.status === 'error' ? 502 : 200)
        }

        // Liga/desliga a sincronização automática, ajusta a janela de releitura e habilita/desabilita jobs.
        // {"auto_enabled": true, "recent_days": 7, "jobs": {"mercadoria_estoque_historico": false}}
        case 'POST /api/sync/settings': {
          const b = await body(req)
          const patch: Record<string, unknown> = {}
          if (b.auto_enabled !== undefined) {
            if (typeof b.auto_enabled !== 'boolean') throw new BadRequest('"auto_enabled" precisa ser true ou false.')
            patch.auto_enabled = b.auto_enabled
          }
          if (b.recent_days !== undefined) {
            if (!Number.isInteger(b.recent_days) || (b.recent_days as number) < 1 || (b.recent_days as number) > 60) throw new BadRequest('"recent_days" precisa ser inteiro entre 1 e 60.')
            patch.recent_days = b.recent_days
          }
          let entries: [string, unknown][] = []
          if (b.jobs !== undefined) {
            if (!b.jobs || typeof b.jobs !== 'object' || Array.isArray(b.jobs)) throw new BadRequest('"jobs" precisa ser um objeto {nome: true/false}.')
            entries = Object.entries(b.jobs as Record<string, unknown>)
            for (const [name, on] of entries) {
              if (!DATASET_BY_NAME.has(name)) throw new BadRequest(`Dataset desconhecido: ${name}`)
              if (typeof on !== 'boolean') throw new BadRequest(`"jobs.${name}" precisa ser true ou false.`)
            }
          }
          const db = new Supabase(env)
          if (entries.length) await db.upsert('sync_state', entries.map(([dataset, enabled]) => ({ dataset, enabled, kind: DATASET_BY_NAME.get(dataset)!.kind })), 'dataset')
          if (Object.keys(patch).length) await db.patch('sync_settings', 'id=eq.1', { ...patch, updated_at: new Date().toISOString() })
          const [settings] = await db.select('sync_settings', 'id=eq.1&select=auto_enabled,recent_days,updated_at')
          return json({ ok: true, settings })
        }

        // Recomeça um job do zero (ex.: depois de corrigir um erro de dados). {"datasets": ["documento"]}
        case 'POST /api/sync/reset': {
          const list = pickDatasets(await body(req), [])
          if (!list.length) throw new BadRequest('Informe {"datasets": [...]}.')
          const db = new Supabase(env)
          await db.upsert('sync_state', list.map(d => ({ dataset: d.name, kind: d.kind, cursor: null, window_from: null, cycle_started_at: null, last_completed_at: null, status: 'idle', last_error: null, rows_cycle: 0 })), 'dataset')
          return json({ ok: true, reset: list.map(d => d.name) })
        }
      }
      return json({ ok: false, error: 'Rota não encontrada.' }, 404)
    } catch (e) {
      return errorResponse(e)
    }
  },

  // A cada 5 minutos. Não faz nada sem os Secrets ou com a sincronização automática desligada.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!configured(env)) return
    ctx.waitUntil(
      runSync({ erp: new ErpClient(env), store: new PostgrestStore(new Supabase(env)) }, syncOptions(env, { trigger: 'cron' }))
        .then(r => { if (r.status === 'error' || r.status === 'partial') console.error('sync', r.status, r.message) })
        .catch(e => console.error('sync falhou', e)),
    )
  },
} satisfies ExportedHandler<Env>
