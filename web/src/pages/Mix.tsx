// Mix e demanda: cada produto (e fornecedor) mês a mês no ano, com variação contra o mês anterior, recorde,
// meses sem venda e tendência; diagnóstico do mix (em alta, em queda, irregular, parou...) e troca de embalagem
// (quem passou a comprar a menor e a causa provável).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Award, Package, Star, Users } from 'lucide-react'
import { api, useApi } from '../api'
import { brl, dec, int, pct } from '../format'
import { CATEGORIAS, decodificar, diagnosticar, linhaDe, linhasComMigracao, MESES, tamanho, variacao, type Categoria, type ItemMes, type Linha, type RespMix, type RespMixBruta } from '../mixCalculo'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, PageHead, SearchBox, Tabs } from '../ui'
import { PerdaVolume, SelectSetorComercial, SetoresMes } from '../setoresComerciais'

type Aba = 'produtos' | 'fornecedores' | 'setores' | 'perda' | 'diagnostico' | 'embalagens'
type Metrica = 'qtd' | 'valor'
const PAGINA = 50
const anoAtual = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date()).slice(0, 4))

function Var({ v }: { v: number | null }) {
  if (v === null || !isFinite(v)) return null
  return <small className={v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {pct(Math.abs(v), 0)}</small>
}

/** Matriz mês a mês: uma linha por produto ou fornecedor. */
function Matriz({ linhas, meses, completos, metrica, nome, ordenar, setOrdenar }: {
  linhas: { chave: string; nome: React.ReactNode; sub?: string; valores: number[]; dez: number }[]
  meses: number; completos: number; metrica: Metrica; nome: string; ordenar: string; setOrdenar: (o: string) => void
}) {
  const [pagina, setPagina] = useState(1)
  const fmt = (v: number) => (metrica === 'valor' ? brl(v) : dec(v))
  const comDados = linhas.map(l => {
    const tot = l.valores.slice(0, meses).reduce((a, x) => a + x, 0)
    let best = 0; l.valores.slice(0, meses).forEach((x, i) => { if (x > l.valores[best]) best = i })
    const ult = completos - 1
    const t3 = l.valores.slice(Math.max(0, completos - 3), completos).reduce((a, x) => a + x, 0), a3 = l.valores.slice(Math.max(0, completos - 6), Math.max(0, completos - 3)).reduce((a, x) => a + x, 0)
    return { ...l, tot, best, ultVar: ult >= 1 ? variacao(l.valores[ult], l.valores[ult - 1]) : null, tend: a3 > 0 ? ((t3 - a3) / a3) * 100 : null, semVenda: l.valores.slice(0, completos).filter(x => x === 0).length }
  })
  const ordenadas = [...comDados].sort((a, b) => ordenar === 'tendencia' ? (b.tend ?? -1e9) - (a.tend ?? -1e9) : ordenar === 'queda' ? (a.tend ?? 1e9) - (b.tend ?? 1e9) : ordenar === 'ultimo' ? (b.ultVar ?? -1e9) - (a.ultVar ?? -1e9) : b.tot - a.tot)
  const paginas = Math.max(1, Math.ceil(ordenadas.length / PAGINA)), visiveis = ordenadas.slice((pagina - 1) * PAGINA, pagina * PAGINA)
  return (
    <>
      <div className="toolbar">
        <Tabs label="Ordenar" value={ordenar} onChange={v => { setOrdenar(v); setPagina(1) }} options={[{ id: 'total', label: 'Mais vendidos' }, { id: 'tendencia', label: 'Mais cresceram' }, { id: 'queda', label: 'Mais caíram' }, { id: 'ultimo', label: 'Último mês' }]} />
      </div>
      <div className="table-wrap matriz" tabIndex={0} role="region" aria-label={`${nome} mês a mês`}><table>
        <caption className="sr-only">{nome} mês a mês</caption>
        <thead><tr><th>#</th><th>{nome}</th>{MESES.slice(0, meses).map((m, i) => <th key={m} className="r">{m}{i === meses - 1 && meses > completos ? '*' : ''}</th>)}<th className="r">Total</th><th className="r">Tendência</th><th className="r">Meses sem venda</th></tr></thead>
        <tbody>{visiveis.map((l, i) => (
          <tr key={l.chave}>
            <td className="muted">{(pagina - 1) * PAGINA + i + 1}</td>
            <td className="wrap">{l.nome}{l.sub && <small>{l.sub}</small>}</td>
            {l.valores.slice(0, meses).map((v, m) => (
              <td key={m} className={`r${m === l.best && v > 0 ? ' recorde' : ''}${v === 0 ? ' zero' : ''}`} title={m === l.best && v > 0 ? 'Melhor mês do ano' : undefined}>
                {v === 0 ? '—' : fmt(v)}{m === l.best && v > 0 && <Star size={11} className="estrela" aria-label="melhor mês" />}
                {v > 0 && <Var v={variacao(v, m === 0 ? l.dez : l.valores[m - 1])} />}
              </td>))}
            <td className="r"><b>{fmt(l.tot)}</b></td>
            <td className="r"><Var v={l.tend} /></td>
            <td className="r">{l.semVenda || '—'}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="pager"><span>{int(ordenadas.length)} {nome.toLowerCase()}s · ★ melhor mês · % contra o mês anterior{meses > completos ? ' · * mês em andamento' : ''}</span>
        <span><button className="btn secondary" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>Anterior</button> {pagina} de {paginas} <button className="btn secondary" disabled={pagina >= paginas} onClick={() => setPagina(p => p + 1)}>Próxima</button></span></div>
    </>
  )
}

/** Clientes que trocaram a embalagem maior por uma menor na linha (últimos 6 meses contra os 12 anteriores). */
function DetalheLinha({ linha }: { linha: Linha }) {
  const ids = linha.embalagens.map(e => e.id)
  const { data, error } = useApi<{ de: string; ate: string; itens: { id: number; linhas: { cliente: number; nome: string; mes: string; qtd: number }[] }[] }>(`dash/mix-familia?ids=${ids.join(',')}`)
  const corte = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 7) }, [])
  const trocas = useMemo(() => {
    if (!data) return []
    const tam = new Map(linha.embalagens.map(e => [e.id, e]))
    const porCliente = new Map<number, { nome: string; antes: Map<number, number>; depois: Map<number, number> }>()
    for (const it of data.itens) for (const l of it.linhas) {
      if (!l.cliente) continue
      const c = porCliente.get(l.cliente) ?? { nome: l.nome, antes: new Map(), depois: new Map() }
      const alvo = l.mes >= corte ? c.depois : c.antes
      alvo.set(it.id, (alvo.get(it.id) ?? 0) + l.qtd); porCliente.set(l.cliente, c)
    }
    const principal = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] * tam.get(b[0])!.tamanho - a[1] * tam.get(a[0])!.tamanho)[0]
    return [...porCliente.entries()].map(([id, c]) => {
      const a = principal(c.antes), d = principal(c.depois)
      if (!a || !d) return null
      const ta = tam.get(a[0])!, td = tam.get(d[0])!
      if (td.tamanho >= ta.tamanho) return null
      const aindaCompraMaior = (c.depois.get(a[0]) ?? 0) > 0
      return { id, nome: c.nome, de: ta, para: td, qtdAntes: a[1], qtdDepois: d[1], aindaCompraMaior }
    }).filter(Boolean) as { id: number; nome: string; de: typeof linha.embalagens[0]; para: typeof linha.embalagens[0]; qtdAntes: number; qtdDepois: number; aindaCompraMaior: boolean }[]
  }, [data, corte, linha])
  if (error) return <ErrorState message={error} />
  if (!data) return <Loading rows={4} />
  return (
    <div className="mix-detalhe">
      <h4>Clientes que passaram a comprar embalagem menor (últimos 6 meses × antes)</h4>
      {!trocas.length ? <p className="hint">Nenhum cliente identificado trocando de embalagem nesta linha (a mudança vem de clientes diferentes, não dos mesmos).</p> : (
        <div className="table-wrap cards-sm"><table><caption className="sr-only">Clientes que trocaram</caption>
          <thead><tr><th>Cliente</th><th>Antes comprava</th><th>Agora compra</th><th>Observação</th></tr></thead>
          <tbody>{trocas.map(t => (
            <tr key={t.id}><td>{t.nome}<small>cliente {t.id}</small></td>
              <td>{t.de.texto} <small>{dec(t.qtdAntes)} un.</small></td>
              <td><b>{t.para.texto}</b> <small>{dec(t.qtdDepois)} un.</small></td>
              <td className="wrap">{t.aindaCompraMaior ? 'Ainda compra a maior às vezes' : 'Deixou a maior'}</td></tr>))}</tbody>
        </table></div>)}
    </div>
  )
}

