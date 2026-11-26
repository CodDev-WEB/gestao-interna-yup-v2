// Prevenção de perdas: furos entre o que o caixa registra e o que sai da loja. Cada sinal é um indício para
// conferir (câmera, balcão, contagem), nunca prova: erro de cadastro e contagem errada também aparecem aqui.

import { type ReactNode } from 'react'
import { useApi } from '../api'
import { brl, dec, int, pct } from '../format'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, PageHead, Tabs, useParam } from '../ui'
import { ArrowLeftRight, BadgeDollarSign, PackageX, ScanBarcode } from 'lucide-react'

type Vend = {
  id: number | null; vendedora: string; vendas: number; faturamento: number; itens: number; desconto: number; desconto_pct: number | null; sem_cliente_pct: number | null
  genericos: number; valor_genericos: number; cancelados: number; valor_cancelado: number; devolucoes: number; valor_devolvido: number
  sem_saldo: number; valor_sem_saldo: number; abaixo_tabela: number; diferenca_tabela: number
}
type Troca = {
  id_barato: number; nome_barato: string; preco_barato: number; sobra: number; contado_barato: string; origem_barato: string
  id_caro: number; nome_caro: string; preco_caro: number; falta: number; contado_caro: string; origem_caro: string
  mesma_marca: boolean; qtd_par: number; valor: number; vendas_barato: { vendedora: string; qtd: number; vendas: number }[]
}
type LinhaSaldo = { documento: number; datahora: string; id: number; nome: string; qtd: number; valor: number; saldo_antes: number; vendedora: string }
type LinhaPreco = { documento: number; datahora: string; id: number; nome: string; qtd: number; preco_tabela: number; preco_cobrado: number; desconto: number; diferenca: number; vendedora: string }
type Resp = {
  periodo: { de: string; ate: string }
  vendedoras: Vend[]
  sem_saldo: { total: { linhas: number; valor: number; produtos: number }; linhas: LinhaSaldo[] }
  preco_abaixo: { total: { linhas: number; diferenca: number; produtos: number }; linhas: LinhaPreco[] }
  saidas: { total: { qtd: number; valor: number; produtos: number; documentos: number }; por_tipo: { tipo: string; qtd: number; valor: number; produtos: number; documentos: number }[]; produtos: { id: number; nome: string; qtd: number; valor: number; tipos: string }[] }
  trocas: Troca[]
}

const PERIODOS = [{ id: '7', label: '7 dias' }, { id: '30', label: '30 dias' }, { id: '60', label: '60 dias' }, { id: '90', label: '90 dias' }]
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Belem' })
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' })

/** Destaca quem está bem acima das colegas (taxa por venda > 1,5× a mediana, com pelo menos 3 casos). */
function destaques(vs: Vend[]) {
  const base = vs.filter(v => v.vendas >= 20)
  const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
  const campos = ['cancelados', 'devolucoes', 'sem_saldo', 'abaixo_tabela', 'genericos'] as const
  const med = Object.fromEntries(campos.map(c => [c, mediana(base.map(v => v[c] / v.vendas))]))
  const medDesc = mediana(base.map(v => Number(v.desconto_pct ?? 0)))
  return (v: Vend, c: (typeof campos)[number] | 'desconto_pct') => {
    if (v.vendas < 20) return false
    if (c === 'desconto_pct') return Number(v.desconto_pct ?? 0) > Math.max(medDesc * 1.5, 1)
    return v[c] >= 3 && v[c] / v.vendas > Math.max(med[c] * 1.5, 0.002)
  }
}

