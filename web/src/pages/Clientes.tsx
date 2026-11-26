import { type Page, useApi } from '../api'
import { brl, data, int } from '../format'
import { SEGMENTOS } from '../labels'
import { ClienteLink } from '../ClientePainel'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, useParam, useTableState } from '../ui'

type Cliente = { idcliente: number; nome: string | null; compras: number; valor_total: number | string; ticket_medio: number | string; ultima_compra: string; recencia_dias: number; intervalo_medio_dias: number | string | null; proxima_compra_prevista: string | null; segmento: string }

const nomeSeg = (id: string) => SEGMENTOS.find(s => s.id === id)?.nome ?? id

export default function Clientes() {
  const [seg, setSeg] = useParam('segmento')
  const [busca, setBusca] = useParam('busca')
  const [recompra, setRecompra] = useParam('recompra')
  const [ultima, setUltima] = useParam('ultima')
  const [minValor, setMinValor] = useParam('min_valor')
  const [minCompras, setMinCompras] = useParam('min_compras')
  const t = useTableState('valor_total')
  const qs = new URLSearchParams({ limit: String(t.pageSize), offset: String((t.page - 1) * t.pageSize), ordem: t.sort, dir: t.dir })
  if (seg) qs.set('segmento', seg); if (busca) qs.set('busca', busca)
  if (recompra) qs.set('recompra', recompra); if (ultima) qs.set('ultima', ultima); if (minValor) qs.set('min_valor', minValor); if (minCompras) qs.set('min_compras', minCompras)
  const filtrosAtivos = [recompra, ultima, minValor, minCompras].filter(Boolean).length
  const { data: p, error, loading, reload } = useApi<Page<Cliente>>(`dash/clientes?${qs}`)
  const { data: contagem } = useApi<Record<string, number>>('dash/clientes-segmentos')
  const atual = SEGMENTOS.find(s => s.id === seg)

  const cols: Col<Cliente>[] = [
    { key: 'nome', label: 'Cliente', wrap: true, render: c => <ClienteLink id={c.idcliente}>{c.nome || `Cliente ${c.idcliente}`}</ClienteLink> },
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
      <div className="controls filtros-cli" role="group" aria-label="Filtros">
        <label>Recompra
          <select className="select" value={recompra} onChange={e => setRecompra(e.target.value)}>
            <option value="">Qualquer</option><option value="atrasada">Atrasados para voltar</option><option value="em_dia">Dentro do ritmo</option>
          </select></label>
        <label>Última compra
          <select className="select" value={ultima} onChange={e => setUltima(e.target.value)}>
            <option value="">Qualquer data</option><option value="30">Nos últimos 30 dias</option><option value="90">Entre 31 e 90 dias</option><option value="180">Entre 91 e 180 dias</option><option value="180+">Há mais de 180 dias</option>
          </select></label>
        <label>Já gastou
          <select className="select" value={minValor} onChange={e => setMinValor(e.target.value)}>
            <option value="">Qualquer valor</option><option value="500">R$ 500 ou mais</option><option value="1000">R$ 1.000 ou mais</option><option value="5000">R$ 5.000 ou mais</option><option value="10000">R$ 10.000 ou mais</option>
          </select></label>
        <label>Compras
          <select className="select" value={minCompras} onChange={e => setMinCompras(e.target.value)}>
            <option value="">Qualquer número</option><option value="2">2 ou mais</option><option value="5">5 ou mais</option><option value="10">10 ou mais</option><option value="20">20 ou mais</option>
          </select></label>
        {filtrosAtivos > 0 && <button type="button" className="btn secondary" onClick={() => { setRecompra(''); setUltima(''); setMinValor(''); setMinCompras('') }}>Limpar filtros</button>}
      </div>
      {recompra === 'atrasada' && <p className="hint"><strong>Atrasados para voltar:</strong> passaram da data em que costumam comprar de novo, nos últimos 180 dias. São os melhores para um contato agora. Clique no nome para ver o que oferecer.</p>}
      {atual && <p className="hint"><strong>{atual.nome}:</strong> {atual.desc}.</p>}
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum cliente com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Clientes" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={t.pageSize} onPage={t.onPage} onPageSize={t.onPageSize} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={c => String(c.idcliente)} />
      )}
    </>
  )
}
