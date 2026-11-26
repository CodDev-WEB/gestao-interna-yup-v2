// Ficha do cliente: abre por cima de qualquer tela quando a URL tem ?cliente=ID (link compartilhável; Esc fecha).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CalendarClock, Clock, HeartPulse, Info, Lightbulb, ShoppingBasket, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react'
import { useApi } from './api'
import { brl, brlCurto, data as fmtData, dec, int, mes, pct } from './format'
import { SETOR_COR } from './labels'
import { ItemLink } from './ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, Tabs } from './ui'

type Item = { id: number; nome: string | null; setor: string | null; qtd: number; valor: number; vezes: number; margem_pct: number | null; primeira: string; ultima: string; dias_sem_comprar: number; intervalo_dias: number | null; proxima_prevista: string | null; qtd_por_compra: number; status: 'em_dia' | 'atrasado' | 'parou' | 'eventual' }
type Ficha = {
  referencia: { data: string; vendas_completas: boolean }
  cliente: { id: number; nome: string; tipo: string | null; cadastro: string | null; cliente_desde: string | null; inativo_no_erp: boolean; segmento: string | null }
  metricas: {
    total: number; compras: number; ticket_medio: number | null; primeira: string | null; ultima: string | null; dias_sem_comprar: number | null; intervalo_dias: number | null
    atraso_dias: number | null; risco: 'baixo' | 'medio' | 'alto' | 'perdido' | 'sem_compras'; proxima_prevista: string | null; valor_mensal_6m: number
    valor_90d: number; valor_90d_anterior: number; variacao_90d_pct: number | null; ticket_90d: number | null; ticket_90d_anterior: number | null
    margem_pct: number | null; desconto_pct: number | null; devolvido: number; itens_por_compra: number | null; produtos_diferentes: number
    dia_preferido: string | null; hora_preferida: number | null; vendedor_principal: string | null; setores: { setor: string; valor: number; pct: number }[]
  }
  itens: Item[]
  cesta: { id: number; nome: string | null; meses: number; presenca_pct: number; qtd_mes: number; valor_mes: number }[]
  meses: { mes: string; valor: number; compras: number; itens: number; principal: { id: number; nome: string | null; valor: number } | null }[]
  compras: { iddocumento: number; data: string; datahora: string; valor: number; itens: number; desconto: number; vendedor: string | null }[]
  sugestoes: { tipo: 'alta' | 'media' | 'info'; texto: string; item?: number }[]
}
type Aba = 'geral' | 'itens' | 'meses' | 'compras'

const RISCO = {
  baixo: { nome: 'Em dia', cls: 'good', texto: 'Comprando no ritmo de sempre.' },
  medio: { nome: 'Atrasado', cls: 'warn', texto: 'Passou do intervalo habitual de compra.' },
  alto: { nome: 'Em risco', cls: 'bad', texto: 'Passou do dobro do intervalo habitual.' },
  perdido: { nome: 'Perdido', cls: 'bad', texto: 'Mais de 180 dias sem comprar.' },
  sem_compras: { nome: 'Sem compras', cls: 'neutral', texto: 'Nenhuma venda identificada para este cliente.' },
} as const
const STATUS_ITEM = { em_dia: ['Em dia', 'good'], atrasado: ['Atrasado', 'warn'], parou: ['Parou', 'bad'], eventual: ['Eventual', 'neutral'] } as const

/** Abre a ficha do cliente mantendo a página e os filtros. */
export function ClienteLink({ id, children }: { id: number | string; children: ReactNode }) {
  const [, setSp] = useSearchParams()
  return <button type="button" className="item-link" title="Abrir ficha do cliente" onClick={() => setSp(prev => { const n = new URLSearchParams(prev); n.set('cliente', String(id)); return n })}>{children}</button>
}