export default function Mix() {
  const [sp, setSp] = useSearchParams()
  const set = (k: Record<string, string | null>) => setSp(prev => { const n = new URLSearchParams(prev); for (const [a, b] of Object.entries(k)) b === null || b === '' ? n.delete(a) : n.set(a, b); return n }, { replace: true })
  const ano = Number(sp.get('ano')) || anoAtual()
  const setor = sp.get('setor') ?? ''
  const setorc = sp.get('setorc') ?? ''
  const aba = (sp.get('aba') as Aba) || 'produtos'
  const metrica = (sp.get('metrica') as Metrica) || 'qtd'
  const busca = sp.get('busca') ?? ''
  const [ordenar, setOrdenar] = useState('total')
  const [cat, setCat] = useState<Categoria | ''>('')
  const [aberta, setAberta] = useState<string | null>(null)
  const { data: bruto, error, loading, reload } = useApi<RespMixBruta>(`dash/mix?ano=${ano}${setor ? `&setor=${encodeURIComponent(setor)}` : ''}${setorc ? `&setorc=${encodeURIComponent(setorc)}` : ''}`)
  const r: RespMix | null = useMemo(() => (bruto ? decodificar(bruto) : null), [bruto])
  const meses = r?.meses_com_dados ?? 0
  const completos = r ? (r.mes_em_andamento ? meses - 1 : meses) : 0
  const filtro = (nome: string) => !busca || nome.toUpperCase().includes(busca.toUpperCase()) || nome.includes(busca)
  // Taxas e serviços (entrega, frete) não são produtos do mix.
  const itens = useMemo(() => (r?.itens ?? []).filter(i => !/\b(TAXA|FRETE|ENTREGA|SERVI[CÇ]O)\b/i.test(i.nome)).filter(i => filtro(i.nome) || String(i.id) === busca), [r, busca]) // eslint-disable-line react-hooks/exhaustive-deps
  const diag = useMemo(() => new Map(itens.map(i => [i.id, diagnosticar(i, meses, completos)])), [itens, meses, completos])
  const val = (i: ItemMes) => (metrica === 'valor' ? i.valor : i.qtd)

  const fornecedores = useMemo(() => {
    const m = new Map<string, { chave: string; nome: string; valores: number[]; dez: number; produtos: number }>()
    for (const i of itens) {
      const k = String(i.idfornecedor || i.fornecedor)
      const f = m.get(k) ?? { chave: k, nome: i.fornecedor, valores: Array(12).fill(0), dez: 0, produtos: 0 }
      val(i).forEach((v, j) => { f.valores[j] += v }); f.dez += metrica === 'valor' ? i.dez_valor : i.dez_qtd; f.produtos++
      m.set(k, f)
    }
    return [...m.values()]
  }, [itens, metrica]) // eslint-disable-line react-hooks/exhaustive-deps
  const linhas = useMemo(() => linhasComMigracao(itens, completos).filter(l => l.migracao >= 10), [itens, completos])

  const porCat = (c: Categoria) => itens.filter(i => diag.get(i.id)?.categoria === c)
  const totalAno = itens.reduce((a, i) => a + i.valor.slice(0, meses).reduce((x, y) => x + y, 0), 0)
  const procurados = [...itens].sort((a, b) => (diag.get(b.id)?.clientes ?? 0) - (diag.get(a.id)?.clientes ?? 0))

  return (
    <>
      <PageHead section="Análises" title="Mix e demanda">
        Cada produto e fornecedor mês a mês no ano, com a variação contra o mês anterior, o melhor mês (★), os meses sem venda e a tendência dos últimos 3 meses; o diagnóstico do mix (o que está em alta, em queda, irregular, novo ou parou) e as linhas em que os clientes estão trocando a embalagem grande pela pequena, com a causa provável. Base para decidir o que comprar.
      </PageHead>
      <div className="toolbar">
        <label className="field-inline">Ano <select className="select" value={ano} onChange={e => set({ ano: e.target.value })}>{[anoAtual(), anoAtual() - 1].map(a => <option key={a}>{a}</option>)}</select></label>
        <SelectSetorComercial value={setorc} onChange={v => set({ setorc: v, setor: null })} />
        <Tabs<Metrica> label="Medir por" value={metrica} onChange={v => set({ metrica: v })} options={[{ id: 'qtd', label: 'Quantidade' }, { id: 'valor', label: 'Faturamento' }]} />
        <SearchBox value={busca} onChange={v => set({ busca: v })} placeholder="Produto ou fornecedor" />
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !r ? <><p className="hint">Juntando as vendas de cada mês do ano… (alguns segundos)</p><Loading rows={8} /></> : (
        <div aria-busy={loading || undefined}>
          <div className="metrics">
            <Metric icon={<Package size={18} />} tone="turquoise" label="Produtos vendidos no ano" value={int(itens.length)} detail={`${brl(totalAno)} em vendas`} />
            <Metric icon={<ArrowUpRight size={18} />} tone="green" label="Em alta" value={int(porCat('alta').length)} detail="últimos 3 meses +20% ou mais" onClick={() => { set({ aba: 'diagnostico' }); setCat('alta') }} />
            <Metric icon={<ArrowDownRight size={18} />} tone="red" label="Em queda ou parados" value={int(porCat('queda').length + porCat('parou').length)} detail={`${int(porCat('parou').length)} pararam de vender`} onClick={() => { set({ aba: 'diagnostico' }); setCat('queda') }} />
            <Metric icon={<Award size={18} />} tone="gold" label="Bateram recorde" value={int(itens.filter(i => diag.get(i.id)?.recordeRecente).length)} detail="melhor mês do ano foi o último" />
          </div>
          <div style={{ margin: '6px 0 16px' }}>
            <Tabs<Aba> abas label="Visão" value={aba} onChange={v => set({ aba: v })} options={[{ id: 'produtos', label: 'Produtos mês a mês' }, { id: 'fornecedores', label: 'Fornecedores mês a mês' }, { id: 'setores', label: 'Setores mês a mês' }, { id: 'perda', label: 'Perda por volume' }, { id: 'diagnostico', label: 'Diagnóstico do mix' }, { id: 'embalagens', label: `Troca de embalagem (${linhas.length})` }]} />
          </div>

          {aba === 'produtos' && (itens.length ? <Matriz nome="Produto" meses={meses} completos={completos} metrica={metrica} ordenar={ordenar} setOrdenar={setOrdenar}
            linhas={itens.map(i => ({ chave: String(i.id), nome: <ItemLink id={i.id}>{i.nome}</ItemLink>, sub: `${i.fornecedor} · ${CATEGORIAS[diag.get(i.id)!.categoria].nome}`, valores: val(i), dez: metrica === 'valor' ? i.dez_valor : i.dez_qtd }))} /> : <Empty>Nenhum produto vendido com esses filtros.</Empty>)}

          {aba === 'fornecedores' && <Matriz nome="Fornecedor" meses={meses} completos={completos} metrica={metrica} ordenar={ordenar} setOrdenar={setOrdenar}
            linhas={fornecedores.map(f => ({ chave: f.chave, nome: f.nome, sub: `${int(f.produtos)} produtos vendidos`, valores: f.valores, dez: f.dez }))} />}

          {aba === 'setores' && <SetoresMes ano={ano} metrica={metrica} mesesFechados={completos} />}
          {aba === 'perda' && <PerdaVolume ano={ano} />}

          {aba === 'diagnostico' && (
            <>
              <div className="chips" role="group" aria-label="Categoria" style={{ marginBottom: 12 }}>
                <button className="chip" aria-pressed={!cat} onClick={() => setCat('')}>Resumo</button>
                {(Object.keys(CATEGORIAS) as Categoria[]).map(c => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{CATEGORIAS[c].nome} ({porCat(c).length})</button>)}
              </div>
              {!cat ? (
                <div className="aud-grupos">
                  {(Object.keys(CATEGORIAS) as Categoria[]).map(c => {
                    const l = porCat(c), v = l.reduce((a, i) => a + (diag.get(i.id)?.valor ?? 0), 0)
                    return <section key={c} className="aud-card"><h3><span className={`pill ${CATEGORIAS[c].cls}`}>{CATEGORIAS[c].nome}</span>{int(l.length)} produtos</h3>
                      <p className="hint">{CATEGORIAS[c].desc}</p><p><b>{brl(v)}</b> vendidos no ano ({totalAno ? pct(v / totalAno * 100) : '—'} do total)</p>
                      <button type="button" className="ver-mais" onClick={() => setCat(c)}>ver os produtos</button></section>
                  })}
                  <section className="aud-card"><h3><span className="pill info"><Users size={12} aria-hidden /> Mais procurados</span></h3>
                    <ol className="mix-lista">{procurados.slice(0, 8).map(i => <li key={i.id}><ItemLink id={i.id}>{i.nome}</ItemLink> <small>{int(diag.get(i.id)!.clientes)} compras de clientes</small></li>)}</ol></section>
                  <section className="aud-card"><h3><span className="pill neutral">Menos procurados (que ainda vendem)</span></h3>
                    <ol className="mix-lista">{procurados.filter(i => diag.get(i.id)!.categoria !== 'parou').slice(-8).reverse().map(i => <li key={i.id}><ItemLink id={i.id}>{i.nome}</ItemLink> <small>{int(diag.get(i.id)!.clientes)} compras de clientes</small></li>)}</ol></section>
                </div>
              ) : (
                <div className="table-wrap cards-sm"><table><caption className="sr-only">{CATEGORIAS[cat].nome}</caption>
                  <thead><tr><th>Produto</th><th className="r">Vendido no ano</th><th className="r">Média/mês</th><th className="r">Melhor mês</th><th className="r">Meses com venda</th><th className="r">Tendência</th><th className="r">Último mês</th><th>Fornecedor</th></tr></thead>
                  <tbody>{porCat(cat).sort((a, b) => (diag.get(b.id)!.valor) - (diag.get(a.id)!.valor)).slice(0, 300).map(i => { const d = diag.get(i.id)!; return (
                    <tr key={i.id}>
                      <td className="wrap"><ItemLink id={i.id}>{i.nome}</ItemLink></td>
                      <td className="r" data-label="Vendido no ano">{dec(d.total)} un.<small>{brl(d.valor)}</small></td>
                      <td className="r" data-label="Média/mês">{dec(Math.round(d.media * 10) / 10)}</td>
                      <td className="r" data-label="Melhor mês">{d.melhorQtd ? `${MESES[d.melhorMes]} (${dec(d.melhorQtd)})` : '—'}</td>
                      <td className="r" data-label="Meses com venda">{d.mesesComVenda} de {completos}</td>
                      <td className="r" data-label="Tendência"><Var v={d.tendencia} /></td>
                      <td className="r" data-label="Último mês"><Var v={d.ultimoVsAnterior} /></td>
                      <td data-label="Fornecedor">{i.fornecedor}</td>
                    </tr>) })}</tbody></table></div>
              )}
            </>
          )}

          {aba === 'embalagens' && (completos < 6 ? <Empty>É preciso ter pelo menos 6 meses fechados no ano para comparar.</Empty> : !linhas.length ? <Empty>Nenhuma linha de produto com troca relevante de embalagem.</Empty> : (
            <>
              <p className="hint">Linhas de produto vendidas em mais de um tamanho. Comparamos o peso (ou volume) vendido de cada embalagem nos últimos 3 meses fechados com os 3 anteriores. Quando a maior perde espaço, indicamos a causa provável: preço por kg da maior subiu, ela ficou sem vender (possível falta), a linha inteira caiu (mercado) ou, sem nenhuma dessas, escolha dos clientes.</p>
              {linhas.slice(0, 60).map(l => (
                <section key={l.chave} className="aud-card mix-linha">
                  <h3>{l.nome}<span className="muted">{l.variacaoDemanda !== null ? `linha ${l.variacaoDemanda >= 0 ? '+' : ''}${pct(l.variacaoDemanda, 0)} em peso` : ''}</span></h3>
                  <div className="table-wrap"><table><caption className="sr-only">Embalagens</caption>
                    <thead><tr><th>Embalagem</th><th className="r">3 meses antes</th><th className="r">Últimos 3 meses</th><th className="r">Participação</th><th className="r">Preço por kg</th></tr></thead>
                    <tbody>{l.embalagens.map(e => (
                      <tr key={e.tamanho}><td><ItemLink id={e.id}>{e.texto}</ItemLink></td><td className="r">{dec(e.antes)} un.</td><td className="r">{dec(e.depois)} un.</td>
                        <td className="r">{pct(e.partAntes, 0)} → <b>{pct(e.partDepois, 0)}</b></td>
                        <td className="r">{e.precoKgAntes ? brl(e.precoKgAntes) : '—'} → {e.precoKgDepois ? brl(e.precoKgDepois) : '—'}</td></tr>))}</tbody>
                  </table></div>
                  <ul className="mix-causas">{l.causas.map(c => <li key={c}>{c}</li>)}</ul>
                  {aberta === l.chave ? <DetalheLinha linha={l} /> : <button type="button" className="btn secondary small" onClick={() => setAberta(l.chave)}><Users size={14} aria-hidden />Ver clientes que trocaram</button>}
                </section>))}
            </>
          ))}
        </div>
      )}
    </>
  )
}

// Para testes e outras telas.
export { linhaDe, tamanho }
