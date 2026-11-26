import { ExportarPagina } from '../Exportar'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownUp, CalendarX, ChevronRight, Hourglass, PackageMinus, Percent, Receipt, TrendingDown, TrendingUp, UserMinus, Wallet, Wrench } from 'lucide-react'
import { useApi } from '../api'
import { brl, brlCurto, data as fmtData, dataCurta, haQuanto, int, pct, variacao } from '../format'
import { SITUACOES } from '../labels'
import { ErrorState, Loading, Metric, Tabs, useParam } from '../ui'

type Tot = { faturamento: number; lucro: number; vendas: number; devolucoes: number; sem_custo: number; margem: number | null; ticket: number | null }
type Resumo = {
  periodo: { inicio: string; fim: string; dias: number }
  atual: Tot; anterior: Tot
  serie: { data: string; faturamento: number; lucro: number; vendas: number }[]
  capital: { situacao: string; produtos: number; valor_estoque: number | string; unidades: number | string }[]
  lotes: { faixa: string; lotes: number; valor: number | string; lotes_em_risco: number; valor_em_risco: number | string | null }[]
  contagens: { fornecedores_aumento_10pct: number; clientes_em_risco: number; produtos_em_declinio: number }
  sync: { ultima_atualizacao: string | null; jobs: number; com_erro: number; em_andamento: number }
  carga?: { completa: boolean; vendas_ate: string | null; ultimo_mes: { mes: string; kpis: { faturamento_liquido: number; lucro: number; margem_pct: number | null; vendas: number; itens_sem_custo: number } } | null }
}
type Sugestao = { id: string; titulo: string; texto: string; valor: string; sub?: string; to: string; sev: 'alta' | 'media' | 'info'; icon: typeof Wallet; peso: number; frase: React.ReactNode }

const PERIODOS = [{ id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: '90', label: '90 dias' }, { id: '365', label: '12 meses' }]

function saudacao(d = new Date()) {
  const h = Number(d.toLocaleString('en-US', { timeZone: 'America/Belem', hour: 'numeric', hour12: false }))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}
