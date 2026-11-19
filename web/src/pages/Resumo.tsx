import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, CircleDollarSign, PackageCheck, Percent, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
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

const PERIODOS = [{ id: '7', label: '7D' }, { id: '30', label: '30D' }, { id: '90', label: '90D' }, { id: '365', label: '12M' }]

function Delta({ atual, anterior, pontos, semVendas }: { atual: number | null; anterior: number | null; pontos?: boolean; semVendas: boolean }) {
  if (semVendas) return <>Aguardando dados</>
  if (atual === null || anterior === null) return <>Sem comparação</>
  const v = pontos ? atual - anterior : variacao(atual, anterior)
  if (v === null) return <>Sem comparação</>
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : ''
  const txt = pontos ? `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.` : `${v > 0 ? '+' : ''}${pct(v)}`
  return <><span className={cls}>{v > 0 ? '↗' : v < 0 ? '↘' : '•'} {txt}</span><small> vs. período anterior</small></>
}

export default function Resumo() {
  const [dias, setDias] = useParam('dias', '30')
  const { data: r, error, loading, reload } = useApi<Resumo>(`dash/resumo?dias=${dias}`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!r) return <Loading rows={8} />

  const capital = SITUACOES.map(s => ({ ...s, ...(r.capital.find(c => c.situacao === s.id) ?? { produtos: 0, valor_estoque: 0, unidades: 0 }) })).map(c => ({ ...c, valor: Number(c.valor_estoque) }))
  const totalCapital = capital.reduce((a, c) => a + c.valor, 0)
  const valorDe = (id: string) => capital.find(c => c.id === id)?.valor ?? 0
  const qtdDe = (id: string) => capital.find(c => c.id === id)?.produtos ?? 0
  const lotesRisco = r.lotes.reduce((a, l) => a + Number(l.valor_em_risco ?? 0), 0)
  const qtdLotesRisco = r.lotes.reduce((a, l) => a + Number(l.lotes_em_risco ?? 0), 0)
  const a = r.atual, b = r.anterior
  const semVendas = a.vendas === 0 && b.vendas === 0
  const paradoOuExcesso = valorDe('parado') + valorDe('sem_saida_historica') + valorDe('excesso_estoque')
  const mediaDiaria = r.periodo.dias ? a.faturamento / r.periodo.dias : 0

  const pontos = [
    { t: 'Capital parado sem venda', v: semVendas ? 0 : valorDe('parado') + valorDe('sem_saida_historica'), m: `${int(qtdDe('parado') + qtdDe('sem_saida_historica'))} produtos há mais de 90 dias sem saída`, to: '/produtos?situacao=parado', sev: 'alta', reais: true, acao: 'Revisar produtos' },
    { t: 'Excesso de estoque', v: semVendas ? 0 : valorDe('excesso_estoque'), m: `${int(qtdDe('excesso_estoque'))} produtos com cobertura acima de 120 dias`, to: '/produtos?situacao=excesso_estoque', sev: 'media', reais: true, acao: 'Analisar estoque' },
    { t: 'Validades próximas em risco', v: lotesRisco, m: `${int(qtdLotesRisco)} lotes não devem vender antes do vencimento`, to: '/validades?risco=1', sev: 'alta', reais: true, acao: 'Ver validades' },
    { t: 'Produtos em ruptura', v: qtdDe('ruptura'), m: 'Itens com venda recente e saldo zerado', to: '/produtos?situacao=ruptura', sev: 'alta', reais: false, acao: 'Repor estoque' },
    { t: 'Custos com aumento relevante', v: r.contagens.fornecedores_aumento_10pct, m: 'Última compra ficou pelo menos 10% mais cara', to: '/fornecedores?min=10', sev: 'media', reais: false, acao: 'Negociar custos' },
    { t: 'Clientes em risco', v: r.contagens.clientes_em_risco, m: 'Fora do intervalo habitual de recompra', to: '/clientes?segmento=em_risco', sev: 'media', reais: false, acao: 'Ativar clientes' },
  ].filter(p => p.v > 0)
  const ordenados = [...pontos.filter(p => p.reais).sort((x, y) => y.v - x.v), ...pontos.filter(p => !p.reais).sort((x, y) => y.v - x.v)].slice(0, 4)

  return <>
    <PageHead section="EXECUTIVE OVERVIEW" title="Pulso da operação" actions={<Tabs label="Período" value={dias} options={PERIODOS} onChange={setDias} />}>
      O que merece sua atenção agora. Dados do ERP {r.sync.ultima_atualizacao ? `atualizados ${haQuanto(r.sync.ultima_atualizacao)}` : 'ainda em carga'}.
    </PageHead>
    <div className={`health-strip ${r.sync.com_erro ? 'has-error' : ''}`}><span><i />{r.sync.com_erro ? 'Sincronização requer atenção' : 'Operação monitorada'}</span><p>{r.sync.com_erro ? `${r.sync.com_erro} conjunto(s) de dados apresentaram erro.` : 'Todos os sistemas estão sincronizados.'}</p><Link to="/sincronizacao">Ver status <ArrowRight size={13} /></Link></div>
    {(semVendas || r.sync.com_erro > 0) && <div className={`notice ${semVendas ? '' : 'error'}`} role="status"><AlertTriangle size={17} aria-hidden /><div>{semVendas ? <><strong>Carga inicial em andamento.</strong> Indicadores ainda incompletos.</> : <strong>Confira o status da sincronização.</strong>}</div></div>}
    <section className="section kpi-section" aria-label="Indicadores do período"><div className="metrics executive-metrics">
      <Metric icon={<Wallet size={17} />} tone="gold" label="Faturamento líquido" value={semVendas ? '—' : brlCurto(a.faturamento)} detail={<Delta atual={a.faturamento} anterior={b.faturamento} semVendas={semVendas} />} />
      <Metric icon={<TrendingUp size={17} />} tone="green" label="Lucro bruto" value={semVendas ? '—' : brlCurto(a.lucro)} detail={<Delta atual={a.lucro} anterior={b.lucro} semVendas={semVendas} />} />
      <Metric icon={<Percent size={17} />} tone="blue" label="Margem bruta" value={pct(a.margem)} detail={<Delta atual={a.margem} anterior={b.margem} pontos semVendas={semVendas} />} />
      <Metric icon={<Receipt size={17} />} tone="purple" label="Ticket médio" value={brl(a.ticket)} detail={<Delta atual={a.ticket} anterior={b.ticket} semVendas={semVendas} />} />
    </div></section>
    <div className="command-grid section">
      <section className="panel performance-panel" aria-labelledby="fat-h"><div className="panel-head"><div><span className="eyebrow">PERFORMANCE</span><h2 id="fat-h">Evolução do negócio</h2><p>{fmtData(r.periodo.inicio)} a {fmtData(r.periodo.fim)} · {int(a.vendas)} vendas</p></div><span className="chart-legend"><i /> Faturamento</span></div>
        {r.serie.every(d => d.faturamento === 0) ? <div className="state">As vendas aparecem assim que a carga do ERP chegar nelas.</div> : <div className="executive-chart"><ResponsiveContainer><AreaChart data={r.serie} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="fatFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--turquoise)" stopOpacity={0.24}/><stop offset="100%" stopColor="var(--turquoise)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} /><YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={68} /><Tooltip cursor={{ stroke: 'var(--line-2)' }} content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.data))}</strong>{brl(Number(payload[0].payload.faturamento))}<br />{int(payload[0].payload.vendas)} vendas</div> : null} /><Area type="monotone" dataKey="faturamento" stroke="var(--turquoise)" strokeWidth={2} fill="url(#fatFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>}
      </section>
      <section className="panel capital executive-capital" aria-labelledby="cap-h"><div className="panel-head"><div><span className="eyebrow">CAPITAL EM ESTOQUE</span><h2 id="cap-h">Saúde do inventário</h2></div></div><div className="capital-total">{totalCapital > 0 ? brl0(totalCapital) : '—'}</div><p className="capital-caption">valor total a custo</p>
        {totalCapital > 0 && !semVendas && <><div className="capital-bar">{capital.filter(c => c.valor > 0).map(c => <Link key={c.id} to={`/produtos?situacao=${c.id}`} title={`${c.nome}: ${brl(c.valor)}`} style={{ flex: `${c.valor / totalCapital * 100} 0 0`, background: c.cor }} />)}</div><div className="capital-legend">{capital.filter(c => c.valor > 0).slice(0, 5).map(c => <Link key={c.id} to={`/produtos?situacao=${c.id}`}><span><i style={{ background: c.cor }} />{c.nome}</span><b>{brlCurto(c.valor)}</b><em>{pct(c.valor / totalCapital * 100)}</em></Link>)}</div></>}
        {totalCapital > 0 && <div className="capital-insight"><CircleDollarSign size={16} /><span><b>{brlCurto(paradoOuExcesso)}</b> pedem ação no estoque</span></div>}<Link className="panel-link" to="/produtos">Analisar estoque <ArrowRight size={14} /></Link>
      </section>
    </div>
    <div className="bottom-command-grid section">
      <section aria-labelledby="atk-h" className="panel priority-panel"><div className="panel-head"><div><span className="eyebrow">AGENDA EXECUTIVA</span><h2 id="atk-h">Prioridades de hoje</h2></div></div>{ordenados.length === 0 ? <div className="state">Nenhum ponto crítico com os dados carregados.</div> : <div className="executive-priorities">{ordenados.map(p => <Link key={p.t} to={p.to}><span className={`priority-badge ${p.sev}`}>{p.sev === 'alta' ? 'Crítico' : 'Atenção'}</span><span className="priority-copy"><b>{p.t}</b><small>{p.m}</small></span><span className="priority-impact"><small>IMPACTO</small><b>{p.reais ? brlCurto(p.v) : int(p.v)}</b></span><span className="priority-action">{p.acao} <ArrowRight size={13} /></span></Link>)}</div>}</section>
      <section className="panel pulse-panel" aria-labelledby="pulse-h"><div className="panel-head"><div><span className="eyebrow">PULSO DA OPERAÇÃO</span><h2 id="pulse-h">No período</h2></div><span className="live"><i /> AO VIVO</span></div><div className="pulse-metrics"><div><ShoppingBag size={16}/><span>Vendas</span><strong>{int(a.vendas)}</strong></div><div><Wallet size={16}/><span>Média por dia</span><strong>{brlCurto(mediaDiaria)}</strong></div><div><PackageCheck size={16}/><span>Devoluções</span><strong>{brlCurto(a.devolucoes)}</strong></div><div><Percent size={16}/><span>Margem</span><strong>{pct(a.margem)}</strong></div></div></section>
    </div>
    {a.sem_custo > 0 && <p className="hint data-hint">{int(a.sem_custo)} itens vendidos sem custo no ERP ficam fora do lucro.</p>}{loading && <span className="sr-only" aria-live="polite">Atualizando</span>}
  </>
}
