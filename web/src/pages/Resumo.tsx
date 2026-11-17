import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../api'
import { brl, brlCurto, dataCurta, data as fmtData, haQuanto, int, pct, variacao } from '../format'
import { SITUACOES, situacao } from '../labels'
import { ErrorState, Loading, useParam } from '../ui'

type Tot = { faturamento: number; lucro: number; vendas: number; devolucoes: number; sem_custo: number; margem: number | null; ticket: number | null }
type Resumo = {
  periodo: { inicio: string; fim: string; dias: number }
  atual: Tot; anterior: Tot
  serie: { data: string; faturamento: number; lucro: number; vendas: number }[]
  capital: { situacao: string; produtos: number; valor_estoque: number | string; unidades: number | string }[]
  lotes: { faixa: string; lotes: number; valor: number | string; lotes_em_risco: number; valor_em_risco: number | string | null }[]
  contagens: { fornecedores_aumento_10pct: number; clientes_em_risco: number; produtos_em_declinio: number }
  sync: { ultima_atualizacao: string | null; jobs: number; com_erro: number; em_andamento: number }
}

const PERIODOS = [{ d: '7', l: '7 dias' }, { d: '30', l: '30 dias' }, { d: '90', l: '90 dias' }, { d: '365', l: '12 meses' }]

function Delta({ atual, anterior, pontos }: { atual: number | null; anterior: number | null; pontos?: boolean }) {
  if (atual === null || anterior === null) return <div className="d">sem base de comparação</div>
  const v = pontos ? atual - anterior : variacao(atual, anterior)
  if (v === null) return <div className="d">sem base de comparação</div>
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : ''
  const txt = pontos ? `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.` : `${v > 0 ? '+' : ''}${pct(v)}`
  return <div className="d"><span className={cls}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {txt}</span> vs. período anterior</div>
}

