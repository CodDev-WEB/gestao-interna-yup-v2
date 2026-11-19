import { Link } from 'react-router-dom'
import { type Page, useApi } from '../api'
import { brl, data, int, pct } from '../format'
import { X } from 'lucide-react'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, Tabs, useParam, useTableState } from '../ui'

type Forn = { idfornecedor: number; nome: string | null; total_comprado: number | string; compras: number; ticket_medio: number | string; skus: number; primeira_compra: string; ultima_compra: string; participacao_pct: number | string }
type Preco = { idfornecedor: number; idmercadoriavariacao: number; descricao: string | null; compras: number; menor_preco: number | string; maior_preco: number | string; preco_medio_ponderado: number | string; ultimo_preco: number | string; penultimo_preco: number | string | null; variacao_ultima_pct: number | string | null; ultima_compra: string }

const PAGE = 50

function Resumo() {
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('total_comprado')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Page<Forn>>(`dash/fornecedores?${qs}`)
  const cols: Col<Forn>[] = [
    { key: 'nome', label: 'Fornecedor', wrap: true, render: f => <Link to={`/fornecedores?aba=precos&fornecedor=${f.idfornecedor}`} title="Ver preços de compra deste fornecedor" className="title">{f.nome || `Pessoa ${f.idfornecedor}`}</Link> },
    { key: 'total_comprado', label: 'Total comprado', right: true, sort: true, className: 'money', render: f => brl(f.total_comprado) },
    { key: 'participacao_pct', label: 'Participação', right: true, sort: true, render: f => pct(f.participacao_pct) },
    { key: 'compras', label: 'Compras', right: true, sort: true, render: f => int(f.compras) },
    { key: 'ticket_medio', label: 'Ticket médio', right: true, sort: true, sm: false, render: f => brl(f.ticket_medio) },
    { key: 'skus', label: 'Itens', right: true, sort: true, sm: false, render: f => int(f.skus) },
    { key: 'ultima_compra', label: 'Última compra', right: true, sort: true, render: f => data(f.ultima_compra) },
  ]
  return (
    <>
      <div className="controls"><SearchBox value={busca} onChange={setBusca} placeholder="Buscar fornecedor" /></div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhuma compra encontrada.</Empty> : (
        <DataTable busy={loading} caption="Fornecedores" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={f => String(f.idfornecedor)} />
      )}
    </>
  )
}

function Precos() {
  const [min, setMin] = useParam('min')
  const [forn, setForn] = useParam('fornecedor')
  const t = useTableState('variacao_ultima_pct')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (min) qs.set('min', min); if (forn) qs.set('fornecedor', forn)
  const { data: p, error, loading, reload } = useApi<Page<Preco>>(`dash/precos?${qs}`)
  const cols: Col<Preco>[] = [
    { key: 'descricao', label: 'Item', wrap: true, render: x => <><ItemLink id={x.idmercadoriavariacao}>{x.descricao || `Variação ${x.idmercadoriavariacao}`}</ItemLink><small>Fornecedor {x.idfornecedor} · {int(x.compras)} compras</small></> },
    { key: 'penultimo', label: 'Penúltimo preço', right: true, render: x => brl(x.penultimo_preco) },
    { key: 'ultimo_preco', label: 'Último preço', right: true, sort: true, render: x => brl(x.ultimo_preco) },
    { key: 'variacao_ultima_pct', label: 'Variação', right: true, sort: true, render: x => { const v = Number(x.variacao_ultima_pct); return x.variacao_ultima_pct === null ? '—' : <span className={v > 0 ? 'down' : v < 0 ? 'up' : ''}>{v > 0 ? '▲ ' : v < 0 ? '▼ ' : ''}{pct(v)}</span> } },
    { key: 'faixa', label: 'Menor / maior', right: true, sm: false, render: x => `${brl(x.menor_preco)} / ${brl(x.maior_preco)}` },
    { key: 'medio', label: 'Médio ponderado', right: true, sm: false, render: x => brl(x.preco_medio_ponderado) },
    { key: 'ultima_compra', label: 'Última compra', right: true, sort: true, render: x => data(x.ultima_compra) },
  ]
  return (
    <>
      <div className="controls">
        <div className="chips" role="group" aria-label="Variação de preço">
          <button className="chip" aria-pressed={!min} onClick={() => setMin('')}>Todos os itens</button>
          <button className="chip" aria-pressed={min === '10'} onClick={() => setMin('10')}>Aumento de 10% ou mais</button>
          <button className="chip" aria-pressed={min === '1'} onClick={() => setMin('1')}>Qualquer aumento</button>
        </div>
        {forn && <button className="chip" aria-pressed onClick={() => setForn('')} aria-label={`Remover filtro do fornecedor ${forn}`}>Fornecedor {forn} <X size={14} aria-hidden /></button>}
      </div>
      <p className="hint">Preço unitário de compra (total do item ÷ quantidade). Variação compara a última compra com a anterior do mesmo fornecedor.</p>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum item com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Preços de compra" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={x => `${x.idfornecedor}-${x.idmercadoriavariacao}`} />
      )}
    </>
  )
}

export default function Fornecedores() {
  const [aba, setAba] = useParam('aba', 'resumo')
  const [min] = useParam('min')
  const ativa = min && aba === 'resumo' ? 'precos' : aba
  return (
    <>
      <PageHead section="FORNECEDORES" title="Fornecedores"
        actions={<Tabs label="Visão" value={ativa} onChange={setAba} options={[{ id: 'resumo', label: 'Quem fornece' }, { id: 'precos', label: 'Preços de compra' }]} />}>
        Quanto a Yup compra de cada fornecedor e como os preços de compra estão variando.
      </PageHead>
      {ativa === 'precos' ? <Precos /> : <Resumo />}
    </>
  )
}
