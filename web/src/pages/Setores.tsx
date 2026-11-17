import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useApi } from '../api'
import { brl, brlCurto, mes, pct } from '../format'
import { SETORES, SETOR_COR } from '../labels'
import { Empty, ErrorState, Loading } from '../ui'

type Linha = { mes: string; setor: string; faturamento: number | string; lucro: number | string | null; margem_pct: number | string | null; qtd: number | string; vendas: number; crescimento_pct: number | string | null }
type Secao = { idsecao: number; descricao: string | null; setor: string | null }

const ORDEM = [...SETORES, 'Não classificado']

function Classificacao({ onSaved }: { onSaved: () => void }) {
  const { data: secoes, error, reload } = useApi<Secao[]>('dash/secoes')
  const [salvando, setSalvando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!secoes) return <Loading />
  if (!secoes.length) return <Empty>As seções do ERP ainda não foram carregadas.</Empty>
  const salvar = async (id: number, setor: string) => {
    setSalvando(id); setErro(null)
    try { await api('dash/secoes', { method: 'POST', body: JSON.stringify({ idsecao: id, setor: setor || null }) }); reload(); onSaved() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(null) }
  }
  return (
    <>
      {erro && <div className="state error" role="alert">{erro}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Seção no ERP</th><th>Setor na gestão</th></tr></thead>
          <tbody>
            {secoes.map(s => (
              <tr key={s.idsecao}>
                <td className="wrap">{s.descricao || `Seção ${s.idsecao}`}</td>
                <td>
                  <select className="select" value={s.setor ?? ''} disabled={salvando === s.idsecao} onChange={e => salvar(s.idsecao, e.target.value)} aria-label={`Setor da seção ${s.descricao ?? s.idsecao}`}>
                    <option value="">Não classificado</option>
                    {SETORES.map(x => <option key={x}>{x}</option>)}
                  </select>
                  {salvando === s.idsecao && <span style={{ marginLeft: 8, color: 'var(--ink-2)' }}>Salvando…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Setores() {
  const { data: linhas, error, reload } = useApi<Linha[]>('dash/setores')
  const setores = ORDEM.filter(s => linhas?.some(l => l.setor === s))
  const meses = [...new Set((linhas ?? []).map(l => l.mes))].sort()
  const grafico = meses.map(m => Object.fromEntries([['mes', m], ...setores.map(s => [s, Number(linhas!.find(l => l.mes === m && l.setor === s)?.faturamento ?? 0)])]))
  const ultimo = meses[meses.length - 1]

  return (
    <>
      <div className="page-head">
        <div><h1>Setores</h1><p>Alimentação, Farmácia e Diversos comparados mês a mês. O setor vem da seção do produto no ERP; classifique as seções no fim da página.</p></div>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !linhas ? <Loading /> : linhas.length === 0 ? <Empty>Ainda não há vendas carregadas.</Empty> : (
        <>
          <section className="panel" aria-labelledby="g-h">
            <h2 id="g-h">Faturamento por setor e mês</h2>
            <div style={{ height: 300, marginTop: 12 }}>
              <ResponsiveContainer>
                <BarChart data={grafico} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="mes" tickFormatter={mes} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--line-2)' }} tickLine={false} />
                  <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip cursor={{ fill: 'rgba(28,43,54,0.04)' }} content={({ active, payload, label }) => active && payload?.length ? (
                    <div className="chart-tip"><strong>{mes(String(label))}</strong>{payload.map(p => <div key={String(p.dataKey)}><i style={{ display: 'inline-block', width: 8, height: 8, background: String(p.color), marginRight: 6 }} />{String(p.dataKey)}: {brl(Number(p.value))}</div>)}</div>
                  ) : null} />
                  <Legend formatter={v => <span style={{ color: 'var(--ink-2)' }}>{v}</span>} iconType="square" />
                  {setores.map(s => <Bar key={s} dataKey={s} fill={SETOR_COR[s]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section" aria-labelledby="t-h">
            <h2 id="t-h">Último mês ({mes(ultimo)})</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Setor</th><th className="r">Faturamento</th><th className="r">Lucro bruto</th><th className="r">Margem</th><th className="r">Vendas</th><th className="r">vs. mês anterior</th></tr></thead>
                <tbody>
                  {setores.map(s => { const l = linhas.find(x => x.mes === ultimo && x.setor === s); const c = l?.crescimento_pct === null || l?.crescimento_pct === undefined ? null : Number(l.crescimento_pct); return (
                    <tr key={s}>
                      <td><span className="tag"><i style={{ background: SETOR_COR[s] }} aria-hidden />{s}</span></td>
                      <td className="r">{brl(l?.faturamento ?? 0)}</td><td className="r">{brl(l?.lucro)}</td><td className="r">{pct(l?.margem_pct)}</td><td className="r">{l?.vendas ?? 0}</td>
                      <td className="r">{c === null ? '—' : <span className={c >= 0 ? 'up' : 'down'}>{c >= 0 ? '▲' : '▼'} {pct(c)}</span>}</td>
                    </tr>) })}
                </tbody>
              </table>
            </div>
            <p style={{ color: 'var(--ink-2)', fontSize: '0.85rem' }}>O mês corrente ainda está em andamento: compare com cautela.</p>
          </section>
        </>
      )}
      <section className="section" aria-labelledby="c-h">
        <h2 id="c-h">Classificar seções</h2>
        <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>Escolha o setor de cada seção do ERP. A mudança vale na hora para todas as telas.</p>
        <Classificacao onSaved={reload} />
      </section>
    </>
  )
}