export default function Resumo() {
  const [dias, setDias] = useParam('dias', '30')
  const { data: r, error, loading, reload } = useApi<Resumo>(`dash/resumo?dias=${dias}`)

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!r) return <Loading rows={8} />

  const capital = SITUACOES.map(s => ({ ...s, ...(r.capital.find(c => c.situacao === s.id) ?? { produtos: 0, valor_estoque: 0, unidades: 0 }) }))
    .map(c => ({ ...c, valor: Number(c.valor_estoque) }))
  const totalCapital = capital.reduce((a, c) => a + c.valor, 0)
  const valorDe = (id: string) => capital.find(c => c.id === id)?.valor ?? 0
  const qtdDe = (id: string) => capital.find(c => c.id === id)?.produtos ?? 0
  const lotesRisco = r.lotes.reduce((a, l) => a + Number(l.valor_em_risco ?? 0), 0)
  const lotesCriticos = r.lotes.filter(l => l.faixa === 'vencido' || l.faixa === 'critico_7d').reduce((a, l) => a + l.lotes, 0)

  // Pontos a atacar: primeiro o que tem valor em reais, do maior para o menor; depois as contagens.
  const pontos = [
    { t: 'Capital parado em produtos sem venda', v: valorDe('parado') + valorDe('sem_saida_historica'), m: `${int(qtdDe('parado') + qtdDe('sem_saida_historica'))} produtos parados há mais de 90 dias ou que nunca venderam. Suspender recompra e avaliar promoção.`, to: '/produtos?situacao=parado', sev: 'alta', reais: true },
    { t: 'Excesso de estoque', v: valorDe('excesso_estoque'), m: `${int(qtdDe('excesso_estoque'))} produtos com estoque para mais de 120 dias. Reduzir pedidos até normalizar.`, to: '/produtos?situacao=excesso_estoque', sev: 'media', reais: true },
    { t: 'Lotes que não vendem antes de vencer', v: lotesRisco, m: `${int(lotesCriticos)} lotes vencidos ou vencendo em 7 dias. Priorizar a saída dos lotes mais antigos.`, to: '/validades?risco=1', sev: 'alta', reais: true },
    { t: 'Produtos em ruptura', v: qtdDe('ruptura'), m: 'Venderam nos últimos 30 dias e estão zerados: venda perdida. Programar reposição.', to: '/produtos?situacao=ruptura', sev: 'alta', reais: false },
    { t: 'Custos com aumento de 10% ou mais', v: r.contagens.fornecedores_aumento_10pct, m: 'Itens cuja última compra saiu 10% mais cara que a anterior. Negociar ou cotar alternativa.', to: '/fornecedores?min=10', sev: 'media', reais: false },
    { t: 'Clientes em risco', v: r.contagens.clientes_em_risco, m: 'Passaram do dobro do intervalo habitual sem comprar. Campanha de retorno.', to: '/clientes?segmento=em_risco', sev: 'media', reais: false },
    { t: 'Produtos em declínio', v: r.contagens.produtos_em_declinio, m: 'Vendas caindo há 3 meses seguidos, com estoque. Revisar preço e exposição.', to: '/produtos?aba=declinio', sev: 'media', reais: false },
  ].filter(p => p.v > 0)
  const ordenados = [...pontos.filter(p => p.reais).sort((a, b) => b.v - a.v), ...pontos.filter(p => !p.reais).sort((a, b) => b.v - a.v)]

  const a = r.atual, b = r.anterior
  const semDados = totalCapital === 0 && a.vendas === 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Onde está o dinheiro da Yup</h1>
          <p>Estoque, vendas e pontos que pedem ação, com dados do ERP {r.sync.ultima_atualizacao ? `atualizados ${haQuanto(r.sync.ultima_atualizacao)}` : 'ainda em carga'}.</p>
        </div>
        <div className="seg" role="group" aria-label="Período">
          {PERIODOS.map(p => <button key={p.d} aria-pressed={dias === p.d} onClick={() => setDias(p.d)}>{p.l}</button>)}
        </div>
      </div>

      {(r.sync.em_andamento > 0 || semDados) && (
        <div className="notice">A primeira carga do ERP ainda está em andamento{r.sync.em_andamento > 0 ? ` (${r.sync.em_andamento} ${r.sync.em_andamento === 1 ? 'conjunto de dados carregando' : 'conjuntos de dados carregando'})` : ''}. Os números ficam completos quando ela terminar. <Link to="/sincronizacao">Ver andamento</Link></div>
      )}
      {r.sync.com_erro > 0 && <div className="notice">{r.sync.com_erro} conjunto(s) de dados com erro na última sincronização. <Link to="/sincronizacao">Ver detalhes</Link></div>}

      <section className="panel capital" aria-labelledby="cap-h">
        <div className="capital-head">
          <div>
            <h2 id="cap-h" style={{ fontSize: '1rem', fontFamily: 'var(--body)', fontWeight: 500, color: 'var(--ink-2)' }}>Capital em estoque, a custo</h2>
            <div className="capital-total">{totalCapital > 0 ? brl0(totalCapital) : '—'}</div>
          </div>
          {totalCapital > 0 && <div className="capital-sub">{pct((valorDe('parado') + valorDe('sem_saida_historica') + valorDe('excesso_estoque')) / totalCapital * 100)} está parado ou em excesso</div>}
        </div>
        {totalCapital === 0 && <p style={{ color: 'var(--ink-2)', margin: '12px 0' }}>O valor aparece quando saldos e custos do ERP forem carregados.</p>}
        <div className="capital-bar" hidden={totalCapital === 0}>
          {capital.filter(c => c.valor > 0).map(c => {
            const w = c.valor / totalCapital * 100
            return (
              <Link key={c.id} to={`/produtos?situacao=${c.id}`} title={`${c.nome}: ${brl(c.valor)} (${pct(w)}) em ${int(c.produtos)} produtos`}
                aria-label={`${c.nome}: ${brl(c.valor)}, ${pct(w)} do estoque`} style={{ flex: `${w} 0 0`, background: c.cor }}>
                {w > 12 && <span aria-hidden>{pct(w, 0)}</span>}
              </Link>
            )
          })}
        </div>
        <div className="legend">
          {capital.map(c => (
            <Link key={c.id} to={`/produtos?situacao=${c.id}`} title={c.desc}>
              <i style={{ background: c.cor }} aria-hidden /><strong>{c.nome}</strong>
              <small>{brlCurto(c.valor)} · {int(c.produtos)}</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" aria-label="Indicadores do período">
        <div className="kpis">
          <div className="panel kpi"><h3>Faturamento líquido</h3><div className="v">{brlCurto(a.faturamento)}</div><Delta atual={a.faturamento} anterior={b.faturamento} /></div>
          <div className="panel kpi"><h3>Lucro bruto</h3><div className="v">{brlCurto(a.lucro)}</div><Delta atual={a.lucro} anterior={b.lucro} /></div>
          <div className="panel kpi"><h3>Margem bruta</h3><div className="v">{pct(a.margem)}</div><Delta atual={a.margem} anterior={b.margem} pontos /></div>
          <div className="panel kpi"><h3>Ticket médio</h3><div className="v">{brl(a.ticket)}</div><Delta atual={a.ticket} anterior={b.ticket} /></div>
        </div>
        {a.sem_custo > 0 && <p style={{ color: 'var(--ink-2)', fontSize: '0.85rem', marginTop: 8 }}>{int(a.sem_custo)} itens vendidos no período não têm custo no ERP e ficam fora do lucro.</p>}
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="atk-h">
          <h2 id="atk-h" style={{ marginBottom: 12 }}>Pontos a atacar</h2>
          {ordenados.length === 0 ? <div className="panel state">Nenhum ponto crítico com os dados carregados até agora.</div> : (
            <div className="attack">
              {ordenados.map(p => (
                <Link key={p.t} to={p.to} className={`sev-${p.sev}`}>
                  <span className="t">{p.t}</span>
                  <span className="v">{p.reais ? brlCurto(p.v) : int(p.v)}</span>
                  <span className="m">{p.m}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="fat-h">
          <h2 id="fat-h">Faturamento por dia</h2>
          <p style={{ margin: '4px 0 12px', color: 'var(--ink-2)', fontSize: '0.875rem' }}>{fmtData(r.periodo.inicio)} a {fmtData(r.periodo.fim)} · {int(a.vendas)} vendas · {brl(a.devolucoes)} em devoluções</p>
          {r.serie.every(d => d.faturamento === 0) ? <div className="state">Nenhuma venda carregada neste período.</div> : <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={r.serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--line-2)' }} tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.data))}</strong>{brl(Number(payload[0].payload.faturamento))}<br />{int(payload[0].payload.vendas)} vendas · lucro {brl(Number(payload[0].payload.lucro))}</div>
                ) : null} />
                <Area type="monotone" dataKey="faturamento" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.12} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>}
        </section>
      </div>
      {loading && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}

function brl0(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) }
