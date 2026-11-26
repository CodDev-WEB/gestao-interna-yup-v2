import { type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeftRight, BadgePercent, ChevronLeft, ChevronRight, Hourglass, PackagePlus, Receipt, ShoppingBag, TrendingUp, Undo2, Users, Wallet } from 'lucide-react'
import { useApi } from '../api'
import { brl, brlCurto, dataCurta, dec, int, mes as fmtMes, pct, variacao } from '../format'
import { ItemLink } from '../ProdutoPainel'
import { ErrorState, Loading, Metric, PageHead, Tabs, useParam } from '../ui'

type K = {
  vendas: number; faturamento_bruto: number; descontos: number; faturamento: number; devolucoes: number; qtd_devolucoes: number; faturamento_liquido: number
  custo_vendas: number; lucro: number; margem_pct: number | null; markup_pct: number | null; ticket_medio: number | null; itens_vendidos: number; itens_por_venda: number | null
  produtos_vendidos: number; clientes: number; vendas_sem_cliente: number; pct_vendas_identificadas: number | null; pct_desconto: number | null; pct_devolucao: number | null
  itens_sem_custo: number; dias_com_venda: number; compras: number; notas_compra: number; itens_comprados: number; produtos_comprados: number; fornecedores: number
  compras_sobre_custo_pct: number | null; compras_sobre_faturamento_pct: number | null
}
type Prod = { id: number; nome: string | null; qtd: number; faturamento: number; lucro: number; vendas: number; margem_pct: number | null; pct: number | null }
type Resumo = {
  mes: string; inicio: string; fim: string; dias_no_mes: number; dias_decorridos: number; em_andamento: boolean
  kpis: K; anterior: K; ano_anterior: K; historico: (K & { mes: string })[]
  top_faturamento: Prod[]; top_quantidade: Prod[]; top_lucro: Prod[]
  top_comprados: { id: number; nome: string | null; qtd: number; valor: number; notas: number; custo_medio: number | null; pct: number | null }[]
  fornecedores_compra: { id: number; nome: string; valor: number; notas: number; produtos: number; pct: number | null }[]
  fornecedores_venda: { id: number | null; nome: string; faturamento: number; lucro: number; produtos: number; qtd: number; margem_pct: number | null; pct: number | null }[]
  setores: { setor: string; faturamento: number; lucro: number; vendas: number; margem_pct: number | null; pct: number | null }[]
  secoes: { secao: string; setor: string; faturamento: number; lucro: number; qtd: number; margem_pct: number | null; pct: number | null }[]
  vendedores: { id: number | null; nome: string; faturamento: number; vendas: number; lucro: number; ticket_medio: number | null; pct: number | null }[]
  por_dia: { data: string; faturamento: number; lucro: number; vendas: number; compras: number }[]
  dia_semana: { dow: number; faturamento: number; vendas: number; dias: number; media_dia: number | null; pct: number | null }[]
  clientes_novos: number
}

const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const mesLongo = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const somaMes = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7) }

function Var({ atual, base, pontos, inverter }: { atual: number | null; base: number | null; pontos?: boolean; inverter?: boolean }) {
  if (atual === null || base === null || base === undefined) return <span className="muted">—</span>
  const v = pontos ? atual - base : variacao(atual, base)
  if (v === null || !isFinite(v)) return <span className="muted">—</span>
  const bom = inverter ? v < 0 : v > 0
  return <span className={v === 0 ? 'muted' : bom ? 'up' : 'down'}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {pontos ? `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.` : pct(Math.abs(v))}</span>
}

