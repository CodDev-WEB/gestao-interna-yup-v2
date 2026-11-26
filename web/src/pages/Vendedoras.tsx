// Vendedoras: o que cada uma vendeu no período (bruto, desconto, líquido, custo, lucro), as devoluções dos itens
// que ela vendeu e o que ela mesma comprou como cliente. Clicar no nome abre a ficha (?vendedora=ID).
// Os totais da tabela são somados em centavos inteiros (sem erro de arredondamento).

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgeDollarSign, Receipt, ShoppingBag, Undo2, Users, X } from 'lucide-react'
import { useApi } from '../api'
import { brl, data as fmtData, dec, int, mes as fmtMes, pct } from '../format'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, PageHead, Tabs } from '../ui'

type V = {
  id: number; nome: string; vendas: number; itens: number; qtd: number; bruto: number; desconto: number; liquido: number; custo: number; lucro: number
  clientes: number; itens_sem_custo: number; devolucoes: number; devolvido: number; compras: number; itens_comprados: number; comprado: number; desconto_recebido: number
}
type Resp = {
  de: string; ate: string; empresa: number | null; vendedoras: V[]
  totais: { vendas: number; vendas_por_vendedora: number; vendas_por_vendedora_dia: number; liquido: number; devolvido: number; devolucoes: number }
  empresas: { id: number; vendas: number; liquido: number }[]
}
type ItemV = { id: number; descricao: string | null; vendas?: number; compras?: number; qtd: number; bruto: number; desconto: number; liquido: number; custo?: number; lucro?: number }
type Ficha = {
  de: string; ate: string; id: number; nome: string
  vendidos: ItemV[]; comprados: ItemV[]
  compras: { iddocumento: number; datahora: string; itens: number; bruto: number; desconto: number; liquido: number; atendida_por: string }[]
  devolucoes: { iddocumento: number; datahora: string; itens: number; valor: number }[]
  meses: { mes: string; vendido: number | null; vendas: number; comprado: number | null }[]
}

/** Soma em centavos inteiros e volta para reais. */
const soma = <T,>(xs: T[], f: (x: T) => number | null | undefined) => xs.reduce((a, x) => a + Math.round((f(x) ?? 0) * 100), 0) / 100
const acrescimo = (x: { bruto: number; desconto: number; liquido: number }) => Math.round((x.liquido - x.bruto + x.desconto) * 100) / 100

function hoje() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date()) }
function periodo(p: string): [string, string] {
  const h = hoje(), [y, m] = h.split('-').map(Number)
  const d = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10)
  switch (p) {
    case 'mes_passado': return [d(y, m - 1, 1), d(y, m, 0)]
    case '90d': return [d(y, m, Number(h.slice(8)) - 89), h]
    case 'ano': return [`${y}-01-01`, h]
    case '12m': return [d(y, m - 11, 1), h]
    default: return [d(y, m, 1), h]
  }
}
const PERIODOS = [{ id: 'mes', label: 'Este mês' }, { id: 'mes_passado', label: 'Mês passado' }, { id: '90d', label: '90 dias' }, { id: 'ano', label: 'Este ano' }, { id: '12m', label: '12 meses' }]

