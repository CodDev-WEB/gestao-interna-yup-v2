// Painel lateral com a ficha completa de um item. Abre por cima de qualquer tela quando a URL tem ?item=ID,
// então o link pode ser compartilhado e o botão Voltar do navegador fecha o painel.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Box, CalendarClock, CalendarX, ClipboardCheck, Copy, DollarSign, Flag,
  History, PackagePlus, PencilLine, Receipt, RotateCcw, ShoppingCart, Tag, TrendingUp, Undo2, X,
} from 'lucide-react'
import { useApi } from './api'
import { brl, data as fmtData, dec, int, mes, pct } from './format'
import { situacao } from './labels'
import { Empty, ErrorState, Loading, Metric, Tabs } from './ui'

type Entrada = { iddocumento: number; datahora: string | null; data: string; fornecedor: string | null; natureza: string | null; qtd: number; total: number | null; custo_unitario: number | null; lote: string | null; dtvalidade: string | null }
type Lote = { lote: string; dtentrada: string; dtfabricacao: string | null; dtvalidade: string; dias_para_vencer: number; qtdsaldo: number; local: string; valor: number | null; entrada: Entrada | null }
type Evento = { quando: string; tipo: string; titulo: string; detalhe?: string; valor?: number | null; futuro: boolean }
type Ficha = {
  hoje: string
  item: { id: number; idmercadoria: number | null; descricao: string; codigobarras: string | null; referencia: string | null; embalagem: string | null; marca: string | null; secao: string | null; grupo: string | null; setor: string | null; situacao: string | null; cadastro_alterado: string | null }
  numeros: {
    estoque: number; custo: number | null; valor_estoque: number | null; preco_venda: number | null; preco_alterado: string | null; markup_pct: number | null; margem_pct: number | null
    qtd_30d: number; qtd_90d: number; faturamento_90d: number; margem_90d_pct: number | null; cobertura_dias: number | null; dias_sem_venda: number | null
    primeira_entrada: string | null; ultima_entrada: string | null; primeira_venda: string | null; ultima_venda: string | null
    qtd_comprada: number; total_comprado: number; entradas: number; custo_medio_compras: number | null
  }
  precos: { empresa: number; tabela: number; preco: number | null; custo: number | null; ativo: boolean; alterado: string | null }[]
  estoque_locais: { local: string; empresa: number; qtd: number; reservado: number; atualizado: string | null }[]
  fornecedores: { id: number; nome: string; embalagem: string | null; fator: number | null; codigo: string | null }[]
  lotes: Lote[]; entradas: Entrada[]
  vendas_mes: { mes: string; qtd: number; faturamento: number; lucro: number; vendas: number }[]
  historico_preco: { datahora: string; tabela: number; de: number | null; para: number | null; variacao_pct: number | null }[]
  historico_saldo: { datahora: string; documento: string | null; tipo: string; nome: string; de: number; para: number; diferenca: number; local: string | null }[]
  inventarios: { datahora: string; contado: number | null; anterior: number | null; lote: string | null }[]
  linha_do_tempo: Evento[]
  carga: { historico_preco: boolean; historico_saldo: boolean; vendas: boolean }
}

type Aba = 'geral' | 'lotes' | 'entradas' | 'precos' | 'tempo'

/** Abre a ficha de um item mantendo a página e os filtros atuais. */
export function useAbrirItem() {
  const [, setSp] = useSearchParams()
  return (id: number | string) => setSp(prev => { const n = new URLSearchParams(prev); n.set('item', String(id)); n.delete('aba-item'); return n })
}

/** Nome do produto clicável que abre a ficha. */
export function ItemLink({ id, children }: { id: number | string; children: ReactNode }) {
  const abrir = useAbrirItem()
  return <button type="button" className="item-link" onClick={() => abrir(id)} title="Abrir ficha do item">{children}</button>
}

const dataHora = (v: string | null | undefined) => {
  if (!v) return '—'
  if (v.length <= 10) return fmtData(v)
  const d = new Date(v)
  return `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Belem' })} ${d.toLocaleTimeString('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit' })}`
}

