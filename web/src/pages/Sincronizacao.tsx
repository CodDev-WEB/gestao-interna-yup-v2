import { useState } from 'react'
import { api, useApi } from '../api'
import { haQuanto, int } from '../format'
import { ErrorState, Loading } from '../ui'

type Job = { dataset: string; kind: string; refresh_minutes: number; description: string; state: { status: string; rows_total: number | string; rows_cycle: number | string; last_synced_at: string | null; last_completed_at: string | null; last_error: string | null; enabled: boolean; cycle_started_at: string | null } | null }
type Run = { id: number; mode: string; status: string; started_at: string; finished_at: string | null; rows_written: number; erp_requests: number; error: string | null }
type Status = { settings: { auto_enabled: boolean; recent_days: number; updated_at: string } | null; jobs: Job[]; runs: Run[] }

const intervalo = (m: number) => m < 60 ? `a cada ${m} min` : m < 1440 ? `a cada ${m / 60} h` : 'diário'
const statusTxt = (j: Job) => {
  const s = j.state
  if (!s) return <span>Aguardando 1ª execução</span>
  if (!s.enabled) return <span>Desligado</span>
  if (s.status === 'error') return <span className="status-bad">⚠ Erro</span>
  if (s.cycle_started_at) return <span className="status-warn">↻ Carregando</span>
  return <span className="status-good">✓ Em dia</span>
}

export default function Sincronizacao() {
  const { data: st, error, reload } = useApi<Status>('sync/status')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const acao = async (nome: string, fn: () => Promise<{ message?: string }>) => {
    setOcupado(nome); setMsg(null)
    try { const r = await fn(); setMsg(r.message ?? 'Feito.'); reload() } catch (e) { setMsg(e instanceof Error ? e.message : 'Falhou.') } finally { setOcupado(null) }
  }

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!st) return <Loading rows={8} />
  const auto = st.settings?.auto_enabled ?? false
  const total = st.jobs.reduce((a, j) => a + Number(j.state?.rows_total ?? 0), 0)

  return (
    <>
      <div className="page-head">
        <div><h1>Sincronização com o ERP</h1><p>O site lê uma cópia dos dados do Santarém Sistemas. A cópia é atualizada automaticamente a cada 5 minutos, respeitando o limite de 20 consultas por minuto do ERP.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={!!ocupado} onClick={() => acao('run', () => api('sync/run', { method: 'POST' }))}>{ocupado === 'run' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
          <button className="btn" disabled={!!ocupado} onClick={() => acao('auto', async () => { await api('sync/settings', { method: 'POST', body: JSON.stringify({ auto_enabled: !auto }) }); return { message: auto ? 'Atualização automática desligada.' : 'Atualização automática ligada.' } })}>
            {auto ? 'Desligar automático' : 'Ligar automático'}
          </button>
        </div>
      </div>
      {msg && <div className="notice" role="status">{msg}</div>}
      <div className="kpis" style={{ marginBottom: 18 }}>
        <div className="panel kpi"><h3>Atualização automática</h3><div className={`v ${auto ? 'status-good' : 'status-bad'}`}>{auto ? 'Ligada' : 'Desligada'}</div></div>
        <div className="panel kpi"><h3>Registros copiados</h3><div className="v">{int(total)}</div></div>
        <div className="panel kpi"><h3>Carregando agora</h3><div className="v">{st.jobs.filter(j => j.state?.cycle_started_at).length}</div><div className="d">conjuntos de dados</div></div>
        <div className="panel kpi"><h3>Com erro</h3><div className={`v ${st.jobs.some(j => j.state?.status === 'error') ? 'status-bad' : ''}`}>{st.jobs.filter(j => j.state?.status === 'error').length}</div></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dados</th><th>Situação</th><th className="r">Registros</th><th>Atualização</th><th>Última leitura</th></tr></thead>
          <tbody>
            {st.jobs.map(j => (
              <tr key={j.dataset}>
                <td className="wrap">{j.description}{j.state?.last_error && <><br /><small className="status-bad" style={{ fontWeight: 400 }}>{j.state.last_error}</small></>}</td>
                <td>{statusTxt(j)}</td>
                <td className="r">{int(j.state?.rows_total ?? 0)}</td>
                <td>{intervalo(j.refresh_minutes)}</td>
                <td>{haQuanto(j.state?.last_synced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="section">
        <h2>Últimas execuções</h2>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Quando</th><th>Origem</th><th>Resultado</th><th className="r">Registros</th><th className="r">Consultas ao ERP</th></tr></thead>
            <tbody>
              {st.runs.map(r => (
                <tr key={r.id}>
                  <td>{haQuanto(r.started_at)}</td>
                  <td>{r.mode === 'cron' ? 'Automática' : 'Manual'}</td>
                  <td>{r.status === 'ok' ? <span className="status-good">✓ Ok</span> : r.status === 'skipped' ? 'Pulada' : <span className="status-bad" title={r.error ?? ''}>⚠ {r.status === 'partial' ? 'Parcial' : 'Erro'}</span>}</td>
                  <td className="r">{int(r.rows_written)}</td>
                  <td className="r">{int(r.erp_requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