export default function Vendedoras() {
  const [sp, setSp] = useSearchParams()
  const p = sp.get('periodo') ?? 'mes'
  const [de0, ate0] = periodo(p)
  const de = sp.get('de') ?? de0, ate = sp.get('ate') ?? ate0
  const empresa = sp.get('empresa') ?? ''
  const set = (k: Record<string, string | null>) => setSp(prev => { const n = new URLSearchParams(prev); for (const [a, b] of Object.entries(k)) b === null ? n.delete(a) : n.set(a, b); return n }, { replace: true })
  const { data: r, error, loading, reload } = useApi<Resp>(`dash/vendedoras?de=${de}&ate=${ate}${empresa ? `&empresa=${empresa}` : ''}`)
  const lista = r?.vendedoras ?? []
  const equipe = lista.filter(v => v.id !== 0)
  const tot = {
    vendas: r?.totais.vendas ?? 0, liquido: soma(lista, v => v.liquido), bruto: soma(lista, v => v.bruto), desconto: soma(lista, v => v.desconto),
    custo: soma(lista, v => v.custo), lucro: soma(lista, v => v.lucro), devolvido: soma(lista, v => v.devolvido), devolucoes: soma(lista, v => v.devolucoes),
    comprado: soma(lista, v => v.comprado), compras: soma(lista, v => v.compras), itens: soma(lista, v => v.itens),
  }
  const abrir = (id: number) => set({ vendedora: String(id) })

  return (
    <>
      <PageHead section="Equipe" title="Vendedoras">
        O que cada vendedora vendeu, quanto voltou em devolução e o que ela mesma comprou na loja. Valores ao centavo, pelos mesmos critérios do resto do sistema.
      </PageHead>
      <div className="toolbar">
        <Tabs label="Período" value={sp.get('de') ? 'livre' : p} onChange={v => set({ periodo: v, de: null, ate: null })} options={PERIODOS} />
        {(r?.empresas.length ?? 0) > 1 && <label className="field-inline">Loja <select className="select" value={empresa} onChange={e => set({ empresa: e.target.value || null })}>
          <option value="">Todas</option>{r!.empresas.map(x => <option key={x.id} value={x.id}>Empresa {x.id} ({int(x.vendas)} vendas)</option>)}</select></label>}
        <label className="field-inline">De <input className="input" type="date" value={de} max={ate} onChange={e => e.target.value && set({ de: e.target.value, ate })} /></label>
        <label className="field-inline">Até <input className="input" type="date" value={ate} min={de} onChange={e => e.target.value && set({ de, ate: e.target.value })} /></label>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !r ? <Loading rows={8} /> : (
        <div aria-busy={loading || undefined}>
          <div className="metrics">
            <Metric icon={<BadgeDollarSign size={18} />} tone="gold" label="Vendido (líquido)" value={brl(tot.liquido)} detail={`${int(tot.vendas)} vendas, ${int(tot.itens)} itens`} />
            <Metric icon={<Receipt size={18} />} tone="green" label="Lucro bruto" value={brl(tot.lucro)} detail={tot.liquido ? `margem ${pct(tot.lucro / tot.liquido * 100)}` : '—'} />
            <Metric icon={<Undo2 size={18} />} tone="red" label="Devoluções" value={brl(tot.devolvido)} detail={`${int(tot.devolucoes)} devoluções`} />
            <Metric icon={<ShoppingBag size={18} />} tone="purple" label="Compras da equipe" value={brl(tot.comprado)} detail={`${int(tot.compras)} compras feitas por vendedoras`} />
          </div>
          <section className="aud-card" style={{ marginBottom: 18 }} aria-label="Comparação com o Gestão à Vista">
            <h3>Para comparar com o Gestão à Vista</h3>
            <div className="table-wrap"><table><caption className="sr-only">Mesmos números em cada critério</caption>
              <thead><tr><th /><th className="r">Este sistema</th><th className="r">Critério do Gestão à Vista</th></tr></thead>
              <tbody>
                <tr><th scope="row">Faturamento</th><td className="r money">{brl(tot.liquido)}<small>líquido dos itens</small></td><td className="r money">{brl(Math.round((r.totais.liquido - r.totais.devolvido) * 100) / 100)}<small>líquido − devoluções ({brl(r.totais.devolvido)})</small></td></tr>
                <tr><th scope="row">Vendas</th><td className="r">{int(r.totais.vendas)}<small>cada venda uma vez</small></td><td className="r">{int(r.totais.vendas_por_vendedora_dia)}<small>uma por vendedora em cada venda</small></td></tr>
              </tbody></table></div>
            <p className="hint">O Gestão à Vista mostra só a loja dele{empresa ? '' : ' (escolha a loja acima)'}, desconta as devoluções do faturamento e conta a venda feita por duas vendedoras duas vezes. Ele também só mostra vendedoras cadastradas nele e pode estar alguns minutos atrás.</p>
          </section>
          {!lista.length ? <Empty>Nenhuma venda no período.</Empty> : (
            <div className="table-wrap cards-sm"><table>
              <caption className="sr-only">Vendas por vendedora</caption>
              <thead><tr>
                <th>Vendedora</th><th className="r">Vendas</th><th className="r">Bruto</th><th className="r">Desconto</th><th className="r">Acréscimo</th><th className="r">Líquido</th>
                <th className="r">Custo</th><th className="r">Lucro</th><th className="r">Margem</th><th className="r">Ticket</th><th className="r">Devolvido</th><th className="r">Comprou</th>
              </tr></thead>
              <tbody>
                {lista.map(v => (
                  <tr key={v.id}>
                    <td><button type="button" className="item-link" onClick={() => abrir(v.id)}>{v.nome}</button>
                      <small>{v.id ? `código ${v.id} · ` : ''}{int(v.clientes)} clientes{v.itens_sem_custo ? ` · ${int(v.itens_sem_custo)} itens sem custo` : ''}</small></td>
                    <td className="r" data-label="Vendas">{int(v.vendas)}</td>
                    <td className="r money" data-label="Bruto">{brl(v.bruto)}</td>
                    <td className="r money" data-label="Desconto">{brl(v.desconto)}</td>
                    <td className="r money" data-label="Acréscimo">{brl(acrescimo(v))}</td>
                    <td className="r money" data-label="Líquido"><b>{brl(v.liquido)}</b></td>
                    <td className="r money" data-label="Custo">{brl(v.custo)}</td>
                    <td className="r money" data-label="Lucro">{brl(v.lucro)}</td>
                    <td className="r" data-label="Margem">{v.liquido ? pct(v.lucro / v.liquido * 100) : '—'}</td>
                    <td className="r money" data-label="Ticket">{v.vendas ? brl(Math.round(v.liquido / v.vendas * 100) / 100) : '—'}</td>
                    <td className="r money" data-label="Devolvido">{v.devolvido ? brl(v.devolvido) : '—'}</td>
                    <td className="r money" data-label="Comprou">{v.id && v.comprado ? <button type="button" className="item-link" onClick={() => abrir(v.id)}>{brl(v.comprado)}</button> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <th>Total ({equipe.length} vendedoras)<small>{int(tot.vendas)} vendas diferentes; somando cada vendedora dá {int(r.totais.vendas_por_vendedora)}</small></th><td className="r">{int(tot.vendas)}</td><td className="r money">{brl(tot.bruto)}</td><td className="r money">{brl(tot.desconto)}</td>
                <td className="r money">{brl(Math.round((tot.liquido - tot.bruto + tot.desconto) * 100) / 100)}</td><td className="r money"><b>{brl(tot.liquido)}</b></td>
                <td className="r money">{brl(tot.custo)}</td><td className="r money">{brl(tot.lucro)}</td><td className="r">{tot.liquido ? pct(tot.lucro / tot.liquido * 100) : '—'}</td>
                <td className="r money">{tot.vendas ? brl(Math.round(tot.liquido / tot.vendas * 100) / 100) : '—'}</td><td className="r money">{brl(tot.devolvido)}</td><td className="r money">{brl(tot.comprado)}</td>
              </tr></tfoot>
            </table></div>
          )}
          <p className="hint">Líquido = bruto − desconto + acréscimo, item a item, como no ERP. Uma venda com itens de duas vendedoras aparece na linha de cada uma, mas no total conta uma vez só. "Comprou" são vendas em que o cliente é a própria vendedora.</p>
        </div>
      )}
      <FichaVendedora de={de} ate={ate} />
    </>
  )
}

type Aba = 'vendidos' | 'comprados' | 'compras' | 'devolucoes' | 'meses'

function FichaVendedora({ de, ate }: { de: string; ate: string }) {
  const [sp, setSp] = useSearchParams()
  const id = sp.get('vendedora')
  const valido = id && /^\d{1,10}$/.test(id) ? id : null
  const [aba, setAba] = useState<Aba>('vendidos')
  const fechar = useRef<HTMLButtonElement>(null)
  const { data: f, error, reload } = useApi<Ficha>(valido ? `dash/vendedora?id=${valido}&de=${de}&ate=${ate}` : null)
  const atual = f && String(f.id) === valido && f.de === de && f.ate === ate ? f : null
  const close = () => setSp(prev => { const n = new URLSearchParams(prev); n.delete('vendedora'); return n })
  useEffect(() => {
    if (!valido) return
    setAba('vendidos')
    const antes = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    // Com a ficha do item aberta por cima, o Esc fecha só ela.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !new URLSearchParams(window.location.search).has('item')) close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = document.querySelector('.drawer-root') ? 'hidden' : ''; window.removeEventListener('keydown', onKey); antes?.focus?.() }
  }, [valido]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!valido) return null
  const vend = atual ? soma(atual.vendidos, x => x.liquido) : 0
  const comp = atual ? soma(atual.comprados, x => x.liquido) : 0

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={close} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="vend-titulo">
        <header className="drawer-head">
          <div>
            <span className="eyebrow">Vendedora{valido !== '0' ? `, código ${valido}` : ''} · {fmtData(de)} a {fmtData(ate)}</span>
            <h2 id="vend-titulo">{atual?.nome ?? 'Carregando…'}</h2>
          </div>
          <button ref={fechar} type="button" className="drawer-close" onClick={close} aria-label="Fechar ficha"><X size={20} aria-hidden /></button>
        </header>
        <div className="drawer-body">
          {error ? <ErrorState message={error} onRetry={reload} /> : !atual ? <Loading rows={8} /> : (
            <>
              <div className="metrics compact">
                <Metric icon={<BadgeDollarSign size={16} />} tone="gold" label="Vendeu" value={brl(vend)} detail={`${int(atual.vendidos.length)} produtos diferentes`} />
                <Metric icon={<Receipt size={16} />} tone="green" label="Lucro" value={brl(soma(atual.vendidos, x => x.lucro))} detail={`custo ${brl(soma(atual.vendidos, x => x.custo))}`} />
                <Metric icon={<Undo2 size={16} />} tone="red" label="Devolvido" value={brl(soma(atual.devolucoes, x => x.valor))} detail={`${int(atual.devolucoes.length)} devoluções`} />
                <Metric icon={<Users size={16} />} tone="purple" label="Comprou para si" value={brl(comp)} detail={`${int(atual.compras.length)} compras`} />
              </div>
              <div className="drawer-tabs">
                <Tabs<Aba> abas label="Seções da ficha" value={aba} onChange={setAba} options={[
                  { id: 'vendidos', label: 'O que vendeu' },
                  { id: 'comprados', label: 'O que comprou' },
                  { id: 'compras', label: 'Compras dela' },
                  { id: 'devolucoes', label: 'Devoluções' },
                  { id: 'meses', label: 'Mês a mês' },
                ]} />
              </div>
              {aba === 'vendidos' && <Itens itens={atual.vendidos} lucro vazio="Nenhuma venda no período." />}
              {aba === 'comprados' && <Itens itens={atual.comprados} vazio="Ela não comprou nada no período." />}
              {aba === 'compras' && (!atual.compras.length ? <Empty>Nenhuma compra no período.</Empty> : (
                <div className="table-wrap cards-sm"><table><caption className="sr-only">Compras feitas pela vendedora</caption>
                  <thead><tr><th>Quando</th><th className="r">Itens</th><th className="r">Bruto</th><th className="r">Desconto</th><th className="r">Pago</th><th>Atendida por</th></tr></thead>
                  <tbody>{atual.compras.map(c => (
                    <tr key={c.iddocumento}>
                      <td><span className="title">{fmtData(c.datahora)}</span><small>documento {c.iddocumento}</small></td>
                      <td className="r" data-label="Itens">{int(c.itens)}</td>
                      <td className="r money" data-label="Bruto">{brl(c.bruto)}</td>
                      <td className="r money" data-label="Desconto">{c.desconto ? brl(c.desconto) : '—'}</td>
                      <td className="r money" data-label="Pago"><b>{brl(c.liquido)}</b></td>
                      <td data-label="Atendida por">{c.atendida_por}</td>
                    </tr>))}</tbody>
                  <tfoot><tr><th>Total</th><td className="r">{int(soma(atual.compras, c => c.itens))}</td><td className="r money">{brl(soma(atual.compras, c => c.bruto))}</td><td className="r money">{brl(soma(atual.compras, c => c.desconto))}</td><td className="r money"><b>{brl(soma(atual.compras, c => c.liquido))}</b></td><td /></tr></tfoot>
                </table></div>))}
              {aba === 'devolucoes' && (!atual.devolucoes.length ? <Empty>Nenhuma devolução de itens vendidos por ela no período.</Empty> : (
                <div className="table-wrap cards-sm"><table><caption className="sr-only">Devoluções</caption>
                  <thead><tr><th>Quando</th><th className="r">Itens</th><th className="r">Valor</th></tr></thead>
                  <tbody>{atual.devolucoes.map(d => (
                    <tr key={d.iddocumento}><td><span className="title">{fmtData(d.datahora)}</span><small>documento {d.iddocumento}</small></td>
                      <td className="r" data-label="Itens">{int(d.itens)}</td><td className="r money" data-label="Valor">{brl(d.valor)}</td></tr>))}</tbody>
                </table></div>))}
              {aba === 'meses' && (!atual.meses.length ? <Empty>Sem movimento no período.</Empty> : (
                <div className="table-wrap cards-sm"><table><caption className="sr-only">Mês a mês</caption>
                  <thead><tr><th>Mês</th><th className="r">Vendas</th><th className="r">Vendeu</th><th className="r">Comprou</th></tr></thead>
                  <tbody>{atual.meses.map(m => (
                    <tr key={m.mes}><td className="title">{fmtMes(m.mes + '-01')}</td><td className="r" data-label="Vendas">{int(m.vendas)}</td>
                      <td className="r money" data-label="Vendeu">{brl(m.vendido ?? 0)}</td><td className="r money" data-label="Comprou">{m.comprado ? brl(m.comprado) : '—'}</td></tr>))}</tbody>
                </table></div>))}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function Itens({ itens, lucro, vazio }: { itens: ItemV[]; lucro?: boolean; vazio: string }) {
  const [n, setN] = useState(50)
  if (!itens.length) return <Empty>{vazio}</Empty>
  return (
    <>
      <div className="table-wrap cards-sm"><table><caption className="sr-only">Itens</caption>
        <thead><tr><th>Produto</th><th className="r">Qtd</th><th className="r">Bruto</th><th className="r">Desconto</th><th className="r">Líquido</th>{lucro && <><th className="r">Custo</th><th className="r">Lucro</th></>}</tr></thead>
        <tbody>{itens.slice(0, n).map(i => (
          <tr key={i.id}>
            <td><ItemLink id={i.id}>{i.descricao ?? `Item ${i.id}`}</ItemLink><small>{int(i.vendas ?? i.compras ?? 0)} {lucro ? 'vendas' : 'compras'}</small></td>
            <td className="r" data-label="Qtd">{dec(i.qtd)}</td>
            <td className="r money" data-label="Bruto">{brl(i.bruto)}</td>
            <td className="r money" data-label="Desconto">{i.desconto ? brl(i.desconto) : '—'}</td>
            <td className="r money" data-label="Líquido"><b>{brl(i.liquido)}</b></td>
            {lucro && <><td className="r money" data-label="Custo">{brl(i.custo)}</td><td className="r money" data-label="Lucro">{brl(i.lucro)}</td></>}
          </tr>))}</tbody>
        <tfoot><tr><th>Total ({int(itens.length)} produtos)</th><td className="r">{dec(soma(itens, i => i.qtd))}</td><td className="r money">{brl(soma(itens, i => i.bruto))}</td><td className="r money">{brl(soma(itens, i => i.desconto))}</td><td className="r money"><b>{brl(soma(itens, i => i.liquido))}</b></td>
          {lucro && <><td className="r money">{brl(soma(itens, i => i.custo))}</td><td className="r money">{brl(soma(itens, i => i.lucro))}</td></>}</tr></tfoot>
      </table></div>
      {itens.length > n && <button type="button" className="btn secondary" onClick={() => setN(x => x + 100)}>Mostrar mais ({int(itens.length - n)} restantes)</button>}
    </>
  )
}