function validadePill(l: Lote) {
  if (l.qtdsaldo <= 0) return <span className="pill neutral">Zerado</span>
  if (l.dias_para_vencer < 0) return <span className="pill bad">Vencido há {-l.dias_para_vencer} d</span>
  if (l.dias_para_vencer <= 30) return <span className="pill bad">Vence em {l.dias_para_vencer} d</span>
  if (l.dias_para_vencer <= 90) return <span className="pill warn">Vence em {l.dias_para_vencer} d</span>
  return <span className="pill good">Em {l.dias_para_vencer} dias</span>
}

const ICONES: Record<string, { icon: typeof Box; cor: string }> = {
  entrada: { icon: PackagePlus, cor: 'green' }, preco: { icon: Tag, cor: 'turquoise' }, ajuste: { icon: PencilLine, cor: 'purple' },
  inventario: { icon: ClipboardCheck, cor: 'blue' }, devolucao: { icon: Undo2, cor: 'gold' }, validade: { icon: CalendarClock, cor: 'gold' },
  vencido: { icon: CalendarX, cor: 'red' }, venda: { icon: ShoppingCart, cor: 'green' }, marco: { icon: Flag, cor: 'blue' },
  cadastro: { icon: History, cor: 'neutral' }, cancelado: { icon: RotateCcw, cor: 'red' },
}

