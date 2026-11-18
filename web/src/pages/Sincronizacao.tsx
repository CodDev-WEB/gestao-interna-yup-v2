import { useState } from 'react'
import { api, useApi } from '../api'
import { haQuanto, int } from '../format'
import { AlertTriangle, Database, Loader, Power, RefreshCw } from 'lucide-react'
import { ErrorState, Loading, Metric, PageHead } from '../ui'

type Job = { dataset: string; kind: string; refresh_minutes: number; description: string; state: { status: string; rows_total: number | string; rows_cycle: number | string; last_synced_at: string | null; last_completed_at: string | null; last_error: string | null; enabled: boolean; cycle_started_at: string | null } | null }
type Run = { id: number; mode: string; status: string; started_at: string; finished_at: string | null; rows_written: number; erp_requests: number; error: string | null }
type Status = { settings: { auto_enabled: boolean; recent_days: number; updated_at: string } | null; jobs: Job[]; runs: Run[] }

const intervalo = (m: number) => m < 60 ? `a cada ${m} min` : m < 1440 ? `a cada ${m / 60} h` : 'diário'
const statusTxt = (j: Job) => {
  const s = j.state
  if (!s) return <span className="pill neutral">Aguardando 1ª leitura</span>
  if (!s.enabled) return <span className="pill neutral">Desligado</span>
  if (s.status === 'error') return <span className="pill bad">Erro</span>
  if (s.cycle_started_at) return <span className="pill warn">Carregando</span>
  return <span className="pill good">Em dia</span>
}

/** Traduz erros técnicos da leitura do ERP para uma orientação de quem usa o sistema. */
function erroAmigavel(msg: string) {
  const data = msg.match(/"(\d{4})-(\d{2})-(\d{2})[^"]*":\s*não é data/)
  if (data) return `O ERP tem um registro com data inválida (${data[3]}/${data[2]}/${data[1]}). Corrija o cadastro no ERP; os demais dados continuam sendo lidos.`
  if (/não é data|não é número|inválid/i.test(msg)) return 'O ERP enviou um valor em formato inesperado. Verifique o cadastro no ERP; os demais dados continuam sendo lidos.'
  if (/429|limite|rate/i.test(msg)) return 'O ERP pediu uma pausa (limite de consultas). A leitura continua sozinha na próxima rodada.'
  if (/401|403|token|autentica/i.test(msg)) return 'O ERP recusou o acesso. Confira o token do ERP no Cloudflare.'
  return msg
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
  const erros = st.jobs.filter(j => j.state?.status === 'error').length

  return (
    <>
      <PageHead section="SINCRONIZAÇÃO" title="Sincronização com o ERP"
        actions={<>
          <button className="btn" disabled={!!ocupado} onClick={() => acao('run', () => api('sync/run', { method: 'POST' }))}><RefreshCw size={16} aria-hidden />{ocupado === 'run' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
          <button className={`btn ${auto ? 'secondary' : ''}`} disabled={!!ocupado} onClick={() => {
            if (auto && !window.confirm('Desligar a atualização automática? Os dados do site param de ser atualizados até alguém ligar de novo.')) return
            acao('auto', async () => { await api('sync/settings', { method: 'POST', body: JSON.stringify({ auto_enabled: !auto }) }); return { message: auto ? 'Atualização automática desligada.' : 'Atualização automática ligada.' } })
          }}><Power size={16} aria-hidden />{auto ? 'Desligar automático' : 'Ligar automático'}</button>
        </>}>
        O site lê uma cópia dos dados do Santarém Sistemas, atualizada automaticamente a cada 5 minutos, respeitando o limite de 20 consultas por minuto do ERP.
      </PageHead>
      {msg && <div className="notice ok" role="status">{msg}</div>}
      <div className="metrics" style={{ marginBottom: 18 }}>
        <Metric icon={<Power size={18} />} tone={auto ? 'green' : 'red'} label="Atualização automática" value={auto ? 'Ligada' : 'Desligada'} valueClass={auto ? 'status-good' : 'status-bad'} detail="a cada 5 minutos" />
        <Metric icon={<Database size={18} />} tone="turquoise" label="Registros copiados" value={int(total)} detail="em todas as tabelas" />
        <Metric icon={<Loader size={18} />} tone="gold" label="Carregando agora" value={st.jobs.filter(j => j.state?.cycle_started_at).length} detail="conjuntos de dados" />
        <Metric icon={<AlertTriangle size={18} />} tone={erros > 0 ? 'red' : 'blue'} label="Com erro" value={erros} valueClass={erros > 0 ? 'status-bad' : ''} detail={erros > 0 ? 'veja o motivo na tabela' : 'nenhum'} />
      </div>
      <div className="table-wrap cards-sm">
        <table>
          <thead><tr><th>Dados</th><th>Situação</th><th className="r">Registros</th><th>Atualização</th><th>Última leitura</th></tr></thead>
          <tbody>
            {st.jobs.map(j => (
              <tr key={j.dataset}>
                <td className="wrap"><span className="title">{j.description}</span>{j.state?.last_error && <small className="status-bad" style={{ fontWeight: 500 }} title={j.state.last_error}>{erroAmigavel(j.state.last_error)}</small>}</td>
                <td data-label="Situação">{statusTxt(j)}</td>
                <td className="r" data-label="Registros">{int(j.state?.rows_total ?? 0)}</td>
                <td data-label="Atualização">{intervalo(j.refresh_minutes)}</td>
                <td data-label="Última leitura">{haQuanto(j.state?.last_synced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="section">
        <h2>Últimas execuções</h2>
        <div className="table-wrap cards-sm" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Quando</th><th>Origem</th><th>Resultado</th><th className="r">Registros</th><th className="r">Consultas ao ERP</th></tr></thead>
            <tbody>
              {st.runs.map(r => (
                <tr key={r.id}>
                  <td><span className="title">{haQuanto(r.started_at)}</span></td>
                  <td data-label="Origem">{r.mode === 'cron' ? 'Automática' : 'Manual'}</td>
                  <td data-label="Resultado">{r.status === 'ok' ? <span className="pill good">Ok</span> : r.status === 'skipped' ? <span className="pill neutral">Pulada</span> : <span className={`pill ${r.status === 'partial' ? 'warn' : 'bad'}`} title={r.error ? erroAmigavel(r.error) : ''}>{r.status === 'partial' ? 'Parcial' : 'Erro'}</span>}</td>
                  <td className="r" data-label="Registros">{int(r.rows_written)}</td>
                  <td className="r" data-label="Consultas ao ERP">{int(r.erp_requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