function Geral({ f }: { f: Ficha }) {
  const m = f.metricas
  const r = RISCO[m.risco]
  const generico = m.compras > 1000
  return (
    <>
      {generico && <div className="notice info"><Info size={18} aria-hidden /><div>Com {int(m.compras)} compras, este cadastro parece ser usado para vendas de balcão (cliente genérico). Os números servem para a loja, não para uma pessoa.</div></div>}
      {!f.referencia.vendas_completas && <div className="notice"><Clock size={18} aria-hidden /><div>As vendas estão carregadas até {fmtData(f.referencia.data)}; atrasos são medidos até essa data.</div></div>}
      <section className="drawer-block">
        <h3>Sugestões para não perder este cliente</h3>
        {f.sugestoes.length === 0 ? <Empty>Nada pedindo ação: o cliente está comprando no ritmo dele.</Empty> : (
          <ul className="inset compacto">
            {f.sugestoes.map((s, i) => (
              <li key={i}><div className="row">
                <span className={`row-icon ${s.tipo}`} aria-hidden>{s.tipo === 'info' ? <Lightbulb size={15} /> : <AlertTriangle size={15} />}</span>
                <span className="row-main"><span style={{ color: 'var(--ink)', fontSize: 14 }}>{s.texto}</span></span>
              </div></li>
            ))}
          </ul>
        )}
      </section>
      <section className="drawer-block">
        <h3>Relacionamento</h3>
        <dl className="kv">
          <div><dt>Situação</dt><dd><span className={`pill ${r.cls}`}>{r.nome}</span><small>{r.texto}</small></dd></div>
          <div><dt>Compra a cada</dt><dd>{m.intervalo_dias ? (m.intervalo_dias === 1 ? '1 dia' : `${int(m.intervalo_dias)} dias`) : '—'}</dd></div>
          <div><dt>Próxima compra prevista</dt><dd>{fmtData(m.proxima_prevista)}{m.atraso_dias !== null && m.atraso_dias > 0 && <small className="status-bad">{int(m.atraso_dias)} dias de atraso</small>}</dd></div>
          <div><dt>Cliente desde</dt><dd>{fmtData(f.cliente.cliente_desde ?? m.primeira)}</dd></div>
          <div><dt>Primeira e última compra</dt><dd>{fmtData(m.primeira)} e {fmtData(m.ultima)}</dd></div>
          <div><dt>Quem mais atende</dt><dd>{m.vendedor_principal ?? '—'}</dd></div>
          <div><dt>Dia e hora preferidos</dt><dd>{m.dia_preferido ? `${m.dia_preferido}, por volta das ${m.hora_preferida}h` : '—'}</dd></div>
          <div><dt>Itens por compra</dt><dd>{dec(m.itens_por_compra)}</dd></div>
          <div><dt>Produtos diferentes</dt><dd>{int(m.produtos_diferentes)}</dd></div>
        </dl>
      </section>
      <section className="drawer-block">
        <h3>Gasto</h3>
        <dl className="kv">
          <div><dt>Últimos 90 dias</dt><dd>{brl(m.valor_90d)}{m.variacao_90d_pct !== null && <small className={m.variacao_90d_pct >= 0 ? 'up' : 'down'}>{m.variacao_90d_pct >= 0 ? '▲' : '▼'} {pct(Math.abs(m.variacao_90d_pct))} vs. 90 dias anteriores</small>}</dd></div>
          <div><dt>Ticket médio (90 dias)</dt><dd>{brl(m.ticket_90d)}<small>antes: {brl(m.ticket_90d_anterior)}</small></dd></div>
          <div><dt>Margem que deixa</dt><dd>{pct(m.margem_pct)}</dd></div>
          <div><dt>Desconto médio</dt><dd>{pct(m.desconto_pct)}</dd></div>
          <div><dt>Devoluções</dt><dd>{brl(m.devolvido)}</dd></div>
          <div><dt>Total na história</dt><dd>{brl(m.total)}</dd></div>
        </dl>
        {m.setores.length > 0 && <>
          <div className="stock-bar" style={{ marginTop: 16 }} role="img" aria-label="Gasto por setor">{m.setores.filter(s => s.valor > 0).map(s => <i key={s.setor} style={{ flex: `${s.valor} 0 0`, background: SETOR_COR[s.setor] ?? 'var(--s-outro)' }} title={`${s.setor}: ${brl(s.valor)}`} />)}</div>
          <p className="hint" style={{ margin: 0 }}>{m.setores.filter(s => s.valor > 0).map(s => `${s.setor} ${pct(s.pct, 0)}`).join(', ')}</p>
        </>}
      </section>
      {f.cesta.length > 0 && (
        <section className="drawer-block">
          <h3>Compra típica do mês</h3>
          <p className="hint">Itens que aparecem em boa parte dos meses em que o cliente compra.</p>
          <ul className="inset compacto">
            {f.cesta.map(c => (
              <li key={c.id}><div className="row">
                <span className="row-icon info" aria-hidden><ShoppingBasket size={15} /></span>
                <span className="row-main"><ItemLink id={c.id}>{c.nome ?? `Item ${c.id}`}</ItemLink><span>em {pct(c.presenca_pct, 0)} dos meses, {dec(c.qtd_mes)} un. por mês</span></span>
                <span className="row-val">{brl(c.valor_mes)}<small>por mês</small></span>
              </div></li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Itens({ f }: { f: Ficha }) {
  const [filtro, setFiltro] = useState<'todos' | 'recorrentes' | 'atrasados'>('todos')
  const lista = f.itens.filter(i => filtro === 'todos' || (filtro === 'recorrentes' ? i.status !== 'eventual' : i.status === 'atrasado' || i.status === 'parou'))
  if (!f.itens.length) return <Empty>Nenhum item comprado.</Empty>
  return (
    <>
      <div className="controls">
        <Tabs label="Mostrar" value={filtro} onChange={setFiltro} options={[{ id: 'todos', label: 'Todos' }, { id: 'recorrentes', label: 'Recorrentes' }, { id: 'atrasados', label: 'Atrasados ou parados' }]} />
      </div>
      {lista.length === 0 ? <Empty>Nenhum item neste filtro.</Empty> : (
        <div className="table-wrap cards-sm"><table><caption className="sr-only">Itens que o cliente compra</caption>
          <thead><tr><th>Item</th><th className="r">Total</th><th className="r">Vezes</th><th className="r">Compra a cada</th><th>Última</th><th>Recompra</th></tr></thead>
          <tbody>{lista.map(i => { const [nome, cls] = STATUS_ITEM[i.status]; return (
            <tr key={i.id}>
              <td className="wrap"><ItemLink id={i.id}>{i.nome ?? `Item ${i.id}`}</ItemLink><small>{i.setor ?? 'sem setor'}, {dec(i.qtd_por_compra)} un. por compra{i.margem_pct !== null ? `, margem ${pct(i.margem_pct, 0)}` : ''}</small></td>
              <td className="r money" data-label="Total">{brl(i.valor)}<small>{dec(i.qtd)} un.</small></td>
              <td className="r" data-label="Vezes">{int(i.vezes)}</td>
              <td className="r" data-label="Compra a cada">{i.intervalo_dias ? `${int(i.intervalo_dias)} dias` : '—'}</td>
              <td data-label="Última">{fmtData(i.ultima)}<small>há {int(i.dias_sem_comprar)} dias</small></td>
              <td data-label="Recompra"><span className={`pill ${cls}`}>{nome}</span>{i.status === 'atrasado' && i.proxima_prevista && <small>era para {fmtData(i.proxima_prevista)}</small>}</td>
            </tr>
          ) })}</tbody></table></div>
      )}
    </>
  )
}

function Meses({ f }: { f: Ficha }) {
  if (f.meses.every(m => m.valor === 0)) return <Empty>Sem compras nos últimos 12 meses.</Empty>
  return (
    <>
      <section className="drawer-block">
        <h3>Gasto por mês</h3>
        <div style={{ height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={f.meses} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="mes" tickFormatter={x => mes(x + '-01')} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} interval={1} />
              <YAxis tickFormatter={v => brlCurto(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
              <Tooltip cursor={{ fill: '#0000000a' }} content={({ active, payload }) => active && payload?.length ? (
                <div className="chart-tip"><strong>{mes(payload[0].payload.mes + '-01')}</strong>{brl(payload[0].payload.valor)} em {int(payload[0].payload.compras)} compras</div>
              ) : null} />
              <Bar dataKey="valor" fill="var(--turquoise)" radius={[5, 5, 0, 0]} maxBarSize={26} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="table-wrap cards-sm"><table><caption className="sr-only">Principal compra de cada mês</caption>
        <thead><tr><th>Mês</th><th className="r">Gasto</th><th className="r">Compras</th><th>Principal compra</th></tr></thead>
        <tbody>{[...f.meses].reverse().filter(m => m.valor > 0).map(m => (
          <tr key={m.mes}>
            <td><span className="title">{mes(m.mes + '-01')}</span></td>
            <td className="r money" data-label="Gasto">{brl(m.valor)}</td>
            <td className="r" data-label="Compras">{int(m.compras)}</td>
            <td className="wrap" data-label="Principal compra">{m.principal ? <><ItemLink id={m.principal.id}>{m.principal.nome ?? `Item ${m.principal.id}`}</ItemLink><small>{brl(m.principal.valor)}</small></> : '—'}</td>
          </tr>
        ))}</tbody></table></div>
    </>
  )
}

function Compras({ f }: { f: Ficha }) {
  if (!f.compras.length) return <Empty>Nenhuma compra.</Empty>
  return (
    <div className="table-wrap cards-sm"><table><caption className="sr-only">Últimas compras</caption>
      <thead><tr><th>Quando</th><th className="r">Valor</th><th className="r">Itens</th><th className="r">Desconto</th><th>Atendido por</th></tr></thead>
      <tbody>{f.compras.map(c => (
        <tr key={c.iddocumento}>
          <td><span className="title">{fmtData(c.data)}</span><small>documento {c.iddocumento}</small></td>
          <td className="r money" data-label="Valor">{brl(c.valor)}</td>
          <td className="r" data-label="Itens">{dec(c.itens)}</td>
          <td className="r" data-label="Desconto">{c.desconto > 0 ? brl(c.desconto) : '—'}</td>
          <td data-label="Atendido por">{c.vendedor ?? '—'}</td>
        </tr>
      ))}</tbody></table></div>
  )
}

export default function ClientePainel() {
  const [sp, setSp] = useSearchParams()
  const id = sp.get('cliente')
  const valido = id && /^\d{1,12}$/.test(id) ? id : null
  const [aba, setAba] = useState<Aba>('geral')
  const fechar = useRef<HTMLButtonElement>(null)
  const { data: f, error, reload } = useApi<Ficha>(valido ? `dash/cliente?id=${valido}` : null)
  const atual = f && String(f.cliente.id) === valido ? f : null
  const close = () => setSp(prev => { const n = new URLSearchParams(prev); n.delete('cliente'); return n })

  useEffect(() => {
    if (!valido) return
    setAba('geral')
    const antes = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    // Com a ficha do item aberta por cima, o Esc fecha só ela.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !new URLSearchParams(window.location.search).has('item')) close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = document.querySelector('.drawer-root') ? 'hidden' : ''; window.removeEventListener('keydown', onKey); antes?.focus?.() }
  }, [valido]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!valido) return null
  const m = atual?.metricas
  const r = m ? RISCO[m.risco] : null
  const atrasados = atual?.itens.filter(i => i.status === 'atrasado' || i.status === 'parou').length ?? 0

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={close} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="cli-titulo">
        <header className="drawer-head">
          <div>
            <span className="eyebrow">Ficha do cliente, código {valido}</span>
            <h2 id="cli-titulo">{atual?.cliente.nome ?? 'Carregando…'}</h2>
            {atual && m && r && <p className="drawer-sub">
              <span className={`pill ${r.cls}`}>{r.nome}</span>
              {m.dias_sem_comprar !== null && <span>{m.dias_sem_comprar === 0 ? 'comprou hoje' : m.dias_sem_comprar === 1 ? 'comprou ontem' : `${int(m.dias_sem_comprar)} dias sem comprar`}</span>}
              {atual.cliente.inativo_no_erp && <span className="pill neutral">inativo no ERP</span>}
            </p>}
          </div>
          <button ref={fechar} type="button" className="drawer-close" onClick={close} aria-label="Fechar ficha"><X size={20} aria-hidden /></button>
        </header>
        <div className="drawer-body">
          {error ? <ErrorState message={error} onRetry={reload} /> : !atual || !m ? <Loading rows={8} /> : (
            <>
              <div className="metrics compact">
                <Metric icon={<Wallet size={16} />} tone="gold" label="Gasto por mês" value={brl(m.valor_mensal_6m)} detail="média dos últimos 6 meses" />
                <Metric icon={m.variacao_90d_pct !== null && m.variacao_90d_pct < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />} tone={m.variacao_90d_pct !== null && m.variacao_90d_pct < -20 ? 'red' : 'green'} label="Últimos 90 dias" value={brl(m.valor_90d)} detail={m.variacao_90d_pct === null ? 'sem base anterior' : `${m.variacao_90d_pct >= 0 ? '+' : ''}${pct(m.variacao_90d_pct, 0)} vs. 90 dias antes`} />
                <Metric icon={<CalendarClock size={16} />} tone={m.risco === 'baixo' ? 'turquoise' : 'red'} label="Compra a cada" value={m.intervalo_dias ? (m.intervalo_dias === 1 ? '1 dia' : `${int(m.intervalo_dias)} dias`) : '—'} detail={m.atraso_dias !== null && m.atraso_dias > 0 ? `${int(m.atraso_dias)} dias de atraso` : `próxima ${fmtData(m.proxima_prevista)}`} />
                <Metric icon={<HeartPulse size={16} />} tone="purple" label="Ticket médio" value={brl(m.ticket_medio)} detail={`${int(m.compras)} compras, ${brl(m.total)} no total`} />
              </div>
              <div className="drawer-tabs">
                <Tabs<Aba> label="Seções da ficha" value={aba} onChange={setAba} options={[
                  { id: 'geral', label: 'Visão geral' },
                  { id: 'itens', label: `Itens${atrasados ? ` (${atrasados} atrasados)` : ''}` },
                  { id: 'meses', label: 'Mês a mês' },
                  { id: 'compras', label: 'Compras' },
                ]} />
              </div>
              {aba === 'geral' && <Geral f={atual} />}
              {aba === 'itens' && <Itens f={atual} />}
              {aba === 'meses' && <Meses f={atual} />}
              {aba === 'compras' && <Compras f={atual} />}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