function Dados({ itens }: { itens: [string, ReactNode][] }) {
  return <dl className="kv">{itens.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>
}

function Geral({ f }: { f: Ficha }) {
  const n = f.numeros, it = f.item
  const temVenda = f.vendas_mes.some(m => m.qtd > 0)
  return (
    <>
      <section className="drawer-block">
        <h3>Cadastro</h3>
        <Dados itens={[
          ['Código interno', it.id], ['Código de barras', it.codigobarras], ['Referência', it.referencia], ['Marca', it.marca],
          ['Embalagem', it.embalagem], ['Seção', it.secao], ['Grupo', it.grupo], ['Setor', it.setor],
          ['Cadastro alterado', dataHora(it.cadastro_alterado)],
        ]} />
      </section>
      <section className="drawer-block">
        <h3>Movimento</h3>
        <Dados itens={[
          ['Primeira entrada', fmtData(n.primeira_entrada)], ['Última entrada', fmtData(n.ultima_entrada)],
          ['Primeira venda', fmtData(n.primeira_venda)], ['Última venda', fmtData(n.ultima_venda)],
          ['Dias sem vender', n.dias_sem_venda === null ? '—' : int(n.dias_sem_venda)], ['Vendido em 30 dias', `${dec(n.qtd_30d)} un.`],
          ['Faturamento 90 dias', brl(n.faturamento_90d)], ['Margem real 90 dias', pct(n.margem_90d_pct)],
          ['Estoque dura', n.cobertura_dias === null ? '—' : `${int(n.cobertura_dias)} dias`],
        ]} />
      </section>
      <section className="drawer-block">
        <h3>Vendas nos últimos 12 meses</h3>
        {!temVenda ? <Empty>{f.carga.vendas ? 'Nenhuma venda nos últimos 12 meses.' : 'As vendas aparecem aqui assim que a carga do ERP chegar nelas.'}</Empty> : (
          <div style={{ height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={f.vendas_mes} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="mes" tickFormatter={m => mes(m + '-01')} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line-2)' }} interval={1} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#17283b0a' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip"><strong>{mes(payload[0].payload.mes + '-01')}</strong>{dec(payload[0].payload.qtd)} un. em {int(payload[0].payload.vendas)} vendas<br />{brl(payload[0].payload.faturamento)} · lucro {brl(payload[0].payload.lucro)}</div>
                ) : null} />
                <Bar dataKey="qtd" fill="var(--turquoise)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="drawer-block">
        <h3>Estoque por local</h3>
        {f.estoque_locais.length === 0 ? <Empty>Sem saldo registrado.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Local</th><th className="r">Saldo</th><th className="r">Reservado</th><th>Atualizado</th></tr></thead>
            <tbody>{f.estoque_locais.map((e, i) => <tr key={i}><td>Loja {e.empresa} · {e.local}</td><td className="r">{dec(e.qtd)}</td><td className="r">{dec(e.reservado)}</td><td>{dataHora(e.atualizado)}</td></tr>)}</tbody></table></div>
        )}
      </section>
      <section className="drawer-block">
        <h3>Fornecedores cadastrados</h3>
        {f.fornecedores.length === 0 ? <Empty>Nenhum fornecedor vinculado no ERP.</Empty> : (
          <ul className="plain-list">{f.fornecedores.map(x => <li key={`${x.id}-${x.embalagem}`}><strong>{x.nome}</strong><span>{[x.codigo && `código ${x.codigo}`, x.embalagem && `embalagem ${x.embalagem}`, x.fator && x.fator !== 1 ? `${dec(x.fator)} un. por embalagem` : null].filter(Boolean).join(' · ') || '—'}</span></li>)}</ul>
        )}
      </section>
    </>
  )
}

function Lotes({ f }: { f: Ficha }) {
  const [zerados, setZerados] = useState(false)
  const ativos = f.lotes.filter(l => l.qtdsaldo > 0)
  const lista = zerados ? f.lotes : ativos
  const qZerados = f.lotes.length - ativos.length
  if (f.lotes.length === 0) return <Empty>Este item não tem lotes registrados no ERP.</Empty>
  return (
    <>
      <div className="controls">
        <span className="muted">{int(ativos.length)} {ativos.length === 1 ? 'lote com saldo' : 'lotes com saldo'} · {dec(ativos.reduce((a, l) => a + l.qtdsaldo, 0))} un. em lotes{qZerados > 0 && ` · ${int(qZerados)} já zerados`}</span>
        {qZerados > 0 && <button type="button" className="chip" aria-pressed={zerados} onClick={() => setZerados(z => !z)}>Mostrar lotes zerados</button>}
      </div>
      {lista.length === 0 ? <Empty>Nenhum lote com saldo.</Empty> : (
        <div className="table-wrap cards-sm"><table><caption className="sr-only">Lotes do item</caption>
          <thead><tr><th>Lote</th><th>Entrada</th><th>Validade</th><th className="r">Saldo</th><th className="r">Valor (custo)</th><th>Situação</th></tr></thead>
          <tbody>{lista.map((l, i) => (
            <tr key={i}>
              <td><span className="title">Lote {l.lote}</span><small>{l.local}{l.dtfabricacao ? ` · fabricado ${fmtData(l.dtfabricacao)}` : ''}</small></td>
              <td data-label="Entrada">{fmtData(l.dtentrada)}{l.entrada && <small>{dec(l.entrada.qtd)} un. · {l.entrada.fornecedor ?? 'fornecedor —'}</small>}</td>
              <td data-label="Validade">{fmtData(l.dtvalidade)}</td>
              <td className="r" data-label="Saldo">{dec(l.qtdsaldo)}</td>
              <td className="r money" data-label="Valor (custo)">{brl(l.valor)}</td>
              <td data-label="Situação">{validadePill(l)}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  )
}

function Entradas({ f }: { f: Ficha }) {
  const n = f.numeros
  if (f.entradas.length === 0) return <Empty>{f.carga.vendas ? 'Nenhuma entrada de compra registrada para este item.' : 'As notas de entrada aparecem aqui assim que a carga do ERP chegar nelas.'}</Empty>
  return (
    <>
      <div className="mini-metrics">
        <div><span>Entradas</span><strong>{int(n.entradas)}</strong></div>
        <div><span>Quantidade comprada</span><strong>{dec(n.qtd_comprada)} un.</strong></div>
        <div><span>Total comprado</span><strong>{brl(n.total_comprado)}</strong></div>
        <div><span>Custo médio</span><strong>{brl(n.custo_medio_compras)}</strong></div>
      </div>
      <div className="table-wrap cards-sm"><table><caption className="sr-only">Entradas de compra</caption>
        <thead><tr><th>Data</th><th>Fornecedor</th><th className="r">Qtd</th><th className="r">Custo un.</th><th className="r">Total</th><th>Lote / validade</th></tr></thead>
        <tbody>{f.entradas.map((e, i) => {
          const ant = f.entradas[i + 1]?.custo_unitario
          const v = e.custo_unitario !== null && ant ? (e.custo_unitario / ant - 1) * 100 : null
          return (
            <tr key={`${e.iddocumento}-${i}`}>
              <td><span className="title">{dataHora(e.datahora ?? e.data)}</span><small>Documento {e.iddocumento}</small></td>
              <td data-label="Fornecedor" className="wrap">{e.fornecedor ?? '—'}{e.natureza && <small>{e.natureza.toLowerCase()}</small>}</td>
              <td className="r" data-label="Qtd">{dec(e.qtd)}</td>
              <td className="r" data-label="Custo un.">{brl(e.custo_unitario)}{v !== null && Math.abs(v) >= 0.5 && <small className={v > 0 ? 'down' : 'up'}>{v > 0 ? '▲' : '▼'} {pct(Math.abs(v))}</small>}</td>
              <td className="r money" data-label="Total">{brl(e.total)}</td>
              <td data-label="Lote / validade">{e.lote ? `Lote ${e.lote}` : '—'}{e.dtvalidade && <small>validade {fmtData(e.dtvalidade)}</small>}</td>
            </tr>
          )
        })}</tbody></table></div>
    </>
  )
}

function Precos({ f }: { f: Ficha }) {
  const n = f.numeros
  const serie = [...f.historico_preco].reverse().filter(h => h.para !== null).map(h => ({ quando: h.datahora.slice(0, 10), preco: h.para }))
  const custos = [...f.entradas].reverse().filter(e => e.custo_unitario !== null).map(e => ({ quando: e.data, custo: e.custo_unitario }))
  return (
    <>
      <div className="mini-metrics">
        <div><span>Preço de venda</span><strong>{brl(n.preco_venda)}</strong></div>
        <div><span>Custo atual</span><strong>{brl(n.custo)}</strong></div>
        <div><span>Margem no preço</span><strong>{pct(n.margem_pct)}</strong></div>
        <div><span>Markup</span><strong>{pct(n.markup_pct)}</strong></div>
      </div>
      <p className="hint">Último reajuste do preço: {dataHora(n.preco_alterado)}. Margem no preço = (preço − custo) ÷ preço.</p>

      <section className="drawer-block">
        <h3>Alterações do preço de venda</h3>
        {!f.carga.historico_preco ? <Empty>O histórico de alterações de preço ainda está sendo carregado do ERP. Ele aparece aqui automaticamente.</Empty>
          : f.historico_preco.length === 0 ? <Empty>Nenhuma alteração de preço registrada.</Empty> : (
            <>
              {serie.length > 1 && <div style={{ height: 180, marginBottom: 12 }}>
                <ResponsiveContainer>
                  <LineChart data={serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="quando" tickFormatter={d => fmtData(d).slice(0, 5)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line-2)' }} minTickGap={20} />
                    <YAxis tickFormatter={v => brl(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={78} domain={['auto', 'auto']} />
                    <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.quando))}</strong>{brl(Number(payload[0].payload.preco))}</div> : null} />
                    <Line type="stepAfter" dataKey="preco" stroke="var(--turquoise)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>}
              <div className="table-wrap cards-sm"><table><caption className="sr-only">Alterações de preço</caption>
                <thead><tr><th>Quando</th><th className="r">De</th><th className="r">Para</th><th className="r">Variação</th></tr></thead>
                <tbody>{f.historico_preco.map((h, i) => (
                  <tr key={i}>
                    <td><span className="title">{dataHora(h.datahora)}</span>{h.tabela !== 1 && <small>Tabela {h.tabela}</small>}</td>
                    <td className="r" data-label="De">{brl(h.de)}</td>
                    <td className="r money" data-label="Para">{brl(h.para)}</td>
                    <td className="r" data-label="Variação">{h.variacao_pct === null ? '—' : <span className={h.variacao_pct > 0 ? 'up' : 'down'}>{h.variacao_pct > 0 ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />} {pct(Math.abs(h.variacao_pct))}</span>}</td>
                  </tr>
                ))}</tbody></table></div>
            </>
          )}
      </section>

      <section className="drawer-block">
        <h3>Custo nas compras</h3>
        {custos.length === 0 ? <Empty>Sem compras registradas para mostrar a evolução do custo.</Empty> : (
          <div style={{ height: 170 }}>
            <ResponsiveContainer>
              <LineChart data={custos} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="quando" tickFormatter={d => fmtData(d).slice(0, 5)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line-2)' }} minTickGap={20} />
                <YAxis tickFormatter={v => brl(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={78} domain={['auto', 'auto']} />
                <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><strong>{fmtData(String(payload[0].payload.quando))}</strong>custo {brl(Number(payload[0].payload.custo))}</div> : null} />
                <Line type="monotone" dataKey="custo" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {f.precos.length > 0 && (
        <section className="drawer-block">
          <h3>Tabelas de preço</h3>
          <div className="table-wrap"><table><thead><tr><th>Loja / tabela</th><th className="r">Preço</th><th className="r">Custo na tabela</th><th>Alterado</th></tr></thead>
            <tbody>{f.precos.map((p, i) => <tr key={i}><td>Loja {p.empresa} · tabela {p.tabela}{!p.ativo && <small>inativa</small>}</td><td className="r money">{brl(p.preco)}</td><td className="r">{brl(p.custo)}</td><td>{dataHora(p.alterado)}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </>
  )
}

function LinhaDoTempo({ f }: { f: Ficha }) {
  const [tipo, setTipo] = useState('')
  const tipos = [...new Set(f.linha_do_tempo.map(e => e.tipo))]
  const nomes: Record<string, string> = { entrada: 'Entradas', preco: 'Preço', ajuste: 'Ajustes', inventario: 'Inventário', devolucao: 'Devoluções', validade: 'Validades', vencido: 'Vencidos', venda: 'Vendas', marco: 'Marcos', cadastro: 'Cadastro', cancelado: 'Cancelados' }
  const lista = f.linha_do_tempo.filter(e => !tipo || e.tipo === tipo || (tipo === 'validade' && e.tipo === 'vencido'))
  const futuros = lista.filter(e => e.futuro), passados = lista.filter(e => !e.futuro)
  const pendente = !f.carga.historico_preco || !f.carga.historico_saldo
  const grupo = (titulo: string, evs: Evento[]) => evs.length > 0 && (
    <section className="drawer-block">
      <h3>{titulo}</h3>
      <ol className="timeline">
        {evs.map((e, i) => {
          const { icon: Icon, cor } = ICONES[e.tipo] ?? ICONES.cadastro
          return (
            <li key={i}>
              <span className={`tl-dot ${cor}`} aria-hidden><Icon size={15} /></span>
              <div>
                <div className="tl-head"><strong>{e.titulo}</strong><time dateTime={e.quando}>{dataHora(e.quando)}</time></div>
                {(e.detalhe || e.valor != null) && <p>{e.detalhe}{e.valor != null && <b> · {brl(e.valor)}</b>}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
  return (
    <>
      {pendente && <div className="notice info"><History size={18} aria-hidden /><div>Os históricos de <strong>alteração de preço</strong> e de <strong>movimentação de saldo</strong> ainda estão sendo carregados do ERP. Quando chegarem, entram nesta linha do tempo sozinhos.</div></div>}
      {tipos.length > 1 && (
        <div className="chips" style={{ marginBottom: 14 }} role="group" aria-label="Filtrar eventos">
          <button type="button" className="chip" aria-pressed={!tipo} onClick={() => setTipo('')}>Tudo</button>
          {tipos.filter(t => t !== 'vencido' || !tipos.includes('validade')).map(t => <button key={t} type="button" className="chip" aria-pressed={tipo === t} onClick={() => setTipo(t)}>{nomes[t] ?? t}</button>)}
        </div>
      )}
      {lista.length === 0 ? <Empty>Nenhum evento registrado.</Empty> : <>{grupo('Próximos', [...futuros].reverse())}{grupo('Histórico', passados)}</>}
    </>
  )
}

export default function ProdutoPainel() {
  const [sp, setSp] = useSearchParams()
  const id = sp.get('item')
  const valido = id && /^\d{1,12}$/.test(id) ? id : null
  const [aba, setAba] = useState<Aba>('geral')
  const fechar = useRef<HTMLButtonElement>(null)
  const { data: f, error, reload } = useApi<Ficha>(valido ? `dash/produto?id=${valido}` : null)
  const atual = f && String(f.item.id) === valido ? f : null

  const close = () => setSp(prev => { const n = new URLSearchParams(prev); n.delete('item'); return n })

  useEffect(() => {
    if (!valido) return
    setAba('geral')
    const antes = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); antes?.focus?.() }
  }, [valido]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!valido) return null
  const n = atual?.numeros
  const s = atual?.item.situacao ? situacao(atual.item.situacao) : null
  const lotesAtivos = atual?.lotes.filter(l => l.qtdsaldo > 0).length ?? 0

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={close} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ficha-titulo">
        <header className="drawer-head">
          <div>
            <span className="eyebrow">Ficha do item · código {valido}</span>
            <h2 id="ficha-titulo">{atual?.item.descricao ?? 'Carregando…'}</h2>
            {atual && <p className="drawer-sub">
              {atual.item.codigobarras && <button type="button" className="copy" onClick={() => navigator.clipboard?.writeText(atual.item.codigobarras!)} title="Copiar código de barras"><Copy size={13} aria-hidden />{atual.item.codigobarras}</button>}
              {[atual.item.marca, atual.item.embalagem, atual.item.secao].filter(Boolean).join(' · ')}
              {s && <span className="tag"><i style={{ background: s.cor }} aria-hidden />{s.nome}</span>}
            </p>}
          </div>
          <button ref={fechar} type="button" className="drawer-close" onClick={close} aria-label="Fechar ficha"><X size={20} aria-hidden /></button>
        </header>

        <div className="drawer-body">
          {error ? <ErrorState message={error} onRetry={reload} /> : !atual || !n ? <Loading rows={8} /> : (
            <>
              <div className="metrics compact">
                <Metric icon={<Box size={16} />} tone="turquoise" label="Estoque" value={`${dec(n.estoque)} un.`} detail={`${brl(n.valor_estoque)} a custo`} />
                <Metric icon={<DollarSign size={16} />} tone="gold" label="Custo unitário" value={brl(n.custo)} detail={n.custo_medio_compras !== null ? `média das compras ${brl(n.custo_medio_compras)}` : 'custo médio do ERP'} />
                <Metric icon={<Receipt size={16} />} tone="purple" label="Preço de venda" value={brl(n.preco_venda)} detail={n.margem_pct !== null ? `margem ${pct(n.margem_pct)}` : 'sem custo para margem'} />
                <Metric icon={<TrendingUp size={16} />} tone="green" label="Vendido 90 dias" value={`${dec(n.qtd_90d)} un.`} detail={n.ultima_venda ? `última venda ${fmtData(n.ultima_venda)}` : 'sem vendas registradas'} />
              </div>
              <div className="drawer-tabs">
                <Tabs<Aba> label="Seções da ficha" value={aba} onChange={setAba} options={[
                  { id: 'geral', label: 'Visão geral' },
                  { id: 'lotes', label: `Lotes${lotesAtivos ? ` (${lotesAtivos})` : ''}` },
                  { id: 'entradas', label: `Entradas${atual.entradas.length ? ` (${atual.entradas.length})` : ''}` },
                  { id: 'precos', label: 'Preços' },
                  { id: 'tempo', label: 'Linha do tempo' },
                ]} />
              </div>
              {aba === 'geral' && <Geral f={atual} />}
              {aba === 'lotes' && <Lotes f={atual} />}
              {aba === 'entradas' && <Entradas f={atual} />}
              {aba === 'precos' && <Precos f={atual} />}
              {aba === 'tempo' && <LinhaDoTempo f={atual} />}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
