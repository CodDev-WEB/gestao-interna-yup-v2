import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Hourglass, Percent, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { useApi } from '../api'
import { brl, brl0, brlCurto, dataCurta, data as fmtData, haQuanto, int, pct, variacao } from '../format'
import { SITUACOES } from '../labels'
import { ErrorState, Loading, Metric, PageHead, Tabs, useParam } from '../ui'

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

const PERIODOS = [{ id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: '90', label: '90 dias' }, { id: '365', label: '12 meses' }]

function Delta({ atual, anterior, pontos, semVendas }: { atual: number | null; anterior: number | null; pontos?: boolean; semVendas: boolean }) {
  if (semVendas) return <>aguardando vendas do ERP</>
  if (atual === null || anterior === null) return <>sem base de comparação</>
  const v = pontos ? atual - anterior : variacao(atual, anterior)
  if (v === null) return <>sem base de comparação</>
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : ''
  const txt = pontos ? `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.` : `${v > 0 ? '+' : ''}${pct(v)}`
  return <><span className={cls}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {txt}</span> vs. período anterior</>
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
  const qtdLotesRisco = r.lotes.reduce((a, l) => a + Number(l.lotes_em_risco ?? 0), 0)

  const a = r.atual, b = r.anterior
  // Sem nenhuma venda carregada, a situação dos produtos (parado, saudável...) e os indicadores não significam nada ainda.
  const semVendas = a.vendas === 0 && b.vendas === 0
  const paradoOuExcesso = valorDe('parado') + valorDe('sem_saida_historica') + valorDe('excesso_estoque')

  // Pontos a atacar: primeiro o que tem valor em reais, do maior para o menor; depois as contagens.
  const pontos = [
    { t: 'Capital parado em produtos sem venda', v: semVendas ? 0 : valorDe('parado') + valorDe('sem_saida_historica'), m: `${int(qtdDe('parado') + qtdDe('sem_saida_historica'))} produtos parados há mais de 90 dias ou que nunca venderam. Suspender recompra e avaliar promoção.`, to: '/produtos?situacao=parado', sev: 'alta', reais: true },
    { t: 'Excesso de estoque', v: semVendas ? 0 : valorDe('excesso_estoque'), m: `${int(qtdDe('excesso_estoque'))} produtos com estoque para mais de 120 dias. Reduzir pedidos até normalizar.`, to: '/produtos?situacao=excesso_estoque', sev: 'media', reais: true },
    { t: 'Lotes que não vendem antes de vencer', v: lotesRisco, m: `${int(qtdLotesRisco)} ${qtdLotesRisco === 1 ? 'lote não vende' : 'lotes não vendem'} antes da validade no ritmo atual. Priorizar a saída dos mais antigos.`, to: '/validades?risco=1', sev: 'alta', reais: true },
    { t: 'Produtos em ruptura', v: qtdDe('ruptura'), m: 'Venderam nos últimos 30 dias e estão zerados: venda perdida. Programar reposição.', to: '/produtos?situacao=ruptura', sev: 'alta', reais: false },
    { t: 'Custos com aumento de 10% ou mais', v: r.contagens.fornecedores_aumento_10pct, m: 'Itens cuja última compra saiu 10% mais cara que a anterior. Negociar ou cotar alternativa.', to: '/fornecedores?min=10', sev: 'media', reais: false },
    { t: 'Clientes em risco', v: r.contagens.clientes_em_risco, m: 'Passaram do dobro do intervalo habitual sem comprar. Campanha de retorno.', to: '/clientes?segmento=em_risco', sev: 'media', reais: false },
    { t: 'Produtos em declínio', v: r.contagens.produtos_em_declinio, m: 'Vendas caindo há 3 meses seguidos, com estoque. Revisar preço e exposição.', to: '/produtos?aba=declinio', sev: 'media', reais: false },
  ].filter(p => p.v > 0)
  const ordenados = [...pontos.filter(p => p.reais).sort((x, y) => y.v - x.v), ...pontos.filter(p => !p.reais).sort((x, y) => y.v - x.v)]

  return (
    <>
      <PageHead section="VISÃO GERAL" title="Onde está o dinheiro da Yup"
        actions={<Tabs label="Período" value={dias} options={PERIODOS} onChange={setDias} />}>
        Estoque, vendas e pontos que pedem ação. Dados do ERP {r.sync.ultima_atualizacao ? `atualizados ${haQuanto(r.sync.ultima_atualizacao)}` : 'ainda em carga'}.
      </PageHead>

      {(semVendas || r.sync.com_erro > 0) && (
        <div className={`notice ${semVendas ? '' : 'error'}`} role="status">
          <AlertTriangle size={18} aria-hidden />
          <div>
            {semVendas
              ? <><strong>Carga inicial em andamento.</strong> As vendas ainda estão sendo copiadas do ERP; até lá, a situação dos produtos e os indicadores de venda ficam incompletos.</>
              : <strong>Atenção na sincronização.</strong>}
            {r.sync.com_erro > 0 && <> {r.sync.com_erro === 1 ? 'Um conjunto de dados teve erro' : `${r.sync.com_erro} conjuntos de dados tiveram erro`} na última leitura.</>}
            {' '}<Link to="/sincronizacao">Ver andamento</Link>
          </div>
        </div>
      )}

      <section className="panel capital" aria-labelledby="cap-h">
        <div className="capital-head">
          <div>
            <span className="eyebrow" id="cap-h">Capital em estoque, a custo</span>
            <div className="capital-total">{totalCapital > 0 ? brl0(totalCapital) : '—'}</div>
          </div>
          {totalCapital > 0 && !semVendas && <div className="capital-sub"><b>{pct(paradoOuExcesso / totalCapital * 100)}</b> está parado ou em excesso</div>}
        </div>
        {totalCapital === 0 ? (
          <div className="capital-wait"><Hourglass size={18} aria-hidden />O valor aparece quando os saldos e custos do ERP forem carregados.</div>
        ) : semVendas ? (
          <div className="capital-wait"><Hourglass size={18} aria-hidden /><span>A divisão do estoque entre <strong>saudável, parado, excesso e ruptura</strong> depende do histórico de vendas, que ainda está chegando do ERP. O total acima já está correto.</span></div>
        ) : (
          <>
            <div className="capital-bar">
              {capital.filter(c => c.valor > 0).map(c => {
                const w = c.valor / totalCapital * 100
                return (
                  <Link key={c.id} to={`/produtos?situacao=${c.id}`} title={`${c.nome}: ${brl(c.valor)} (${pct(w)}) em ${int(c.produtos)} produtos`}
                    aria-label={`${c.nome}: ${brl(c.valor)}, ${pct(w)} do estoque`} style={{ flex: `${w} 0 0`, background: c.cor }}>
                    {w > 12 && <span aria-hidden style={{ color: c.texto }}>{pct(w, 0)}</span>}
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
          </>
        )}
      </section>

      <section className="section" aria-label="Indicadores do período">
        <div className="metrics">
          <Metric icon={<Wallet size={18} />} tone="gold" label="Faturamento líquido" value={semVendas ? '—' : brlCurto(a.faturamento)} detail={<Delta atual={a.faturamento} anterior={b.faturamento} semVendas={semVendas} />} />
          <Metric icon={<TrendingUp size={18} />} tone="green" label="Lucro bruto" value={semVendas ? '—' : brlCurto(a.lucro)} detail={<Delta atual={a.lucro} anterior={b.lucro} semVendas={semVendas} />} />
          <Metric icon={<Percent size={18} />} tone="blue" label="Margem bruta" value={pct(a.margem)} detail={<Delta atual={a.margem} anterior={b.margem} pontos semVendas={semVendas} />} />
          <Metric icon={<Receipt size={18} />} tone="purple" label="Ticket médio" value={brl(a.ticket)} detail={<Delta atual={a.ticket} anterior={b.ticket} semVendas={semVendas} />} />
        </div>
        {a.sem_custo > 0 && <p className="hint" style={{ marginTop: 10 }}>{int(a.sem_custo)} itens vendidos no período não têm custo no ERP e ficam fora do lucro.</p>}
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="atk-h">
          <div className="section-head"><div><span className="eyebrow">Prioridades</span><h2 id="atk-h">Pontos a atacar</h2></div></div>
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
          <p>{fmtData(r.periodo.inicio)} a {fmtData(r.periodo.fim)} · {int(a.vendas)} vendas · {brl(a.devolucoes)} em devoluções</p>
          {r.serie.every(d => d.faturamento === 0) ? <div className="state">{semVendas ? 'As vendas aparecem aqui assim que a carga do ERP chegar nelas.' : 'Nenhuma venda neste período.'}</div> : <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={r.serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--line-2)' }} tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.data))}</strong>{brl(Number(payload[0].payload.faturamento))}<br />{int(payload[0].payload.vendas)} vendas · lucro {brl(Number(payload[0].payload.lucro))}</div>
                ) : null} />
                <Area type="monotone" dataKey="faturamento" stroke="var(--turquoise)" strokeWidth={2} fill="var(--turquoise)" fillOpacity={0.14} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>}
        </section>
      </div>
      {loading && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}
