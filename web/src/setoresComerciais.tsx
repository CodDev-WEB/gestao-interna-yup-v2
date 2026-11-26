// Setores comerciais (classificação da loja por produto, importada da planilha "Análise de vendas por setor"):
// grade setor × mês, perda por volume contra o mês de pico, conferência com o relatório do ERP e produtos sem setor.

import { useMemo, useState } from 'react'
import { api, useApi } from './api'
import { brl, dec, int, pct } from './format'
import { ItemLink } from './ProdutoPainel'
import { Empty, ErrorState, Loading, Metric } from './ui'
import { Boxes, PackageMinus, TrendingDown, TrendingUp } from 'lucide-react'

export type SetorLista = { nome: string; ordem: number; mercadoria: boolean }
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v))
const mesCurto = (iso: string) => { const [y, m] = iso.split('-').map(Number); return `${MESES[m - 1]}/${String(y).slice(2)}` }
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Belem' })
const sinal = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted')

/** Lista de setores comerciais (para filtros). */
export function useSetoresComerciais() {
  const { data } = useApi<SetorLista[]>('dash/setores-comerciais')
  return data ?? []
}

/** Select de setor comercial; "Sem setor" = produtos ainda sem classificação. */
export function SelectSetorComercial({ value, onChange, rotulo = 'Setor' }: { value: string; onChange: (v: string) => void; rotulo?: string }) {
  const setores = useSetoresComerciais()
  return (
    <label className="field-inline">{rotulo}
      <select className="select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Todos</option>
        {setores.map(s => <option key={s.nome}>{s.nome}</option>)}
        <option>Sem setor</option>
      </select>
    </label>
  )
}

type LinhaSM = { setor_comercial: string; mes: string; qtd: number | string; liquido: number | string; lucro: number | string; documentos: number | string }

/** Setor × mês no ano, com total, participação, lucro, margem e a comparação do 1º com o último mês fechado. */
export function SetoresMes({ ano, metrica, mesesFechados }: { ano: number; metrica: 'qtd' | 'valor'; mesesFechados: number }) {
  const { data, error, reload } = useApi<{ linhas: LinhaSM[] }>(`dash/setores-mes?ano=${ano}`)
  const setores = useSetoresComerciais()
  const grade = useMemo(() => {
    const m = new Map<string, { setor: string; qtd: number[]; valor: number[]; lucro: number; total: number; totalQtd: number }>()
    for (const l of data?.linhas ?? []) {
      const i = Number(l.mes.slice(5, 7)) - 1
      const s = m.get(l.setor_comercial) ?? { setor: l.setor_comercial, qtd: Array(12).fill(0), valor: Array(12).fill(0), lucro: 0, total: 0, totalQtd: 0 }
      s.qtd[i] += n(l.qtd); s.valor[i] += n(l.liquido); s.lucro += n(l.lucro); s.total += n(l.liquido); s.totalQtd += n(l.qtd)
      m.set(l.setor_comercial, s)
    }
    const ordem = new Map(setores.map(s => [s.nome, s.ordem]))
    return [...m.values()].sort((a, b) => b.total - a.total || (ordem.get(a.setor) ?? 999) - (ordem.get(b.setor) ?? 999))
  }, [data, setores])
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <Loading rows={8} />
  if (!grade.length) return <Empty>Nenhuma venda no ano.</Empty>
  const meses = Math.max(...(data.linhas.map(l => Number(l.mes.slice(5, 7)))), 1)
  const total = grade.reduce((a, s) => a + s.total, 0)
  const ult = Math.max(0, mesesFechados - 1)
  const fmt = (v: number) => (metrica === 'valor' ? brl(v) : dec(v))
  const col = (s: (typeof grade)[number]) => (metrica === 'valor' ? s.valor : s.qtd)
  const somaMes = (i: number) => grade.reduce((a, s) => a + col(s)[i], 0)
  const aumentos = grade.filter(s => s.valor[0] > 0 && s.valor[ult] > s.valor[0]).length
  const quedas = grade.filter(s => s.valor[0] > 0 && s.valor[ult] < s.valor[0]).length
  return (
    <>
      <p className="hint">Faturamento líquido (após descontos) e quantidade por setor comercial em {ano}. A comparação usa janeiro e {MESES[ult].toLowerCase()}, o último mês fechado: {int(aumentos)} setores cresceram e {int(quedas)} caíram.{mesesFechados < meses ? ` ${MESES[meses - 1]} está em andamento.` : ''}</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Setores comerciais mês a mês</caption>
          <thead><tr>
            <th>Setor</th>{MESES.slice(0, meses).map((m, i) => <th key={m} className="r">{m}{i >= mesesFechados ? '*' : ''}</th>)}
            <th className="r">Total</th><th className="r">Participação</th><th className="r">Lucro bruto</th><th className="r">Margem</th>
            <th className="r">Jan → {MESES[ult]}</th><th>Tendência</th>
          </tr></thead>
          <tbody>{grade.map(s => {
            const v0 = s.valor[0], v1 = s.valor[ult], dv = v0 > 0 ? (v1 / v0 - 1) * 100 : null
            return (
              <tr key={s.setor}>
                <td>{s.setor}</td>
                {col(s).slice(0, meses).map((v, i) => <td key={i} className="r">{v ? fmt(v) : <span className="muted">—</span>}</td>)}
                <td className="r"><strong>{fmt(metrica === 'valor' ? s.total : s.totalQtd)}</strong></td>
                <td className="r">{total ? pct(s.total / total * 100) : '—'}</td>
                <td className="r">{brl(s.lucro)}</td>
                <td className="r">{s.total ? pct(s.lucro / s.total * 100) : '—'}</td>
                <td className="r">{brl(v1 - v0)}{dv !== null && <small className={sinal(dv)}>{dv > 0 ? '+' : ''}{pct(dv)}</small>}</td>
                <td>{v0 === 0 ? <span className="muted">Sem base em jan</span> : v1 > v0 ? <span className="pill good">Aumento</span> : v1 < v0 ? <span className="pill bad">Declínio</span> : <span className="pill neutral">Estável</span>}</td>
              </tr>)
          })}</tbody>
          <tfoot><tr>
            <th scope="row">Total</th>{Array.from({ length: meses }, (_, i) => <td key={i} className="r">{fmt(somaMes(i))}</td>)}
            <td className="r">{fmt(metrica === 'valor' ? total : grade.reduce((a, s) => a + s.totalQtd, 0))}</td><td className="r">100%</td>
            <td className="r">{brl(grade.reduce((a, s) => a + s.lucro, 0))}</td><td className="r">{total ? pct(grade.reduce((a, s) => a + s.lucro, 0) / total * 100) : '—'}</td><td /><td />
          </tr></tfoot>
        </table>
      </div>
    </>
  )
}

