import { SUBABAS_SETORES } from '../nav'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useApi } from '../api'
import { brl, brlCurto, mes, pct } from '../format'
import { SETORES, SETOR_COR } from '../labels'
import { Shapes } from 'lucide-react'
import { Empty, ErrorState, Loading, PageHead } from '../ui'

type Linha = { mes: string; setor: string; faturamento: number | string; lucro: number | string | null; margem_pct: number | string | null; qtd: number | string; vendas: number; crescimento_pct: number | string | null }
type Secao = { idsecao: number; descricao: string | null; setor: string | null }

const ORDEM = [...SETORES, 'Não classificado']

function Classificacao({ secoes, error, reload, onSaved }: { secoes: Secao[] | null; error: string | null; reload: () => void; onSaved: () => void }) {
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
      {erro && <div className="notice error" role="alert">{erro}</div>}
      <div className="table-wrap cards-sm">
        <table>
          <thead><tr><th>Seção no ERP</th><th>Setor na gestão</th></tr></thead>
          <tbody>
            {secoes.map(s => (
              <tr key={s.idsecao}>
                <td className="wrap"><span className="title">{s.descricao || `Seção ${s.idsecao}`}</span></td>
                <td data-label="Setor">
                  <select className="select" value={s.setor ?? ''} disabled={salvando === s.idsecao} onChange={e => salvar(s.idsecao, e.target.value)} aria-label={`Setor da seção ${s.descricao ?? s.idsecao}`}>
                    <option value="">Não classificado</option>
                    {SETORES.map(x => <option key={x}>{x}</option>)}
                  </select>
                  {salvando === s.idsecao && <span className="muted" style={{ marginLeft: 8 }}>Salvando…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Subabas de Setores (no celular aparecem no topo; no computador ficam no menu lateral). */
export { SUBABAS_SETORES }
export function SetoresTabs() {
  return <nav className="sub-tabs" aria-label="Subabas de Setores">{SUBABAS_SETORES.map(s => <NavLink key={s.to} to={s.to} end={s.end}>{s.label}</NavLink>)}</nav>
}

/** Seções do ERP: setor usado quando o NCM do produto não tem regra. */
export function SetoresSecoes() {
  const sec = useApi<Secao[]>('dash/secoes')
  const semSetor = sec.data?.filter(s => !s.setor).length ?? 0
  return (
    <>
      <SetoresTabs />
      <PageHead section="SETORES / SEÇÕES DO ERP" title="Seções do ERP">
        Setor usado para os produtos cujo NCM não tem regra em "Regras por NCM". A regra do NCM sempre vence a da seção.
      </PageHead>
      {semSetor > 0 && <p className="hint">{semSetor === 1 ? '1 seção está sem setor.' : `${semSetor} seções estão sem setor.`} Produtos dessas seções com NCM ficam em "Diversos"; sem NCM, em "Não classificado".</p>}
      <Classificacao secoes={sec.data} error={sec.error} reload={sec.reload} onSaved={() => undefined} />
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
      <SetoresTabs />
      <PageHead section="SETORES / COMPARATIVO" title="Setores">
        Alimentação, Farmácia e Diversos comparados mês a mês. O setor de cada produto vem do NCM (veja "Regras por NCM"); sem regra para o NCM, vale a seção do ERP.
      </PageHead>
      <div className="notice info" role="status">
        <Shapes size={18} aria-hidden />
        <div>Para ver os produtos por grupo (capítulo do NCM), subgrupo (posição) e NCM, abra <NavLink to="/setores/categorias">Categorias (NCM)</NavLink>. Para mudar em que setor cada NCM entra, use <NavLink to="/setores/regras">Regras por NCM</NavLink>.</div>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !linhas ? <Loading /> : linhas.length === 0 ? <Empty>Ainda não há vendas carregadas.</Empty> : (
        <>
          <section className="panel" aria-labelledby="g-h">
            <h2 id="g-h">Faturamento por setor e mês</h2>
            <div style={{ height: 260, marginTop: 8 }}>
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
            <div className="table-wrap cards-sm">
              <table>
                <thead><tr><th>Setor</th><th className="r">Faturamento</th><th className="r">Lucro bruto</th><th className="r">Margem</th><th className="r">Vendas</th><th className="r">vs. mês anterior</th></tr></thead>
                <tbody>
                  {setores.map(s => { const l = linhas.find(x => x.mes === ultimo && x.setor === s); const c = l?.crescimento_pct === null || l?.crescimento_pct === undefined ? null : Number(l.crescimento_pct); return (
                    <tr key={s}>
                      <td><span className="tag"><i style={{ background: SETOR_COR[s] }} aria-hidden />{s}</span></td>
                      <td className="r money" data-label="Faturamento">{brl(l?.faturamento ?? 0)}</td><td className="r" data-label="Lucro bruto">{brl(l?.lucro)}</td><td className="r" data-label="Margem">{pct(l?.margem_pct)}</td><td className="r" data-label="Vendas">{l?.vendas ?? 0}</td>
                      <td className="r" data-label="vs. mês anterior">{c === null ? '—' : <span className={c >= 0 ? 'up' : 'down'}>{c >= 0 ? '▲' : '▼'} {pct(c)}</span>}</td>
                    </tr>) })}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>O mês corrente ainda está em andamento: compare com cautela.</p>
          </section>
        </>
      )}
    </>
  )
}
