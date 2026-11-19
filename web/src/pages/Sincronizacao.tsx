import { useState } from 'react'
import { api, useApi } from '../api'
import { haQuanto, int } from '../format'
import { AlertTriangle, CheckCircle2, Database, Info, Loader, MapPin, Power, RefreshCw, RotateCw, Wrench } from 'lucide-react'
import { ItemLink } from '../ProdutoPainel'
import { ErrorState, Loading, Metric, PageHead } from '../ui'

type Diagnostico = {
  titulo: string; campo: string; valor_recebido: string; problema: string; onde_corrigir: string; passos: string[]; impacto: string; tecnico: string
  item?: { id: number; nome: string | null; codigobarras: string | null; secao: string | null; setor: string | null; estoque: number | null }
  lote?: { lote: string; entrada: string | null; validade: string | null; local: string | null; saldo: number | null }
  documento?: { id: number; numero: string | null; modelo: string | null; data: string | null }
  pessoa?: { id: number; nome: string | null }
}
type Job = { dataset: string; kind: string; refresh_minutes: number; description: string; diagnostico: Diagnostico | null; state: { status: string; rows_total: number | string; rows_cycle: number | string; last_synced_at: string | null; last_completed_at: string | null; last_error: string | null; enabled: boolean; cycle_started_at: string | null } | null }
type Run = { id: number; mode: string; status: string; started_at: string; finished_at: string | null; rows_written: number; erp_requests: number; error: string | null }
type AvisoDiag = Diagnostico & { chave: string; acao: 'em_branco' | 'ignorado'; dataset: string | null; primeira_vez: string | null; ultima_vez: string | null }
type Status = { avisos?: AvisoDiag[]; total_avisos?: number; tabela_avisos?: boolean; settings: { auto_enabled: boolean; recent_days: number; updated_at: string } | null; jobs: Job[]; runs: Run[] }

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