type PVSetor = { setor: string; mes_pico: string; qtd_pico: number; qtd_mes: number; fat_pico: number; fat_mes: number; perda: number; ganho: number; impacto: number; variacao: number; efeito_preco: number; mercadoria: boolean }
type PVSerie = { mes: string; qtd: number; faturamento: number; perda: number; ganho: number; impacto: number; efeito_preco: number; variacao: number; pico: boolean }
type PVProd = { id: number; nome: string; qtd_pico: number; qtd_mes: number; preco_pico: number; fat_pico: number; fat_mes: number; perda: number; variacao: number; entradas_pico: number; entradas_mes: number; estoque_atual: number | null; zerou_no_mes: boolean | null; saldo_minimo: number | null; com_historico: boolean }
type PV = { mes: string; inicio: string; setor: string | null; setores: PVSetor[]; serie: PVSerie[]; produtos: PVProd[] }

/** Perda por volume: cada setor contra o seu mês de maior quantidade (método da planilha), com estoque e entradas. */
export function PerdaVolume({ ano }: { ano: number }) {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())
  const ultimoFechado = (() => { const [y, m] = hoje.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7) })()
  const padrao = ano < Number(hoje.slice(0, 4)) ? `${ano}-12` : ultimoFechado
  const [mes, setMes] = useState(padrao)
  const [setor, setSetor] = useState('')
  const { data: r, error, reload } = useApi<PV>(`dash/perda-volume?mes=${mes}${setor ? `&setor=${encodeURIComponent(setor)}` : ''}`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!r) return <><p className="hint">Comparando cada produto com o mês de pico do seu setor… (alguns segundos)</p><Loading rows={8} /></>
  const s = r.setores.find(x => x.setor === r.setor)
  const depoisPico = s ? r.serie.filter(x => x.mes > s.mes_pico) : []
  const acumulado = depoisPico.reduce((a, x) => a + n(x.impacto), 0)
  const opcoesMes = Array.from({ length: Number(ultimoFechado.slice(0, 4)) === ano ? Number(ultimoFechado.slice(5, 7)) : 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`)
  return (
    <>
      <div className="toolbar">
        <label className="field-inline">Mês analisado
          <select className="select" value={mes} onChange={e => setMes(e.target.value)}>{opcoesMes.map(m => <option key={m} value={m}>{mesCurto(m + '-01')}</option>)}</select>
        </label>
        <label className="field-inline">Setor
          <select className="select" value={r.setor ?? ''} onChange={e => setSetor(e.target.value)}>{r.setores.map(x => <option key={x.setor}>{x.setor}</option>)}</select>
        </label>
      </div>
      <p className="hint">Referência de cada setor: o mês fechado de maior quantidade vendida no ano até {mesCurto(r.mes)}. Para cada produto, as unidades a menos que no pico viram dinheiro pelo preço líquido unitário do pico (perda bruta); as unidades a mais em outros itens entram como ganho. O que sobra da diferença real é efeito de preço e mix. Mês em andamento não entra.</p>
      {s && (
        <div className="metrics">
          <Metric icon={<Boxes size={18} />} label={`Pico de quantidade em ${s.setor}`} value={`${mesCurto(s.mes_pico)} · ${dec(s.qtd_pico)} un.`} detail={`${brl(s.fat_pico)} de faturamento`} />
          <Metric icon={<PackageMinus size={18} />} tone="red" label={`Impacto líquido do volume em ${mesCurto(r.mes)}`} value={brl(s.impacto)} detail={`perda bruta ${brl(s.perda)} · ganho em outros itens ${brl(s.ganho)}`} />
          <Metric icon={<TrendingDown size={18} />} tone="red" label={`Impacto acumulado após o pico`} value={brl(acumulado)} detail={depoisPico.length ? `${mesCurto(depoisPico[0].mes)} a ${mesCurto(r.mes)}` : 'o mês analisado é o pico'} />
          <Metric icon={<TrendingUp size={18} />} tone="gold" label={`Variação real ${mesCurto(r.mes)} × ${mesCurto(s.mes_pico)}`} value={brl(s.variacao)} detail={`efeito preço/mix ${brl(s.efeito_preco)}`} />
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>Todos os setores em {mesCurto(r.mes)}</h2><span className="muted">clique no setor para ver os produtos</span></div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Perda por volume por setor</caption>
            <thead><tr><th>Setor</th><th>Mês de pico</th><th className="r">Qtd. pico</th><th className="r">Qtd. {mesCurto(r.mes)}</th><th className="r">Faturamento pico</th><th className="r">Faturamento {mesCurto(r.mes)}</th><th className="r">Perda bruta</th><th className="r">Ganho em outros itens</th><th className="r">Impacto líquido</th><th className="r">Efeito preço/mix</th><th className="r">Variação real</th></tr></thead>
            <tbody>{r.setores.map(x => (
              <tr key={x.setor} aria-current={x.setor === r.setor ? 'true' : undefined}>
                <td><button type="button" className="item-link" onClick={() => setSetor(x.setor)}>{x.setor}</button>{!x.mercadoria && <small>serviço, não mercadoria</small>}</td>
                <td>{mesCurto(x.mes_pico)}</td><td className="r">{dec(x.qtd_pico)}</td><td className="r">{dec(x.qtd_mes)}</td>
                <td className="r">{brl(x.fat_pico)}</td><td className="r">{brl(x.fat_mes)}</td><td className="r">{brl(x.perda)}</td><td className="r">{brl(x.ganho)}</td>
                <td className={`r ${sinal(n(x.impacto))}`}><strong>{brl(x.impacto)}</strong></td><td className="r">{brl(x.efeito_preco)}</td><td className={`r ${sinal(n(x.variacao))}`}>{brl(x.variacao)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>

      {s && (
        <section className="section">
          <div className="section-head"><h2>{s.setor}: mês a mês contra o pico de {mesCurto(s.mes_pico)}</h2></div>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Evolução mensal comparada ao pico</caption>
              <thead><tr><th>Mês</th><th className="r">Quantidade</th><th className="r">Faturamento</th><th className="r">Perda bruta por menor volume</th><th className="r">Ganho em outros itens</th><th className="r">Impacto líquido do volume</th><th className="r">Efeito preço/mix</th><th className="r">Diferença real × pico</th></tr></thead>
              <tbody>{r.serie.map(x => (
                <tr key={x.mes}><td>{mesCurto(x.mes)}{x.pico && <small>pico</small>}</td><td className="r">{dec(x.qtd)}</td><td className="r">{brl(x.faturamento)}</td>
                  <td className="r">{brl(x.perda)}</td><td className="r">{brl(x.ganho)}</td><td className={`r ${sinal(n(x.impacto))}`}>{brl(x.impacto)}</td><td className="r">{brl(x.efeito_preco)}</td><td className={`r ${sinal(n(x.variacao))}`}>{brl(x.variacao)}</td></tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {s && (
        <section className="section">
          <div className="section-head"><h2>Produtos de {s.setor} com maior perda em {mesCurto(r.mes)}</h2><span className="muted">até 30, da maior perda para a menor</span></div>
          {!r.produtos.length ? <Empty>Nenhum produto vendeu menos que no pico.</Empty> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Produtos com maior perda estimada</caption>
                <thead><tr><th>Produto</th><th>Situação</th><th className="r">Qtd. {mesCurto(s.mes_pico)}</th><th className="r">Qtd. {mesCurto(r.mes)}</th><th className="r">Preço líquido unit. pico</th><th className="r">Perda estimada</th><th className="r">Variação real</th><th className="r">Entradas {mesCurto(s.mes_pico)}</th><th className="r">Entradas {mesCurto(r.mes)}</th><th>Estoque em {mesCurto(r.mes)}</th><th className="r">Estoque hoje</th></tr></thead>
                <tbody>{r.produtos.map(p => (
                  <tr key={p.id}>
                    <td className="wrap"><ItemLink id={p.id}>{p.nome}</ItemLink></td>
                    <td>{n(p.qtd_mes) === 0 ? 'Sem venda no mês' : 'Volume menor'}</td>
                    <td className="r">{dec(p.qtd_pico)}</td><td className="r">{dec(p.qtd_mes)}</td><td className="r">{brl(p.preco_pico)}</td>
                    <td className="r"><strong>{brl(p.perda)}</strong></td><td className="r down">{brl(p.variacao)}</td>
                    <td className="r">{dec(p.entradas_pico)}</td><td className="r">{dec(p.entradas_mes)}</td>
                    <td>{!p.com_historico ? <span className="muted">sem histórico de saldo</span> : p.zerou_no_mes ? <span className="pill bad">Zerou (falta)</span> : <span className="pill good">Teve estoque</span>}{p.com_historico && p.saldo_minimo !== null && <small>mínimo {dec(p.saldo_minimo)} un.</small>}</td>
                    <td className="r">{p.estoque_atual === null ? '—' : dec(p.estoque_atual)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginTop: 8 }}>“Zerou (falta)”: a soma do saldo de todos os locais chegou a zero em algum momento do mês, então parte da queda pode ser falta de estoque e não de demanda. “Teve estoque”: o saldo nunca zerou, então a queda veio da venda.</p>
        </section>
      )}
    </>
  )
}

type Conf = { mes: string; inicio: string; fim: string; arquivo: string | null; fonte: string; erp: Tot; sistema: Tot & { itens_sem_custo: number }; mes_inteiro: Tot }
type Tot = { faturamento: number; quantidade: number; lucro: number }

/** Conferência mês a mês com os totais do relatório "Lucro bruto das mercadorias" do ERP (gabarito). */
export function ConferenciaErp() {
  const { data, error, reload } = useApi<Conf[]>('dash/conferencia-erp')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <Loading rows={6} />
  if (!data.length) return <Empty>Nenhum mês de referência cadastrado.</Empty>
  const dif = (a: number, b: number) => Math.round((n(b) - n(a)) * 100) / 100
  const cel = (erp: number, sis: number, f: (v: number) => string, tol: number) => {
    const d = dif(erp, sis)
    return <td className="r">{f(sis)}{Math.abs(d) > tol ? <small className="num-dif">{d > 0 ? '+' : ''}{f(d)}</small> : <small className="muted">igual</small>}</td>
  }
  const ok = (c: Conf) => Math.abs(dif(c.erp.faturamento, c.sistema.faturamento)) <= 0.01 && Math.abs(dif(c.erp.quantidade, c.sistema.quantidade)) <= 0.001
  return (
    <>
      <p className="hint">{data[0].fonte}, mês a mês. O sistema soma as vendas na mesma janela do relatório (data e hora de início e fim); “Mês inteiro” mostra o mês completo, que pode ter vendas fora da janela do relatório.</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Conferência com o relatório do ERP</caption>
          <thead><tr><th>Mês</th><th>Janela do relatório</th><th className="r">Faturamento ERP</th><th className="r">Faturamento sistema</th><th className="r">Qtd. ERP</th><th className="r">Qtd. sistema</th><th className="r">Lucro ERP</th><th className="r">Lucro sistema</th><th className="r">Mês inteiro (sistema)</th><th>Situação</th></tr></thead>
          <tbody>{data.map(c => (
            <tr key={c.mes}>
              <td>{mesCurto(c.mes)}</td>
              <td>{dataHora(c.inicio)}<small>até {dataHora(c.fim)}</small></td>
              <td className="r">{brl(c.erp.faturamento)}</td>{cel(c.erp.faturamento, c.sistema.faturamento, brl, 0.01)}
              <td className="r">{dec(c.erp.quantidade)}</td>{cel(c.erp.quantidade, c.sistema.quantidade, dec, 0.001)}
              <td className="r">{brl(c.erp.lucro)}</td>{cel(c.erp.lucro, c.sistema.lucro, brl, 0.01)}
              <td className="r">{brl(c.mes_inteiro.faturamento)}<small>{dec(c.mes_inteiro.quantidade)} un.</small></td>
              <td>{ok(c) ? <span className="pill good">Confere</span> : <span className="pill bad">Diferença</span>}{n(c.sistema.itens_sem_custo) > 0 && <small>{int(c.sistema.itens_sem_custo)} itens sem custo no sistema</small>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  )
}

type SemSetorLinha = { variacao: number; produto: string; liquido: number; qtd: number; documentos: number }

/** Produtos vendidos no ano sem setor comercial, com a escolha do setor ali mesmo. */
export function SemSetor({ ano }: { ano: number }) {
  const { data, error, reload } = useApi<{ linhas: SemSetorLinha[]; total_linhas?: number }>(`dash/sem-setor?ano=${ano}`)
  const setores = useSetoresComerciais()
  const [salvando, setSalvando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [feitos, setFeitos] = useState<Record<number, string>>({})
  const salvar = async (id: number, setor: string) => {
    if (!setor) return
    setSalvando(id); setErro(null)
    try { await api('dash/setor-comercial', { method: 'POST', body: JSON.stringify({ ids: [id], setor }) }); setFeitos(f => ({ ...f, [id]: setor })) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setSalvando(null) }
  }
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <Loading rows={4} />
  const linhas = data.linhas
  if (!linhas.length) return <Empty>Todos os produtos vendidos em {ano} têm setor comercial.</Empty>
  const total = linhas.reduce((a, l) => a + n(l.liquido), 0)
  return (
    <>
      <p className="hint">{int(data.total_linhas ?? linhas.length)} produtos vendidos em {ano} ainda sem setor comercial, somando {brl(total)}. Eles aparecem como “Sem setor” no Mix, em Produtos e nos Relatórios. Escolha o setor e ele passa a valer em todas as telas.</p>
      {erro && <ErrorState message={erro} />}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Produtos sem setor comercial</caption>
          <thead><tr><th>Produto</th><th className="r">Vendido no ano</th><th className="r">Quantidade</th><th className="r">Vendas</th><th>Setor comercial</th></tr></thead>
          <tbody>{linhas.map(l => (
            <tr key={l.variacao}>
              <td className="wrap"><ItemLink id={l.variacao}>{l.produto}</ItemLink></td>
              <td className="r">{brl(l.liquido)}</td><td className="r">{dec(l.qtd)}</td><td className="r">{int(l.documentos)}</td>
              <td>{feitos[l.variacao] ? <span className="pill good">{feitos[l.variacao]}</span> : (
                <select className="select" disabled={salvando === l.variacao} defaultValue="" onChange={e => salvar(l.variacao, e.target.value)} aria-label={`Setor de ${l.produto}`}>
                  <option value="">Escolher…</option>{setores.map(s => <option key={s.nome}>{s.nome}</option>)}
                </select>)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  )
}
