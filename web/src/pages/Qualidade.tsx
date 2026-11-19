import { AlertTriangle, Barcode, CalendarX, FileWarning, MinusCircle } from 'lucide-react'
import { type Page, useApi } from '../api'
import { brl, brlCurto, dec, int } from '../format'
import { AvisoCarga, CLASSES, ClasseTag, PROBLEMAS, problema, type ResumoQualidade } from '../gestao'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, Metric, PageHead, SearchBox, useParam, useTableState } from '../ui'

type Linha = {
  idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; secao: string | null; classe: string
  faturamento: number | string; estoque: number | string; problema: string; valor: number | string | null; detalhe: string
}

const PAGE = 50
const ICONES = { estoque_negativo: MinusCircle, lote_vencido: CalendarX, sem_codigo_barras: Barcode, ncm_invalido: FileWarning, sem_custo: AlertTriangle } as const

export default function Qualidade() {
  const [prob, setProb] = useParam('problema')
  const [classe, setClasse] = useParam('classe')
  const [busca, setBusca] = useParam('busca')
  const t = useTableState('prioridade')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (prob) qs.set('problema', prob); if (classe) qs.set('classe', classe); if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Page<Linha>>(`dash/qualidade?${qs}`)
  const { data: res } = useApi<ResumoQualidade>('dash/qualidade-resumo')
  const r = (id: string) => res?.problemas.find(x => x.problema === id)
  const semCusto = r('venda_sem_custo')?.itens ?? 0

  const cols: Col<Linha>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, sort: true, render: l => <><ItemLink id={l.idmercadoriavariacao}>{l.descricao || `Variação ${l.idmercadoriavariacao}`}</ItemLink><small>{l.codigobarras || 'sem código de barras'} · {l.secao || 'sem seção'}</small></> },
    { key: 'classe', label: 'Classe', render: l => <ClasseTag classe={l.classe} /> },
    { key: 'problema', label: 'Problema', wrap: true, render: l => <>{problema(l.problema).nome}<small>{l.detalhe}</small></> },
    { key: 'estoque', label: 'Estoque', right: true, sort: true, render: l => dec(l.estoque) },
    { key: 'valor', label: 'Valor envolvido', right: true, sort: true, className: 'money', render: l => l.valor === null ? <span className="muted">—</span> : brl(l.valor) },
    { key: 'faturamento', label: 'Vendeu no ano', right: true, sort: true, sm: false, render: l => brlCurto(l.faturamento) },
  ]

  return (
    <>
      <PageHead section="QUALIDADE DO DADO" title="Qualidade do dado">
        O que no cadastro e no estoque do ERP distorce as análises. Corrija primeiro os itens da classe A: são os que mais vendem, e um erro neles vira ruptura, excesso ou margem errada.
      </PageHead>
      <AvisoCarga carga={res?.carga ?? null} oQue="Enquanto isso, margem, ruptura e giro ainda não são confiáveis." />
      {semCusto > 0 && (
        <div className="notice info" role="status">
          <AlertTriangle size={18} aria-hidden />
          <div>{int(semCusto)} itens vendidos nos últimos 90 dias carregados ainda estão sem custo. Até o custo chegar do ERP, o lucro e a margem dessas vendas ficam em branco.</div>
        </div>
      )}
      <div className="metrics metrics-5" style={{ marginBottom: 18 }}>
        {PROBLEMAS.map(x => {
          const v = r(x.id), n = v?.itens ?? 0, Icon = ICONES[x.id]
          return (
            <Metric key={x.id} icon={<Icon size={18} />} tone={n > 0 ? 'red' : 'green'} label={x.nome}
              value={int(n)} detail={`${int(v?.itens_a ?? 0)} da classe A${v && Number(v.valor) > 0 ? ` · ${brlCurto(v.valor)}` : ''}`}
              onClick={() => setProb(prob === x.id ? '' : x.id)} pressed={prob === x.id} />
          )
        })}
      </div>
      {prob && <p className="hint"><strong>{problema(prob).nome}:</strong> {problema(prob).desc}</p>}
      <div className="controls">
        <div className="chips" role="group" aria-label="Classe">
          <button className="chip" aria-pressed={!classe} onClick={() => setClasse('')}>Todas as classes</button>
          {CLASSES.map(c => <button key={c.id} className="chip" aria-pressed={classe === c.id} onClick={() => setClasse(c.id)} title={c.desc}>{c.nome}</button>)}
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar produto" />
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum problema com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Problemas de dado por item" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={l => `${l.problema}-${l.idmercadoriavariacao}`} />
      )}
      <p className="hint" style={{ marginTop: 16 }}>As correções são feitas no ERP. O painel lê de novo a cada sincronização e o item sai desta lista sozinho.</p>
    </>
  )
}