/** Dados do registro (item, lote, documento) com o valor errado em destaque. */
function DadosRegistro({ d }: { d: Diagnostico }) {
  return (
    <dl className="kv fix-kv">
      <div><dt>Campo com erro</dt><dd>{d.campo}</dd></div>
      <div><dt>Valor no ERP</dt><dd className="status-bad">{d.valor_recebido}</dd></div>
      {d.item && <>
        <div><dt>Item</dt><dd><ItemLink id={d.item.id}>{d.item.nome ?? `Produto ${d.item.id}`}</ItemLink></dd></div>
        <div><dt>Código interno</dt><dd>{d.item.id}</dd></div>
        <div><dt>Código de barras</dt><dd>{d.item.codigobarras ?? '—'}</dd></div>
        <div><dt>Seção / setor</dt><dd>{d.item.secao ?? '—'} · {d.item.setor ?? '—'}</dd></div>
      </>}
      {d.lote && <>
        <div><dt>Lote</dt><dd>{d.lote.lote}</dd></div>
        {d.lote.entrada && <div><dt>Entrada do lote</dt><dd>{d.lote.entrada}</dd></div>}
        {d.lote.local && <div><dt>Local / saldo</dt><dd>{d.lote.local}{d.lote.saldo !== null ? ` · ${int(d.lote.saldo)} un.` : ''}</dd></div>}
      </>}
      {d.documento && <div><dt>Documento</dt><dd>{[d.documento.modelo && `modelo ${d.documento.modelo}`, d.documento.numero && `nº ${d.documento.numero}`].filter(Boolean).join(' ')}{d.documento.data ? ` · ${d.documento.data}` : ''}<small>código interno {d.documento.id}</small></dd></div>}
      {d.pessoa && <div><dt>Pessoa</dt><dd>{d.pessoa.nome ?? `código ${d.pessoa.id}`}</dd></div>}
    </dl>
  )
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
      {st.jobs.filter(j => j.diagnostico).length > 0 && (
        <section className="section" style={{ marginTop: 0, marginBottom: 24 }} aria-labelledby="corrigir-h">
          <div className="section-head"><div><span className="eyebrow">Leituras paradas</span><h2 id="corrigir-h">O que corrigir no ERP</h2></div></div>
          <div className="fix-list">
            {st.jobs.filter(j => j.diagnostico).map(j => {
              const d = j.diagnostico!
              return (
                <article key={j.dataset} className="fix">
                  <header className="fix-head">
                    <div className="fix-icon" aria-hidden><Wrench size={18} /></div>
                    <div>
                      <span className="eyebrow">{j.description}</span>
                      <h3>{d.titulo}</h3>
                      <p className="fix-problema">{d.problema}</p>
                    </div>
                    <button className="btn secondary" disabled={!!ocupado} onClick={() => acao(j.dataset, () => api('sync/run', { method: 'POST', body: JSON.stringify({ datasets: [j.dataset] }) }))}>
                      <RotateCw size={15} aria-hidden />{ocupado === j.dataset ? 'Lendo…' : 'Ler de novo'}
                    </button>
                  </header>
                  <DadosRegistro d={d} />
                  <div className="fix-onde"><MapPin size={16} aria-hidden /><div><strong>Onde ajustar:</strong> {d.onde_corrigir}</div></div>
                  <ol className="fix-passos">{d.passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  <p className="hint" style={{ margin: '10px 0 0' }}>{d.impacto}</p>
                  <details className="fix-tec"><summary>Mensagem técnica</summary><code>{d.tecnico}</code></details>
                </article>
              )
            })}
          </div>
        </section>
      )}
      {st.tabela_avisos === false && (st.avisos?.length ?? 0) > 0 && (
        <div className="notice"><Info size={18} aria-hidden /><div>Os avisos abaixo vêm só das últimas execuções. Para guardar todos e poder marcá-los como resolvidos, instale no Supabase a migração <code>20261119000000_sync_avisos.sql</code> (SQL Editor).</div></div>
      )}
      {(st.avisos?.length ?? 0) > 0 && (
        <section className="section" style={{ marginTop: 0, marginBottom: 24 }} aria-labelledby="avisos-h">
          <div className="section-head">
            <div><span className="eyebrow">A leitura continuou</span><h2 id="avisos-h">Avisos de dados para corrigir no ERP</h2>
              <p className="hint" style={{ margin: '4px 0 0' }}>{int(st.total_avisos ?? st.avisos!.length)} {st.total_avisos === 1 ? 'registro veio' : 'registros vieram'} com data impossível em campo secundário. A sincronização não parou: o campo ficou em branco, ou o registro não foi copiado quando a data faz parte da identificação dele.</p></div>
            {st.tabela_avisos !== false && <button className="btn secondary" disabled={!!ocupado} onClick={() => { if (window.confirm('Marcar todos os avisos como resolvidos?')) acao('todos', () => api('sync/avisos/resolver', { method: 'POST', body: JSON.stringify({ todos: true }) })) }}><CheckCircle2 size={15} aria-hidden />Marcar todos como resolvidos</button>}
          </div>
          <div className="fix-list">
            {st.avisos!.map(a => (
              <details key={a.chave} className="fix aviso">
                <summary>
                  <span className={`pill ${a.acao === 'ignorado' ? 'bad' : 'warn'}`}>{a.acao === 'ignorado' ? 'Não copiado' : 'Gravado em branco'}</span>
                  <span className="aviso-tit"><strong>{a.titulo}</strong><small>{a.campo}: <b className="status-bad">{a.valor_recebido}</b>{a.documento ? ` · documento ${a.documento.numero ? `nº ${a.documento.numero}` : `código ${a.documento.id}`}${a.documento.data ? ` de ${a.documento.data}` : ''}` : ''}{a.lote ? ` · lote ${a.lote.lote}` : ''}</small></span>
                </summary>
                <p className="fix-problema" style={{ margin: '12px 0' }}>{a.problema}</p>
                <DadosRegistro d={a} />
                <div className="fix-onde"><MapPin size={16} aria-hidden /><div><strong>Onde ajustar:</strong> {a.onde_corrigir}</div></div>
                <ol className="fix-passos">{a.passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
                <p className="hint" style={{ margin: '10px 0 0' }}>{a.impacto}</p>
                {st.tabela_avisos !== false && <button className="btn secondary" style={{ marginTop: 12 }} disabled={!!ocupado} onClick={() => acao(a.chave, () => api('sync/avisos/resolver', { method: 'POST', body: JSON.stringify({ chave: a.chave }) }))}><CheckCircle2 size={15} aria-hidden />{ocupado === a.chave ? 'Salvando…' : 'Marcar como resolvido'}</button>}
              </details>
            ))}
          </div>
          {(st.total_avisos ?? 0) > st.avisos!.length && <p className="hint" style={{ marginTop: 10 }}>Mostrando os {st.avisos!.length} mais recentes de {int(st.total_avisos)}.</p>}
        </section>
      )}
      <div className="table-wrap cards-sm">
        <table>
          <thead><tr><th>Dados</th><th>Situação</th><th className="r">Registros</th><th>Atualização</th><th>Última leitura</th></tr></thead>
          <tbody>
            {st.jobs.map(j => (
              <tr key={j.dataset}>
                <td className="wrap"><span className="title">{j.description}</span>{j.state?.last_error && <small className="status-bad" style={{ fontWeight: 500 }} title={j.state.last_error}>{j.diagnostico ? <a href="#corrigir-h">{j.diagnostico.titulo}: ver o que corrigir</a> : erroAmigavel(j.state.last_error)}</small>}</td>
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
