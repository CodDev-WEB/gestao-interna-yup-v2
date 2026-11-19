import { type Page, useApi } from '../api'
import { brl, data, int } from '../format'
import { SEGMENTOS } from '../labels'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, useParam, useTableState } from '../ui'

type Cliente = { idcliente: number; nome: string | null; compras: number; valor_total: number | string; ticket_medio: number | string; ultima_compra: string; recencia_dias: number; intervalo_medio_dias: number | string | null; proxima_compra_prevista: string | null; segmento: string }

const PAGE = 50
const nomeSeg = (id: string) => SEGMENTOS.find(s => s.id === id)?.nome ?? id

export default function Clientes() {
  const [seg, setSeg] = useParam('segmento')
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('valor_total')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (seg) qs.set('segmento', seg); if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Page<Cliente>>(`dash/clientes?${qs}`)
  const { data: contagem } = useApi<Record<string, number>>('dash/clientes-segmentos')
  const atual = SEGMENTOS.find(s => s.id === seg)

  const cols: Col<Cliente>[] = [
    { key: 'nome', label: 'Cliente', wrap: true, render: c => <span className="title">{c.nome || `Cliente ${c.idcliente}`}</span> },
    { key: 'segmento', label: 'Segmento', render: c => <span className={`pill ${c.segmento === 'em_risco' ? 'bad' : c.segmento === 'vip' ? 'good' : c.segmento === 'inativo' ? 'warn' : 'neutral'}`}>{nomeSeg(c.segmento)}</span> },
    { key: 'valor_total', label: 'Total comprado', right: true, sort: true, className: 'money', render: c => brl(c.valor_total) },
    { key: 'compras', label: 'Compras', right: true, sort: true, render: c => int(c.compras) },
    { key: 'ticket_medio', label: 'Ticket médio', right: true, sort: true, sm: false, render: c => brl(c.ticket_medio) },
    { key: 'ultima_compra', label: 'Última compra', right: true, sort: true, render: c => data(c.ultima_compra) },
    { key: 'recencia_dias', label: 'Dias sem comprar', right: true, sort: true, render: c => int(c.recencia_dias) },
    { key: 'intervalo', label: 'Compra a cada', right: true, sm: false, render: c => c.intervalo_medio_dias === null ? '—' : `${int(c.intervalo_medio_dias)} dias` },
    { key: 'proxima_compra_prevista', label: 'Próxima compra prevista', right: true, sort: true, render: c => data(c.proxima_compra_prevista) },
  ]

  return (
    <>
      <PageHead section="CLIENTES" title="Clientes">
        Quem compra, com que frequência e quem parou de voltar. Vendas sem cliente identificado ficam de fora.
      </PageHead>
      <div className="controls">
        <div className="chips" role="group" aria-label="Segmento">
          <button className="chip" aria-pressed={!seg} onClick={() => setSeg('')}>Todos</button>
          {SEGMENTOS.map(s => <button key={s.id} className="chip" aria-pressed={seg === s.id} onClick={() => setSeg(s.id)} title={s.desc}>{s.nome}{contagem && <span className="count">{int(contagem[s.id])}</span>}</button>)}
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar cliente" />
      </div>
      {atual && <p className="hint"><strong>{atual.nome}:</strong> {atual.desc}.</p>}
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum cliente com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Clientes" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={c => String(c.idcliente)} />
      )}
    </>
  )
}