export default function Perdas() {
  const [dias, setDias] = useParam('dias', '30')
  const { data: r, error, reload } = useApi<Resp>(`dash/prevencao?dias=${dias}`)
  const alto = r ? destaques(r.vendedoras) : null
  const Cel = ({ v, c, children }: { v: Vend; c: Parameters<NonNullable<typeof alto>>[1]; children: ReactNode }) =>
    <td className={`r${alto?.(v, c) ? ' alerta' : ''}`}>{children}{alto?.(v, c) && <small className="down">acima das colegas</small>}</td>
  return (
    <>
      <PageHead section="Controle dos dados" title="Prevenção de perdas" actions={<Tabs label="Período" value={dias} options={PERIODOS} onChange={setDias} />}>
        Furos entre o que o caixa registra e o que sai da loja: produto barato bipado no lugar de um caro, venda de item sem saldo, preço abaixo da tabela e estoque que baixou sem venda. Cada linha é um indício para conferir (câmera, balcão, contagem), não uma prova: erro de cadastro e contagem errada também aparecem aqui.
      </PageHead>
      {error ? <ErrorState message={error} onRetry={reload} /> : !r ? <><p className="hint">Cruzando vendas, saldo item a item, contagens e preços de tabela… (alguns segundos)</p><Loading rows={8} /></> : (
        <>
          <div className="metrics">
            <Metric icon={<ArrowLeftRight size={18} />} tone="red" label="Possíveis trocas na bipagem" value={int(r.trocas.length)} detail={`${brl(r.trocas.reduce((a, t) => a + Number(t.valor), 0))} de diferença de preço (contagens de 120 dias)`} />
            <Metric icon={<ScanBarcode size={18} />} tone="red" label="Vendas sem saldo" value={int(r.sem_saldo.total.linhas)} detail={`${brl(r.sem_saldo.total.valor)} em ${int(r.sem_saldo.total.produtos)} produtos`} />
            <Metric icon={<BadgeDollarSign size={18} />} tone="gold" label="Preço abaixo da tabela" value={int(r.preco_abaixo.total.linhas)} detail={`${brl(r.preco_abaixo.total.diferenca)} a menos que a tabela`} />
            <Metric icon={<PackageX size={18} />} tone="purple" label="Saída sem venda" value={brl(r.saidas.total.valor)} detail={`${dec(r.saidas.total.qtd)} un. em ${int(r.saidas.total.produtos)} produtos, a custo`} />
          </div>

          <section className="section" aria-labelledby="pp-vend">
            <div className="section-head"><h2 id="pp-vend">Por vendedora</h2><span className="muted">{dia(r.periodo.de + 'T12:00:00')} a {dia(r.periodo.ate + 'T12:00:00')} · destaque quando a taxa por venda passa de 1,5× a das colegas</span></div>
            {!r.vendedoras.length ? <Empty>Sem vendas no período.</Empty> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Sinais por vendedora</caption>
                  <thead><tr><th>Vendedora</th><th className="r">Vendas</th><th className="r">Faturamento</th><th className="r">Desconto</th><th className="r">Cancelamentos</th><th className="r">Devoluções</th><th className="r">Venda sem saldo</th><th className="r">Abaixo da tabela</th><th className="r">Produto genérico</th><th className="r">Sem cliente</th></tr></thead>
                  <tbody>{r.vendedoras.map(v => (
                    <tr key={String(v.id)}>
                      <td>{v.vendedora}</td>
                      <td className="r">{int(v.vendas)}</td>
                      <td className="r">{brl(v.faturamento)}</td>
                      <Cel v={v} c="desconto_pct">{brl(v.desconto)}<small>{pct(v.desconto_pct)} do bruto</small></Cel>
                      <Cel v={v} c="cancelados">{int(v.cancelados)}<small>{brl(v.valor_cancelado)}</small></Cel>
                      <Cel v={v} c="devolucoes">{int(v.devolucoes)}<small>{brl(v.valor_devolvido)}</small></Cel>
                      <Cel v={v} c="sem_saldo">{int(v.sem_saldo)}<small>{brl(v.valor_sem_saldo)}</small></Cel>
                      <Cel v={v} c="abaixo_tabela">{int(v.abaixo_tabela)}<small>{brl(v.diferenca_tabela)} a menos</small></Cel>
                      <Cel v={v} c="genericos">{int(v.genericos)}<small>{brl(v.valor_genericos)}</small></Cel>
                      <td className="r">{pct(v.sem_cliente_pct)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="pp-trocas">
            <div className="section-head"><h2 id="pp-trocas">Possível troca na bipagem</h2><span className="muted">item barato que sobrou na contagem × item caro que faltou, da mesma marca ou linha</span></div>
            <p className="hint">Se o produto barato foi bipado e o caro foi entregue, o barato "vende" sem sair da prateleira (sobra na contagem) e o caro sai sem venda (falta). Quanto mais itens contados na Conciliação, mais esta lista acerta.</p>
            {!r.trocas.length ? <Empty>Nenhum par sobra × falta nas contagens dos últimos 120 dias.</Empty> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Pares de sobra e falta</caption>
                  <thead><tr><th>Sobrou (barato)</th><th className="r">Preço</th><th className="r">Sobra</th><th>Faltou (caro)</th><th className="r">Preço</th><th className="r">Falta</th><th className="r">Diferença</th><th>Quem vendeu o barato (60 dias antes da contagem)</th></tr></thead>
                  <tbody>{r.trocas.map(t => (
                    <tr key={`${t.id_barato}-${t.id_caro}`}>
                      <td className="wrap"><ItemLink id={t.id_barato}>{t.nome_barato}</ItemLink><small>contado {dia(t.contado_barato)} ({t.origem_barato})</small></td>
                      <td className="r">{brl(t.preco_barato)}</td><td className="r">+{dec(t.sobra)}</td>
                      <td className="wrap"><ItemLink id={t.id_caro}>{t.nome_caro}</ItemLink><small>contado {dia(t.contado_caro)} ({t.origem_caro}){t.mesma_marca ? ' · mesma marca' : ' · mesma seção e grupo'}</small></td>
                      <td className="r">{brl(t.preco_caro)}</td><td className="r">−{dec(t.falta)}</td>
                      <td className="r"><strong>{brl(t.valor)}</strong><small>{dec(t.qtd_par)} un. no par</small></td>
                      <td className="wrap">{t.vendas_barato.length ? t.vendas_barato.map(x => `${x.vendedora}: ${dec(x.qtd)} un. (${int(x.vendas)} vendas)`).join(' · ') : <span className="muted">sem vendas no período</span>}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="pp-saldo">
            <div className="section-head"><h2 id="pp-saldo">Venda sem saldo</h2><span className="muted">o sistema já não tinha o item no local quando ele foi vendido</span></div>
            {!r.sem_saldo.linhas.length ? <Empty>Nenhuma venda sem saldo no período.</Empty> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Vendas sem saldo</caption>
                  <thead><tr><th>Produto</th><th>Quando</th><th className="r">Documento</th><th className="r">Qtd.</th><th className="r">Valor</th><th className="r">Saldo antes</th><th>Vendedora</th></tr></thead>
                  <tbody>{r.sem_saldo.linhas.map(l => (
                    <tr key={`${l.documento}-${l.id}`}><td className="wrap"><ItemLink id={l.id}>{l.nome}</ItemLink></td><td>{quando(l.datahora)}</td><td className="r">{l.documento}</td>
                      <td className="r">{dec(l.qtd)}</td><td className="r">{brl(l.valor)}</td><td className="r down">{dec(l.saldo_antes)}</td><td>{l.vendedora}</td></tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="pp-preco">
            <div className="section-head"><h2 id="pp-preco">Preço abaixo da tabela</h2><span className="muted">preço unitário cobrado, antes do desconto, menor que a tabela vigente na hora</span></div>
            {!r.preco_abaixo.linhas.length ? <Empty>Nenhuma venda abaixo da tabela no período.</Empty> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Vendas abaixo da tabela</caption>
                  <thead><tr><th>Produto</th><th>Quando</th><th className="r">Documento</th><th className="r">Qtd.</th><th className="r">Tabela</th><th className="r">Cobrado</th><th className="r">Desconto</th><th className="r">A menos</th><th>Vendedora</th></tr></thead>
                  <tbody>{r.preco_abaixo.linhas.map(l => (
                    <tr key={`${l.documento}-${l.id}-${l.preco_cobrado}`}><td className="wrap"><ItemLink id={l.id}>{l.nome}</ItemLink></td><td>{quando(l.datahora)}</td><td className="r">{l.documento}</td>
                      <td className="r">{dec(l.qtd)}</td><td className="r">{brl(l.preco_tabela)}</td><td className="r down">{brl(l.preco_cobrado)}</td><td className="r">{l.desconto > 0 ? brl(l.desconto) : '—'}</td>
                      <td className="r"><strong>{brl(l.diferenca)}</strong></td><td>{l.vendedora}</td></tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="pp-saidas">
            <div className="section-head"><h2 id="pp-saidas">Saída sem venda</h2><span className="muted">estoque que baixou por ajuste, consumo, perda ou sem documento (a custo)</span></div>
            {!r.saidas.por_tipo.length ? <Empty>Nenhuma saída sem venda no período.</Empty> : (
              <div className="grid-2">
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Saídas sem venda por tipo</caption>
                    <thead><tr><th>Tipo de saída</th><th className="r">Unidades</th><th className="r">Valor (custo)</th><th className="r">Produtos</th><th className="r">Documentos</th></tr></thead>
                    <tbody>{r.saidas.por_tipo.map(t => <tr key={t.tipo}><td>{t.tipo}</td><td className="r">{dec(t.qtd)}</td><td className="r">{brl(t.valor)}</td><td className="r">{int(t.produtos)}</td><td className="r">{int(t.documentos)}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Produtos com mais saída sem venda</caption>
                    <thead><tr><th>Produto</th><th className="r">Unidades</th><th className="r">Valor (custo)</th><th>Por</th></tr></thead>
                    <tbody>{r.saidas.produtos.map(p => <tr key={p.id}><td className="wrap"><ItemLink id={p.id}>{p.nome}</ItemLink></td><td className="r">{dec(p.qtd)}</td><td className="r">{brl(p.valor)}</td><td className="wrap"><small>{p.tipos}</small></td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
