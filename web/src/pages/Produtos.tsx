import { type Page, useApi } from '../api'
import { brl, data, dec, int, pct } from '../format'
import { SETORES, SITUACOES, situacao } from '../labels'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, Tabs, useParam, useTableState } from '../ui'

type Produto = {
  idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; setor: string; secao: string | null; situacao: string
  estoque_atual: number | string; valor_estoque: number | string | null; qtd_90d: number | string; faturamento_90d: number | string
  margem_90d_pct: number | string | null; ultima_venda: string | null; dias_sem_venda: number | null; cobertura_dias: number | string | null
  ultimo_preco_compra: number | null; ultimo_fornecedor: string | null; ultima_compra: string | null
}
type Declinio = { idmercadoriavariacao: number; descricao: string | null; qtd_3_meses_atras: number | string; qtd_2_meses_atras: number | string; qtd_mes_passado: number | string; variacao_pct: number | string | null; estoque_atual: number | string }

const PAGE = 50

function Lista() {
  const [sit, setSit] = useParam('situacao')
  const [setor, setSetor] = useParam('setor')
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('valor_estoque')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (sit) qs.set('situacao', sit); if (setor) qs.set('setor', setor); if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Page<Produto>>(`dash/produtos?${qs}`)
  const s = sit ? situacao(sit) : null

  const cols: Col<Produto>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, sort: true, render: r => <><ItemLink id={r.idmercadoriavariacao}>{r.descricao || `Variação ${r.idmercadoriavariacao}`}</ItemLink><small>{r.codigobarras || '—'} · {r.secao || 'sem seção'}</small></> },
    { key: 'situacao', label: 'Situação', render: r => { const x = situacao(r.situacao); return <span className="tag"><i style={{ background: x.cor }} aria-hidden />{x.nome}</span> } },
    { key: 'estoque_atual', label: 'Estoque', right: true, sort: true, render: r => dec(r.estoque_atual) },
    { key: 'valor_estoque', label: 'Valor (custo)', right: true, sort: true, className: 'money', render: r => brl(r.valor_estoque) },
    { key: 'compra', label: 'Último preço de compra', right: true, render: r => r.ultimo_preco_compra === null ? <span className="muted">—</span> : <>{brl(r.ultimo_preco_compra)}<small>{r.ultimo_fornecedor ?? '—'} · {data(r.ultima_compra)}</small></> },
    { key: 'qtd_90d', label: 'Vendido 90d', right: true, sort: true, render: r => dec(r.qtd_90d) },
    { key: 'faturamento_90d', label: 'Faturamento 90d', right: true, sort: true, sm: false, render: r => brl(r.faturamento_90d) },
    { key: 'margem_90d_pct', label: 'Margem 90d', right: true, sort: true, sm: false, render: r => pct(r.margem_90d_pct) },
    { key: 'ultima_venda', label: 'Última venda', right: true, sort: true, sm: false, render: r => data(r.ultima_venda) },
    { key: 'dias_sem_venda', label: 'Dias sem venda', right: true, sort: true, render: r => int(r.dias_sem_venda) },
    { key: 'cobertura_dias', label: 'Cobertura (dias)', right: true, sort: true, sm: false, render: r => int(r.cobertura_dias) },
  ]

  return (
    <>
      <div className="controls">
        <div className="chips" role="group" aria-label="Situação">
          <button className="chip" aria-pressed={!sit} onClick={() => setSit('')}>Todas</button>
          {SITUACOES.map(x => <button key={x.id} className="chip" aria-pressed={sit === x.id} onClick={() => setSit(x.id)} title={x.desc}><i style={{ background: x.cor }} aria-hidden />{x.nome}</button>)}
        </div>
      </div>
      <div className="controls">
        <select className="select" value={setor} onChange={e => setSetor(e.target.value)} aria-label="Setor">
          <option value="">Todos os setores</option>
          {[...SETORES, 'Não classificado'].map(x => <option key={x}>{x}</option>)}
        </select>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar produto" />
      </div>
      {s && <p className="hint"><strong>{s.nome}:</strong> {s.desc}.</p>}
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum produto com esses filtros.</Empty> : (
        <DataTable caption="Produtos" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={r => String(r.idmercadoriavariacao)} />
      )}
      {loading && p && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}

function Declinio() {
  const t = useTableState('qtd_3_meses_atras')
  const { data: p, error, reload } = useApi<Page<Declinio>>(`dash/declinio?limit=${PAGE}&offset=${(t.page - 1) * PAGE}`)
  const cols: Col<Declinio>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, render: r => <ItemLink id={r.idmercadoriavariacao}>{r.descricao || `Variação ${r.idmercadoriavariacao}`}</ItemLink> },
    { key: 'm3', label: 'Há 3 meses', right: true, render: r => dec(r.qtd_3_meses_atras) },
    { key: 'm2', label: 'Há 2 meses', right: true, render: r => dec(r.qtd_2_meses_atras) },
    { key: 'm1', label: 'Mês passado', right: true, render: r => dec(r.qtd_mes_passado) },
    { key: 'var', label: 'Variação', right: true, render: r => <span className="down">{pct(r.variacao_pct)}</span> },
    { key: 'est', label: 'Estoque atual', right: true, render: r => dec(r.estoque_atual) },
  ]
  return (
    <>
      <p className="hint">Unidades vendidas em cada um dos últimos 3 meses fechados, só produtos com queda mês a mês. Estoque zerado indica que a queda pode ser falta de produto, não de procura.</p>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum produto com queda nos últimos 3 meses.</Empty> : (
        <DataTable caption="Produtos em declínio" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} rowKey={r => String(r.idmercadoriavariacao)} />
      )}
    </>
  )
}

export default function Produtos() {
  const [aba, setAba] = useParam('aba', 'lista')
  return (
    <>
      <PageHead section="PRODUTOS" title="Produtos e estoque"
        actions={<Tabs label="Visão" value={aba} onChange={setAba} options={[{ id: 'lista', label: 'Por situação' }, { id: 'declinio', label: 'Em declínio' }]} />}>
        Cada variação com estoque, valor a custo, giro dos últimos 90 dias e a situação que pede ação.
      </PageHead>
      {aba === 'declinio' ? <Declinio /> : <Lista />}
    </>
  )
}