/** Lista ranqueada com barra de participação. */
function Ranking<T>({ itens, nome, valor, pctDe, extra, vazio }: { itens: T[]; nome: (x: T) => ReactNode; valor: (x: T) => ReactNode; pctDe: (x: T) => number | null; extra?: (x: T) => ReactNode; vazio: string }) {
  if (!itens.length) return <div className="state">{vazio}</div>
  const max = Math.max(...itens.map(x => pctDe(x) ?? 0), 0.0001)
  return (
    <ol className="rank">
      {itens.map((x, i) => (
        <li key={i}>
          <span className="rank-n">{i + 1}</span>
          <div className="rank-body">
            <div className="rank-top"><span className="rank-nome">{nome(x)}</span><span className="rank-v">{valor(x)}</span></div>
            <div className="rank-bar" aria-hidden><i style={{ width: `${Math.max(2, (pctDe(x) ?? 0) / max * 100)}%` }} /></div>
            <div className="rank-sub">{pctDe(x) !== null && <b>{pct(pctDe(x))} do total</b>}{extra && <> · {extra(x)}</>}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Painel({ titulo, sub, children, acoes }: { titulo: string; sub?: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>{titulo}</h2>{sub && <p>{sub}</p>}</div>{acoes}</div>
      {children}
    </section>
  )
}

type CS = { mes: string; vendas: number; faturamento_liquido: number | string; desconto_pct: number | string | null; devolucao_pct: number | string | null; margem_pct: number | string | null; ticket_medio: number | string | null; itens_sem_custo: number; itens_sem_custo_pct: number | string | null; perda_validade: number | string; lotes_vencidos: number }

/** Relatório de custo-serviço (Ballou, cap. 16): venda, margem, descontos, devoluções e perdas mês a mês, lado a lado. */
function CustoServico() {
  const { data: d, error } = useApi<CS[]>('dash/custo-servico')
  if (error || !d?.length) return null
  return (
    <section className="panel section" aria-labelledby="cs-h">
      <h2 id="cs-h">Relatório de custo-serviço</h2>
      <p>Um mês por linha, do mais recente para o mais antigo. Margem só aparece quando todos os itens vendidos no mês têm custo. Perda por validade é o custo dos lotes que venceram no mês e ainda têm saldo.</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Custo-serviço por mês</caption>
          <thead><tr><th>Mês</th><th className="r">Faturamento líquido</th><th className="r">Vendas</th><th className="r">Ticket médio</th><th className="r">Margem</th><th className="r">Desconto</th><th className="r">Devolução</th><th className="r">Perda por validade</th><th className="r">Itens sem custo</th></tr></thead>
          <tbody>{d.map((m, i) => {
            const ant = d.at(i + 1)
            const v = ant ? variacao(Number(m.faturamento_liquido), Number(ant.faturamento_liquido)) : null
            return (
              <tr key={m.mes}>
                <td>{fmtMes(m.mes + '-01')}</td>
                <td className="r"><strong>{brl(m.faturamento_liquido)}</strong>{v !== null && <small className={v >= 0 ? 'up' : 'down'}>{v >= 0 ? '+' : ''}{pct(v)} vs. mês anterior</small>}</td>
                <td className="r">{int(m.vendas)}</td>
                <td className="r">{brl(m.ticket_medio)}</td>
                <td className="r">{m.margem_pct === null ? <span className="muted">sem custo</span> : pct(m.margem_pct)}</td>
                <td className="r">{pct(m.desconto_pct)}</td>
                <td className="r">{pct(m.devolucao_pct)}</td>
                <td className="r">{Number(m.perda_validade) > 0 ? <span className="status-bad">{brl(m.perda_validade)}</span> : brl(0)}{m.lotes_vencidos > 0 && <small>{int(m.lotes_vencidos)} lotes</small>}</td>
                <td className="r">{m.itens_sem_custo > 0 ? <span className="status-warn">{pct(m.itens_sem_custo_pct)}</span> : '0%'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </section>
  )
}

export default function Mes() {
  const [mesSel, setMes] = useParam('mes')
  const [rank, setRank] = useParam('ranking', 'faturamento')
  const { data: meses } = useApi<{ mes: string; documentos: number }[]>('dash/meses')
  const { data: r, error, loading, reload } = useApi<Resumo>(`dash/mes${mesSel ? `?mes=${mesSel}` : ''}`)

  const atual = r?.mes ?? mesSel
  const seletor = (
    <div className="month-picker">
      <button type="button" className="btn secondary" disabled={!atual} onClick={() => atual && setMes(somaMes(atual, -1))} aria-label="Mês anterior"><ChevronLeft size={18} aria-hidden /></button>
      <select className="select" value={atual ?? ''} onChange={e => setMes(e.target.value)} aria-label="Mês">
        {atual && !meses?.some(m => m.mes === atual) && <option value={atual}>{Cap(mesLongo(atual))}</option>}
        {(meses ?? []).map(m => <option key={m.mes} value={m.mes}>{Cap(mesLongo(m.mes))}</option>)}
      </select>
      <button type="button" className="btn secondary" disabled={!atual} onClick={() => atual && setMes(somaMes(atual, 1))} aria-label="Próximo mês"><ChevronRight size={18} aria-hidden /></button>
    </div>
  )

  if (error) return <><PageHead section="RESUMO DO MÊS" title="Resumo do mês" actions={seletor} /><ErrorState message={error} onRetry={reload} /></>
  if (!r) return <><PageHead section="RESUMO DO MÊS" title="Resumo do mês" actions={seletor} /><Loading rows={8} /></>

  const k = r.kpis, a = r.anterior, y = r.ano_anterior
  const semVendas = k.vendas === 0
  const projecao = r.em_andamento && r.dias_decorridos > 0 ? k.faturamento_liquido / r.dias_decorridos * r.dias_no_mes : null
  const top = rank === 'quantidade' ? r.top_quantidade : rank === 'lucro' ? r.top_lucro : r.top_faturamento
  const hist = r.historico.map(h => ({ ...h, compras: Number(h.compras), custo_vendas: Number(h.custo_vendas), faturamento_liquido: Number(h.faturamento_liquido) }))

  const linhas: [string, (x: K) => number | null, (v: number | null) => string, { pontos?: boolean; inverter?: boolean }?][] = [
    ['Faturamento líquido', x => x.faturamento_liquido, brl],
    ['Lucro bruto', x => x.lucro, brl],
    ['Margem bruta', x => x.margem_pct, v => pct(v), { pontos: true }],
    ['Vendas', x => x.vendas, v => int(v)],
    ['Ticket médio', x => x.ticket_medio, brl],
    ['Itens por venda', x => x.itens_por_venda, v => dec(v)],
    ['Produtos diferentes vendidos', x => x.produtos_vendidos, v => int(v)],
    ['Clientes identificados', x => x.clientes, v => int(v)],
    ['Descontos (% do bruto)', x => x.pct_desconto, v => pct(v), { pontos: true, inverter: true }],
    ['Devoluções (% do faturamento)', x => x.pct_devolucao, v => pct(v), { pontos: true, inverter: true }],
    ['Entrou no estoque (compras)', x => x.compras, brl],
    ['Notas de compra', x => x.notas_compra, v => int(v)],
  ]

  return (
    <>
      <PageHead section="RESUMO DO MÊS" title={`Resumo de ${mesLongo(r.mes)}`} actions={seletor}>
        O que entrou no estoque, o que saiu em vendas, quem mais vendeu e quem mais forneceu, comparado ao mês anterior e ao mesmo mês do ano passado.
      </PageHead>

      {r.em_andamento && (
        <div className="notice info" role="status"><Hourglass size={18} aria-hidden /><div><strong>Mês em andamento:</strong> {r.dias_decorridos} de {r.dias_no_mes} dias. Comparações com meses fechados ficam desiguais até o fim do mês.{projecao !== null && projecao > 0 && <> No ritmo atual, o faturamento fecha perto de <strong>{brl(projecao)}</strong>.</>}</div></div>
      )}
      {semVendas && k.compras === 0 && (
        <div className="notice" role="status"><Hourglass size={18} aria-hidden /><div>Nenhuma venda ou compra deste mês foi carregada ainda. Se a carga do ERP está em andamento, os números aparecem conforme os documentos chegam. <a href="/sincronizacao">Ver andamento</a></div></div>
      )}

      <div className="metrics">
        <Metric icon={<Wallet size={18} />} tone="gold" label="Faturamento líquido" value={brl(k.faturamento_liquido)} detail={<><Var atual={k.faturamento_liquido} base={a.faturamento_liquido} /> vs. mês anterior</>} />
        <Metric icon={<TrendingUp size={18} />} tone="green" label="Lucro bruto" value={brl(k.lucro)} detail={<>margem {pct(k.margem_pct)} · <Var atual={k.margem_pct} base={a.margem_pct} pontos /></>} />
        <Metric icon={<Receipt size={18} />} tone="purple" label="Vendas" value={int(k.vendas)} detail={<>ticket médio {brl(k.ticket_medio)} · {dec(k.itens_por_venda)} itens/venda</>} />
        <Metric icon={<Users size={18} />} tone="blue" label="Clientes atendidos" value={int(k.clientes)} detail={<>{int(r.clientes_novos)} novos · {pct(k.pct_vendas_identificadas)} das vendas com cliente</>} />
      </div>
      <div className="metrics" style={{ marginTop: 12 }}>
        <Metric icon={<PackagePlus size={18} />} tone="turquoise" label="Entrou no estoque" value={brl(k.compras)} detail={<>{int(k.notas_compra)} notas · {int(k.fornecedores)} fornecedores · <Var atual={k.compras} base={a.compras} /></>} />
        <Metric icon={<ArrowLeftRight size={18} />} tone="blue" label="Reposição" value={pct(k.compras_sobre_custo_pct)}
          detail={k.compras_sobre_custo_pct === null ? 'sem custo vendido para comparar' : k.compras_sobre_custo_pct > 110 ? 'comprou mais do que vendeu: estoque crescendo' : k.compras_sobre_custo_pct < 90 ? 'comprou menos do que vendeu: estoque diminuindo' : 'comprou perto do que vendeu'} />
        <Metric icon={<BadgePercent size={18} />} tone="gold" label="Descontos" value={pct(k.pct_desconto)} detail={`${brl(k.descontos)} sobre ${brl(k.faturamento_bruto)} bruto`} />
        <Metric icon={<Undo2 size={18} />} tone={k.pct_devolucao && k.pct_devolucao > 3 ? 'red' : 'purple'} label="Devoluções" value={pct(k.pct_devolucao)} detail={`${brl(k.devolucoes)} em ${int(k.qtd_devolucoes)} devoluções`} />
      </div>
      {k.itens_sem_custo > 0 && <p className="hint" style={{ marginTop: 10 }}>{int(k.itens_sem_custo)} itens vendidos no mês não têm custo no ERP: ficam fora da margem e do lucro.</p>}

      <div className="section">
        <Painel titulo="Entrou × saiu nos últimos 12 meses" sub="Compras para o estoque, custo do que foi vendido e faturamento líquido. Clique num mês para abrir o resumo dele.">
          <div style={{ height: 260 }} role="img" aria-label={`Gráfico dos últimos ${hist.length} meses: compras para o estoque e custo do que foi vendido em barras, faturamento líquido em linha. Use o seletor de mês no topo para abrir cada mês.`}>
            <ResponsiveContainer>
              <ComposedChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} onClick={e => { const m = (e as { activeLabel?: string } | null)?.activeLabel; if (m) setMes(m) }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="mes" tickFormatter={m => fmtMes(m + '-01')} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--line-2)' }} />
                <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={76} />
                <Tooltip cursor={{ fill: '#17283b0a' }} content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="chart-tip"><strong>{mesLongo(String(label))}</strong>
                    Entrou (compras): {brl(Number(payload[0].payload.compras))}<br />Custo do vendido: {brl(Number(payload[0].payload.custo_vendas))}<br />Faturamento líquido: {brl(Number(payload[0].payload.faturamento_liquido))}<br />Lucro: {brl(Number(payload[0].payload.lucro))}</div>
                ) : null} />
                <Legend formatter={v => <span style={{ color: 'var(--ink-2)' }}>{v}</span>} iconType="square" />
                <Bar name="Entrou no estoque" dataKey="compras" fill="var(--turquoise)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor="pointer" />
                <Bar name="Custo do vendido" dataKey="custo_vendas" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} cursor="pointer" />
                <Line name="Faturamento líquido" dataKey="faturamento_liquido" stroke="var(--navy)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Painel>
      </div>

      <div className="grid-2 section">
        <Painel titulo="Faturamento e compras por dia">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={r.por_dia} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={1}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="data" tickFormatter={dataCurta} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line-2)' }} minTickGap={16} />
                <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={70} />
                <Tooltip cursor={{ fill: '#17283b0a' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip"><strong>{dataCurta(String(payload[0].payload.data))} · {DIAS[new Date(payload[0].payload.data + 'T12:00:00').getDay() || 7]}</strong>Vendeu {brl(Number(payload[0].payload.faturamento))} em {int(payload[0].payload.vendas)} vendas<br />Comprou {brl(Number(payload[0].payload.compras))}</div>
                ) : null} />
                <Bar name="Faturamento" dataKey="faturamento" fill="var(--navy)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar name="Compras" dataKey="compras" fill="var(--turquoise)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Painel>
        <Painel titulo="Vendas por dia da semana" sub="Média de faturamento nos dias em que houve venda.">
          {r.dia_semana.length === 0 ? <div className="state">Sem vendas no mês.</div> : (
            <Ranking itens={r.dia_semana} nome={x => DIAS[x.dow]} valor={x => `${brl(x.media_dia)}/dia`} pctDe={x => x.pct} extra={x => `${int(x.vendas)} vendas em ${x.dias} dias`} vazio="" />
          )}
        </Painel>
      </div>

      <div className="section">
        <Painel titulo="Comparativo" sub={`${mesLongo(r.mes)} contra ${mesLongo(somaMes(r.mes, -1))} e ${mesLongo(somaMes(r.mes, -12))}.`}>
          <div className="table-wrap cards-sm"><table><caption className="sr-only">Comparativo do mês</caption>
            <thead><tr><th>Indicador</th><th className="r">Este mês</th><th className="r">Mês anterior</th><th className="r">Variação</th><th className="r">Ano passado</th><th className="r">Variação</th></tr></thead>
            <tbody>{linhas.map(([nome, f, fmt, o]) => (
              <tr key={nome}>
                <td><span className="title">{nome}</span></td>
                <td className="r money" data-label="Este mês">{fmt(f(k))}</td>
                <td className="r" data-label="Mês anterior">{fmt(f(a))}</td>
                <td className="r" data-label="Variação">{<Var atual={f(k)} base={f(a)} pontos={o?.pontos} inverter={o?.inverter} />}</td>
                <td className="r" data-label="Ano passado">{fmt(f(y))}</td>
                <td className="r" data-label="Variação">{<Var atual={f(k)} base={f(y)} pontos={o?.pontos} inverter={o?.inverter} />}</td>
              </tr>
            ))}</tbody></table></div>
        </Painel>
      </div>

      <div className="grid-2 section">
        <Painel titulo="Produtos que mais saíram" acoes={<Tabs label="Ordenar por" value={rank} onChange={setRank} options={[{ id: 'faturamento', label: 'Valor' }, { id: 'quantidade', label: 'Quantidade' }, { id: 'lucro', label: 'Lucro' }]} />}>
          <Ranking itens={top} nome={x => <ItemLink id={x.id}>{x.nome ?? `Item ${x.id}`}</ItemLink>}
            valor={x => rank === 'quantidade' ? `${dec(x.qtd)} un.` : rank === 'lucro' ? brl(x.lucro) : brl(x.faturamento)}
            pctDe={x => rank === 'quantidade' ? (x.qtd / Math.max(1, Number(k.itens_vendidos)) * 100) : x.pct}
            extra={x => <>{rank === 'quantidade' ? brl(x.faturamento) : `${dec(x.qtd)} un.`} · margem {pct(x.margem_pct)} · {int(x.vendas)} vendas</>}
            vazio="Nenhuma venda carregada neste mês." />
        </Painel>
        <Painel titulo="O que entrou no estoque" sub={`${brl(k.compras)} em ${int(k.produtos_comprados)} produtos diferentes.`}>
          <Ranking itens={r.top_comprados} nome={x => <ItemLink id={x.id}>{x.nome ?? `Item ${x.id}`}</ItemLink>} valor={x => brl(x.valor)} pctDe={x => x.pct}
            extra={x => <>{dec(x.qtd)} un. a {brl(x.custo_medio)} · {int(x.notas)} {x.notas === 1 ? 'nota' : 'notas'}</>} vazio="Nenhuma compra carregada neste mês." />
        </Painel>
      </div>

      <div className="grid-2 section">
        <Painel titulo="Principais fornecedores nas compras" sub="De quem a Yup mais comprou para o estoque no mês.">
          <Ranking itens={r.fornecedores_compra} nome={x => x.nome} valor={x => brl(x.valor)} pctDe={x => x.pct}
            extra={x => <>{int(x.notas)} {x.notas === 1 ? 'nota' : 'notas'} · {int(x.produtos)} produtos</>} vazio="Nenhuma compra carregada neste mês." />
        </Painel>
        <Painel titulo="Principais fornecedores nas vendas" sub="De quem são os produtos que mais venderam (fornecedor da última compra de cada item).">
          <Ranking itens={r.fornecedores_venda} nome={x => x.nome} valor={x => brl(x.faturamento)} pctDe={x => x.pct}
            extra={x => <>margem {pct(x.margem_pct)} · {int(x.produtos)} produtos vendidos</>} vazio="Nenhuma venda carregada neste mês." />
        </Painel>
      </div>

      <div className="grid-2 section">
        <Painel titulo="Vendas por setor e seção">
          <Ranking itens={r.setores} nome={x => x.setor} valor={x => brl(x.faturamento)} pctDe={x => x.pct} extra={x => <>margem {pct(x.margem_pct)} · {int(x.vendas)} vendas</>} vazio="Nenhuma venda carregada neste mês." />
          {r.secoes.length > 0 && <>
            <h3 style={{ margin: '18px 0 10px' }}>Seções que mais faturaram</h3>
            <Ranking itens={r.secoes} nome={x => x.secao} valor={x => brl(x.faturamento)} pctDe={x => x.pct} extra={x => <>{x.setor} · margem {pct(x.margem_pct)}</>} vazio="" />
          </>}
        </Painel>
        <Painel titulo="Vendedores" sub="Faturamento por funcionário que registrou a venda.">
          <Ranking itens={r.vendedores} nome={x => <><ShoppingBag size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--muted)' }} />{x.nome}</>} valor={x => brl(x.faturamento)} pctDe={x => x.pct}
            extra={x => <>{int(x.vendas)} vendas · ticket {brl(x.ticket_medio)}</>} vazio="Nenhuma venda carregada neste mês." />
        </Painel>
      </div>
      <CustoServico />
      {loading && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}