const hoje = () => { const s = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Belem', weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1) }

function Delta({ atual, anterior, pontos, semVendas }: { atual: number | null; anterior: number | null; pontos?: boolean; semVendas: boolean }) {
  if (semVendas) return <>aguardando a carga das vendas</>
  if (atual === null || anterior === null) return <>sem base de comparação</>
  const v = pontos ? atual - anterior : variacao(atual, anterior)
  if (v === null) return <>sem base de comparação</>
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : ''
  const txt = pontos ? `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.` : `${v > 0 ? '+' : ''}${pct(v)}`
  return <><span className={cls}>{txt}</span> vs. período anterior</>
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
  // Carga das vendas ainda não chegou a hoje: nada que dependa de vendas recentes é afirmado.
  const incompleta = r.carga ? !r.carga.completa : false
  const semVendas = incompleta || (a.vendas === 0 && b.vendas === 0)
  const ate = r.carga?.vendas_ate ? fmtData(r.carga.vendas_ate) : null
  const um = r.carga?.ultimo_mes
  const mesLongo = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const parado = valorDe('parado') + valorDe('sem_saida_historica')
  const paradoOuExcesso = parado + valorDe('excesso_estoque')
  const varFat = semVendas ? null : variacao(a.faturamento, b.faturamento)

  // Sugestões: o que fazer, em ordem do dinheiro envolvido (contagens depois).
  const sugestoes: Sugestao[] = ([
    !semVendas && parado > 0 && { id: 'parado', titulo: 'Liberar capital parado', texto: `${int(qtdDe('parado') + qtdDe('sem_saida_historica'))} produtos sem venda há mais de 90 dias, ou que nunca venderam. Suspenda a recompra e avalie uma promoção.`, valor: brl(parado), sub: 'a custo', to: '/produtos?situacao=parado', sev: 'alta', icon: PackageMinus, peso: parado,
      frase: <><Link to="/produtos?situacao=parado">{brl(parado)}</Link> estão parados em produtos sem venda.</> },
    !semVendas && lotesRisco > 0 && { id: 'lotes', titulo: 'Dar saída aos lotes que vencem antes de vender', texto: `${int(qtdLotesRisco)} ${qtdLotesRisco === 1 ? 'lote não vende' : 'lotes não vendem'} antes da validade no ritmo atual. Priorize os mais antigos.`, valor: brl(lotesRisco), sub: 'em risco', to: '/validades?risco=1', sev: 'alta', icon: CalendarX, peso: lotesRisco,
      frase: <><Link to="/validades?risco=1">{int(qtdLotesRisco)} lotes</Link> não vendem antes de vencer, com {brl(lotesRisco)} em risco.</> },
    !semVendas && valorDe('excesso_estoque') > 0 && { id: 'excesso', titulo: 'Reduzir pedidos de itens em excesso', texto: `${int(qtdDe('excesso_estoque'))} produtos têm estoque para mais de 120 dias de venda.`, valor: brl(valorDe('excesso_estoque')), sub: 'a custo', to: '/produtos?situacao=excesso_estoque', sev: 'media', icon: ArrowDownUp, peso: valorDe('excesso_estoque'),
      frase: <>{int(qtdDe('excesso_estoque'))} produtos têm <Link to="/produtos?situacao=excesso_estoque">estoque para mais de 4 meses</Link>.</> },
    !semVendas && qtdDe('ruptura') > 0 && { id: 'ruptura', titulo: 'Repor produtos em ruptura', texto: 'Venderam nos últimos 30 dias e estão zerados: cada dia sem estoque é venda perdida.', valor: int(qtdDe('ruptura')), sub: 'produtos', to: '/produtos?situacao=ruptura', sev: 'alta', icon: AlertTriangle, peso: qtdDe('ruptura') * 100,
      frase: <><Link to="/produtos?situacao=ruptura">{int(qtdDe('ruptura'))} produtos</Link> que vendiam estão zerados.</> },
    r.contagens.fornecedores_aumento_10pct > 0 && { id: 'custos', titulo: 'Renegociar custos que subiram', texto: 'Itens cuja última compra saiu 10% ou mais cara que a anterior. Negocie ou cote outro fornecedor.', valor: int(r.contagens.fornecedores_aumento_10pct), sub: 'itens', to: '/fornecedores?min=10', sev: 'media', icon: TrendingUp, peso: r.contagens.fornecedores_aumento_10pct,
      frase: <><Link to="/fornecedores?min=10">{int(r.contagens.fornecedores_aumento_10pct)} itens</Link> ficaram 10% mais caros na última compra.</> },
    !semVendas && r.contagens.clientes_em_risco > 0 && { id: 'clientes', titulo: 'Chamar de volta clientes em risco', texto: 'Passaram do dobro do intervalo habitual sem comprar. Vale uma campanha de retorno.', valor: int(r.contagens.clientes_em_risco), sub: 'clientes', to: '/clientes?segmento=em_risco', sev: 'media', icon: UserMinus, peso: r.contagens.clientes_em_risco,
      frase: <><Link to="/clientes?segmento=em_risco">{int(r.contagens.clientes_em_risco)} clientes</Link> deixaram de voltar.</> },
    !semVendas && r.contagens.produtos_em_declinio > 0 && { id: 'declinio', titulo: 'Rever preço e exposição dos itens em queda', texto: 'Vendas caindo há 3 meses seguidos, com estoque disponível.', valor: int(r.contagens.produtos_em_declinio), sub: 'produtos', to: '/produtos?aba=declinio', sev: 'media', icon: TrendingDown, peso: r.contagens.produtos_em_declinio,
      frase: <><Link to="/produtos?aba=declinio">{int(r.contagens.produtos_em_declinio)} produtos</Link> vendem menos a cada mês.</> },
    incompleta && { id: 'carga', titulo: 'Acompanhar a carga das vendas', texto: `As vendas estão carregadas até ${ate ?? 'o início'}. Estoque parado, rupturas, validades em risco e clientes sumidos aparecem quando a carga chegar a hoje.`, valor: ate ?? '—', sub: 'carregado até', to: '/sincronizacao', sev: 'info', icon: Hourglass, peso: 0, frase: null },
    r.sync.com_erro > 0 && { id: 'dados', titulo: 'Corrigir dados no ERP', texto: 'Alguns registros do ERP vieram com erro e ficaram fora do sistema. A tela de sincronização mostra onde ajustar.', valor: int(r.sync.com_erro), sub: r.sync.com_erro === 1 ? 'leitura' : 'leituras', to: '/sincronizacao', sev: 'info', icon: Wrench, peso: 0,
      frase: null },
  ].filter(Boolean) as Sugestao[])
  const ordenadas = [...sugestoes.filter(s => s.sev !== 'info').sort((x, y) => y.peso - x.peso), ...sugestoes.filter(s => s.sev === 'info')]
  const principal = ordenadas.find(s => s.frase)
  const pico = r.serie.length ? r.serie.reduce((m, d) => (d.faturamento > m.faturamento ? d : m), r.serie[0]) : null

  return (
    <>
      <section className="brief" aria-labelledby="brief-h">
        <div className="brief-top">
          <span className="brief-when">{saudacao()}. {hoje()}.</span>
          <Tabs label="Período" value={dias} options={PERIODOS} onChange={setDias} />
          <ExportarPagina titulo="Visão geral" />
        </div>
        <h1 id="brief-h" className="brief-text">
          <span className="s">
            {incompleta && um
              ? <>Em <Link to={`/mes?mes=${um.mes}`}>{mesLongo(um.mes)}</Link>, o último mês com as vendas já carregadas, a Yup faturou {brl(Number(um.kpis.faturamento_liquido))} em {int(um.kpis.vendas)} vendas{um.kpis.margem_pct !== null && Number(um.kpis.lucro) !== 0 ? <>, com margem de {pct(um.kpis.margem_pct, 0)}</> : null}.</>
              : semVendas
              ? <>As vendas ainda estão chegando do ERP. O estoque já está completo.</>
              : <>Nos últimos {r.periodo.dias} dias a Yup faturou <Link to="/mes">{brl(a.faturamento)}</Link>{varFat !== null && <>, {pct(Math.abs(varFat), 0)} {varFat >= 0 ? 'acima' : 'abaixo'} do período anterior</>}{a.margem !== null && <>, com margem de {pct(a.margem, 0)}</>}.</>}
          </span>
          <span className="s">
            Há <Link to="/produtos">{brl(totalCapital)}</Link> em estoque a custo{!semVendas && paradoOuExcesso > 0 ? <>, {pct(paradoOuExcesso / totalCapital * 100, 0)} dele parado ou em excesso</> : null}.
          </span>
          {principal && <span className="s">{principal.frase}</span>}
        </h1>
        <p className="brief-src">
          Dados do ERP {r.sync.ultima_atualizacao ? `atualizados ${haQuanto(r.sync.ultima_atualizacao)}` : 'em carga'}.
          {incompleta ? <> Vendas carregadas até {ate ?? 'o início do histórico'}; a carga continua sozinha e as conclusões sobre estoque parado e validades aparecem quando ela chegar a hoje. <Link to="/sincronizacao">Ver progresso</Link>.</>
            : semVendas && <> A carga das vendas ainda está em andamento: <Link to="/sincronizacao">ver progresso</Link>.</>}
        </p>
      </section>

      <section aria-label="Indicadores do período">
        <div className="metrics">
          <Metric icon={<Wallet size={18} />} tone="gold" label="Faturamento líquido" value={semVendas ? '—' : brl(a.faturamento)} detail={<Delta atual={a.faturamento} anterior={b.faturamento} semVendas={semVendas} />} />
          <Metric icon={<TrendingUp size={18} />} tone="green" label="Lucro bruto" value={semVendas ? '—' : brl(a.lucro)} detail={<Delta atual={a.lucro} anterior={b.lucro} semVendas={semVendas} />} />
          <Metric icon={<Percent size={18} />} tone="blue" label="Margem bruta" value={pct(a.margem)} detail={<Delta atual={a.margem} anterior={b.margem} pontos semVendas={semVendas} />} />
          <Metric icon={<Receipt size={18} />} tone="purple" label="Ticket médio" value={brl(a.ticket)} detail={<Delta atual={a.ticket} anterior={b.ticket} semVendas={semVendas} />} />
        </div>
        {a.sem_custo > 0 && <p className="hint" style={{ margin: '10px 4px 0' }}>{int(a.sem_custo)} itens vendidos no período não têm custo no ERP e ficam fora do lucro.</p>}
      </section>

      <div className="home-grid">
        <section aria-labelledby="sug-h">
          <div className="group-title"><h2 id="sug-h">Sugestões</h2><span>{ordenadas.length ? `${ordenadas.length} ${ordenadas.length === 1 ? 'ação' : 'ações'}, da que envolve mais dinheiro para a que envolve menos` : ''}</span></div>
          {ordenadas.length === 0 ? <div className="panel state">Nada pedindo ação com os dados carregados até agora.</div> : (
            <ul className="inset">
              {ordenadas.map(s => { const Icon = s.icon; return (
                <li key={s.id}>
                  <Link className="row" to={s.to}>
                    <span className={`row-icon ${s.sev}`} aria-hidden><Icon size={16} /></span>
                    <span className="row-main"><strong>{s.titulo}</strong><span>{s.texto}</span></span>
                    <span className="row-val">{s.valor}{s.sub && <small>{s.sub}</small>}</span>
                    <ChevronRight size={16} className="row-chev" aria-hidden />
                  </Link>
                </li>
              ) })}
            </ul>
          )}
        </section>

        <section aria-labelledby="est-h">
          <div className="group-title"><h2 id="est-h">Estoque</h2><span>a custo</span></div>
          <div className="panel quiet">
            <div className="big">{totalCapital > 0 ? brl(totalCapital) : '—'}</div>
            {semVendas
              ? <p className="hint" style={{ margin: 0 }}>A divisão entre saudável, parado, excesso e ruptura depende do histórico de vendas, que ainda está chegando do ERP.</p>
              : totalCapital > 0 && <div className="stock-bar" role="img" aria-label="Divisão do estoque por situação">
                  {capital.filter(c => c.valor > 0).map(c => <i key={c.id} style={{ flex: `${c.valor} 0 0`, background: c.cor }} title={`${c.nome}: ${brl(c.valor)}`} />)}
                </div>}
          </div>
          {!semVendas && (
            <ul className="inset" style={{ marginTop: 12 }}>
              {capital.filter(c => c.produtos > 0).sort((x, y) => y.valor - x.valor).map(c => (
                <li key={c.id}>
                  <Link className="row" to={`/produtos?situacao=${c.id}`} title={c.desc}>
                    <span className="row-icon" style={{ background: c.cor }} aria-hidden />
                    <span className="row-main"><strong>{c.nome}</strong><span>{int(c.produtos)} produtos</span></span>
                    <span className="row-val">{brl(c.valor)}<small>{totalCapital ? pct(c.valor / totalCapital * 100, 0) : ''}</small></span>
                    <ChevronRight size={16} className="row-chev" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel section" aria-labelledby="fat-h">
        <div className="panel-head">
          <div><h2 id="fat-h">Faturamento por dia</h2><p>{fmtData(r.periodo.inicio)} a {fmtData(r.periodo.fim)}, {int(a.vendas)} vendas, {brl(a.devolucoes)} em devoluções</p></div>
        </div>
        {r.serie.every(d => d.faturamento === 0) ? <div className="state">{semVendas ? 'As vendas aparecem aqui assim que a carga do ERP chegar nelas.' : 'Nenhuma venda neste período.'}</div> : <div style={{ height: 280 }} role="img" aria-label={`Gráfico de área do faturamento diário de ${fmtData(r.periodo.inicio)} a ${fmtData(r.periodo.fim)}: total de ${brl(a.faturamento)}${pico ? `; maior dia ${fmtData(pico.data)}, com ${brl(pico.faturamento)}` : ''}.`}>
          <ResponsiveContainer>
            <AreaChart data={r.serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs><linearGradient id="fat-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--turquoise)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--turquoise)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={({ active, payload }) => active && payload?.length ? (
                <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.data))}</strong>{brl(Number(payload[0].payload.faturamento))}<br />{int(payload[0].payload.vendas)} vendas, lucro {brl(Number(payload[0].payload.lucro))}</div>
              ) : null} />
              <Area type="monotone" dataKey="faturamento" stroke="var(--turquoise-ink)" strokeWidth={2} fill="url(#fat-g)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>}
      </section>
      {loading && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}
