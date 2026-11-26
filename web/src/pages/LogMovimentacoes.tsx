// Log de movimentações de todos os itens: filtros por período, tipo, quem lançou e produto.
import { useApi, type Page } from '../api'
import { celulas, TIPOS_LOG, type Mov, type RespLog } from '../LogMovimentos'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, useParam, useTableState } from '../ui'

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())
const menos = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd - d)).toISOString().slice(0, 10) }

export default function LogMovimentacoes() {
  const [de, setDe] = useParam('de', menos(hoje(), 6))
  const [ate, setAte] = useParam('ate', hoje())
  const [tipo, setTipo] = useParam('tipo')
  const [usuario, setUsuario] = useParam('usuario')
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('datahora', 'desc')
  const qs = new URLSearchParams({ limit: String(t.pageSize), offset: String((t.page - 1) * t.pageSize), de, ate })
  if (tipo) qs.set('tipo', tipo); if (usuario) qs.set('usuario', usuario); if (busca) qs.set('busca', busca)
  const { data: r, error, loading, reload } = useApi<RespLog>(`dash/log?${qs}`)
  const { data: usuarios } = useApi<{ id: number; nome: string; movimentos: number }[]>('dash/log-usuarios')
  const page: Page<Mov> | null = r ? { rows: r.linhas, total: r.total } : null

  const cols: Col<Mov>[] = [
    { key: 'produto', label: 'Produto', wrap: true, render: m => celulas(m, true).produto },
    { key: 'quando', label: 'Quando', render: m => celulas(m, true).quando },
    { key: 'operacao', label: 'Operação', className: 'col-op', render: m => celulas(m, true).operacao },
    { key: 'mov', label: 'Movimento', right: true, render: m => celulas(m, true).movimento },
    { key: 'valor', label: 'Valor', right: true, className: 'money', render: m => celulas(m, true).valor },
    { key: 'quem', label: 'Quem lançou', render: m => celulas(m, true).quem },
  ]

  return (
    <>
      <PageHead section="Estoque" title="Log de movimentações">
        Tudo o que mudou nos itens: vendas, entradas, saídas, ajustes, devoluções e mudanças de preço, com quem lançou no ERP, data e hora, o documento e o saldo antes e depois. O mais recente aparece primeiro.
      </PageHead>
      <div className="toolbar">
        <label className="field-inline">De <input className="input" type="date" value={de} max={ate} onChange={e => e.target.value && setDe(e.target.value)} /></label>
        <label className="field-inline">Até <input className="input" type="date" value={ate} min={de} onChange={e => e.target.value && setAte(e.target.value)} /></label>
        <label className="field-inline">Tipo
          <select className="select" value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="entradas">Só o que aumentou o estoque</option>
            <option value="saidas">Só o que diminuiu o estoque</option>
            {TIPOS_LOG.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </label>
        <label className="field-inline">Quem lançou
          <select className="select" value={usuario} onChange={e => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {(usuarios ?? []).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <SearchBox value={busca} onChange={setBusca} placeholder="Produto: nome ou código" />
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !page ? <Loading /> : page.rows.length === 0 ? <Empty>Nenhuma movimentação com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Log de movimentações" cols={cols} rows={page.rows} total={page.total} page={t.page} pageSize={t.pageSize} onPage={t.onPage} onPageSize={t.onPageSize} rowKey={m => m.id} />
      )}
    </>
  )
}
