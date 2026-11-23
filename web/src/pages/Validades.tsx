import { type Page, useApi } from '../api'
import { brl, brlCurto, data, dec, int } from '../format'
import { FAIXAS, faixa } from '../labels'
import { AlertTriangle, CalendarClock, CalendarX, Clock } from 'lucide-react'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, Metric, PageHead, SearchBox, useParam, useTableState } from '../ui'

type Lote = { idmercadoriavariacao: number; descricao: string | null; lote: string; dtvalidade: string; qtdsaldo: number | string; dias_para_vencer: number; faixa: string; valor_em_risco: number | string | null; venda_media_diaria: number | string | null; dias_para_vender: number | string | null; risco_perda: boolean; idlocalestoque: number; dtentrada: string; qtd_lote?: number | string; estoque_item?: number | string; qtd_ja_saiu?: number | string }
type Resumo = { faixa: string; lotes: number; valor: number | string; lotes_em_risco: number; valor_em_risco: number | string | null; unidades?: number | string; unidades_em_risco?: number | string; produtos?: number }

const PAGE = 50

export default function Validades() {
  const [fx, setFx] = useParam('faixa')
  const [risco, setRisco] = useParam('risco')
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('dias_para_vencer', 'asc')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (fx) qs.set('faixa', fx); if (risco) qs.set('risco', '1'); if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Page<Lote>>(`dash/lotes?${qs}`)
  const { data: res } = useApi<Resumo[]>('dash/lotes-resumo')
  const r = (id: string) => res?.find(x => x.faixa === id)

  const cols: Col<Lote>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, render: l => <><ItemLink id={l.idmercadoriavariacao}>{l.descricao || `Variação ${l.idmercadoriavariacao}`}</ItemLink><small>Lote {l.lote} · entrada {data(l.dtentrada)}{l.estoque_item !== undefined ? ` · ${dec(l.estoque_item)} un. em estoque no total` : ''}</small></> },
    { key: 'dias_para_vencer', label: 'Validade', sort: true, render: l => { const f = faixa(l.faixa); return <><span className={f.classe}>{data(l.dtvalidade)}</span><small>{l.dias_para_vencer < 0 ? `venceu há ${-l.dias_para_vencer} dias` : `em ${l.dias_para_vencer} dias`}</small></> } },
    { key: 'qtdsaldo', label: 'Unidades disponíveis', right: true, sort: true, render: l => <>{dec(l.qtdsaldo)}{Number(l.qtd_ja_saiu ?? 0) > 0 && <small>lote tinha {dec(l.qtd_lote)}</small>}</> },
    { key: 'valor_em_risco', label: 'Valor (custo)', right: true, sort: true, className: 'money', render: l => brl(l.valor_em_risco) },
    { key: 'vmd', label: 'Venda por dia', right: true, sm: false, render: l => dec(l.venda_media_diaria) },
    { key: 'dpv', label: 'Dias para vender', right: true, render: l => l.dias_para_vender === null ? 'sem venda' : int(l.dias_para_vender) },
    { key: 'risco', label: 'Risco de perda', render: l => l.risco_perda ? <span className="pill bad">Não vende a tempo</span> : <span className="pill good">Vende antes</span> },
  ]

  return (
    <>
      <PageHead section="VALIDADES" title="Validades">
        Unidades realmente disponíveis em estoque e a validade de cada uma, vencendo em até 90 dias. Como o ERP não baixa o lote na venda, o estoque atual do item é repartido entre os lotes, considerando que sai primeiro o que vence primeiro; lote cujas unidades já saíram não aparece. Ordem: o que vence primeiro aparece primeiro; os já vencidos ficam juntos no fim da lista (ou no cartão Vencido). O risco considera a venda média dos últimos 90 dias.
      </PageHead>
      <div className="metrics" style={{ marginBottom: 18 }}>
        {FAIXAS.slice(0, 4).map((f, i) => {
          const n = Number(r(f.id)?.unidades ?? 0), nl = r(f.id)?.lotes ?? 0
          const Icon = [CalendarX, AlertTriangle, Clock, CalendarClock][i]
          return (
            <Metric key={f.id} icon={<Icon size={18} />} tone={n > 0 ? f.tom as 'red' | 'gold' : 'blue'} label={f.nome}
              value={`${dec(n)} ${n === 1 ? 'unidade' : 'unidades'}`} valueClass={n > 0 ? f.classe : ''}
              detail={`${int(r(f.id)?.produtos ?? 0)} produtos, ${int(nl)} ${nl === 1 ? 'lote' : 'lotes'} · ${brlCurto(r(f.id)?.valor ?? 0)} a custo · ${dec(r(f.id)?.unidades_em_risco ?? 0)} un. em risco`}
              onClick={() => setFx(fx === f.id ? '' : f.id)} pressed={fx === f.id} />
          )
        })}
      </div>
      <div className="controls">
        <div className="chips" role="group" aria-label="Filtro de risco">
          <button className="chip" aria-pressed={!risco} onClick={() => setRisco('')}>Todos os lotes</button>
          <button className="chip" aria-pressed={!!risco} onClick={() => setRisco('1')}>Só os que não vendem a tempo</button>
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar produto" />
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhuma unidade disponível com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Unidades disponíveis por validade" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={l => `${l.idlocalestoque}-${l.idmercadoriavariacao}-${l.lote}-${l.dtvalidade}-${l.dtentrada}`} />
      )}
    </>
  )
}
