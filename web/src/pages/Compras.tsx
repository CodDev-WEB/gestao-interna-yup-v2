import { type Page, useApi } from '../api'
import { brl, data, dec, int, pct } from '../format'
import { AvisoCarga, type Carga, CLASSES, ClasseTag } from '../gestao'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, useParam, useTableState } from '../ui'

type Item = {
  idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; secao: string | null; classe: string
  estoque: number | string; custo: number | string | null; venda_media_diaria: number | string; desvio_diario: number | string
  estoque_seguranca: number | string; ponto_pedido: number | string; estoque_maximo: number | string; demanda_erratica: boolean
  em_ruptura: boolean; sugestao_compra: number | string; valor_sugestao: number | string | null; cobertura_dias: number | string | null
  ultimo_preco_compra: number | null; ultimo_fornecedor: string | null; ultima_compra: string | null; referencia: string
}
type Param = { classe: string; nivel_servico: number | string; prazo_entrega_dias: number; revisao_dias: number }
type Resp = Page<Item> & { carga: Carga; parametros: Param[] }

const PAGE = 50

export default function Compras() {
  const [classe, setClasse] = useParam('classe')
  const [ruptura, setRuptura] = useParam('ruptura')
  const [busca, setBusca] = useParam('busca')
  // Sem ordem escolhida, a API ordena por prioridade: classe A primeiro, itens em falta, maior venda.
  const t = useTableState('prioridade')
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((t.page - 1) * PAGE), ordem: t.sort, dir: t.dir })
  if (classe) qs.set('classe', classe); if (ruptura) qs.set('ruptura', '1'); if (busca) qs.set('busca', busca)
  const { data: p, error, loading, reload } = useApi<Resp>(`dash/reposicao?${qs}`)

  const cols: Col<Item>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, sort: true, render: r => <><ItemLink id={r.idmercadoriavariacao}>{r.descricao || `Variação ${r.idmercadoriavariacao}`}</ItemLink><small>{r.codigobarras || 'sem código de barras'} · {r.secao || 'sem seção'}</small></> },
    { key: 'classe', label: 'Classe', render: r => <ClasseTag classe={r.classe} /> },
    { key: 'estoque', label: 'Estoque', right: true, sort: true, render: r => <>{r.em_ruptura ? <span className="status-bad">{dec(r.estoque)}</span> : dec(r.estoque)}{r.em_ruptura && <small>em falta</small>}</> },
    { key: 'venda_media_diaria', label: 'Venda por dia', right: true, sort: true, render: r => <>{dec(r.venda_media_diaria)}{r.demanda_erratica && <small>demanda irregular</small>}</> },
    { key: 'ponto_pedido', label: 'Ponto de pedido', right: true, render: r => <>{int(r.ponto_pedido)}<small>segurança {int(r.estoque_seguranca)}</small></> },
    { key: 'estoque_maximo', label: 'Máximo', right: true, sm: false, render: r => int(r.estoque_maximo) },
    { key: 'sugestao_compra', label: 'Comprar', right: true, sort: true, className: 'money', render: r => int(r.sugestao_compra) },
    { key: 'valor_sugestao', label: 'Valor (custo)', right: true, sort: true, render: r => r.valor_sugestao === null ? <span className="muted">sem custo</span> : brl(r.valor_sugestao) },
    { key: 'compra', label: 'Última compra', right: true, sm: false, render: r => r.ultimo_preco_compra === null ? <span className="muted">—</span> : <>{brl(r.ultimo_preco_compra)}<small>{r.ultimo_fornecedor ?? '—'} · {data(r.ultima_compra)}</small></> },
  ]
  const param = (c: string) => p?.parametros.find(x => x.classe === c)

  return (
    <>
      <PageHead section="COMPRAS" title="Compras sugeridas">
        Itens que chegaram ao ponto de pedido: a venda esperada durante o prazo de entrega mais uma reserva para a variação da demanda. A quantidade leva o estoque até o máximo da classe.
      </PageHead>
      <AvisoCarga carga={p?.carga ?? null} oQue="A sugestão usa a venda dos últimos 90 dias carregados e o estoque de hoje, então vale como conferência, não como pedido, até a carga chegar a hoje." />
      <div className="controls">
        <div className="chips" role="group" aria-label="Classe">
          <button className="chip" aria-pressed={!classe} onClick={() => setClasse('')}>Todas as classes</button>
          {CLASSES.map(c => <button key={c.id} className="chip" aria-pressed={classe === c.id} onClick={() => setClasse(c.id)} title={c.desc}>{c.nome}</button>)}
        </div>
        <div className="chips" role="group" aria-label="Situação">
          <button className="chip" aria-pressed={!ruptura} onClick={() => setRuptura('')}>Tudo que chegou ao ponto</button>
          <button className="chip" aria-pressed={!!ruptura} onClick={() => setRuptura('1')}>Só os que estão em falta</button>
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar produto" />
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum item precisa de compra com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Compras sugeridas" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={PAGE} onPage={t.onPage} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={r => String(r.idmercadoriavariacao)} />
      )}
      {p && p.parametros.length > 0 && (
        <section className="panel section" aria-labelledby="param-h">
          <h2 id="param-h">Como a sugestão é calculada</h2>
          <p className="hint">Ponto de pedido = venda média diária × prazo de entrega + z × desvio diário × √prazo. Máximo = ponto de pedido + venda média × dias entre revisões. Itens com desvio maior que a média têm demanda irregular: confira antes de comprar. Venda dos 90 dias até {data(p.rows[0]?.referencia ?? null)}.</p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Parâmetros por classe</caption>
              <thead><tr><th>Classe</th><th className="r">Nível de serviço</th><th className="r">Prazo de entrega</th><th className="r">Revisão</th></tr></thead>
              <tbody>
                {CLASSES.map(c => { const x = param(c.id); return x ? (
                  <tr key={c.id}><td><ClasseTag classe={c.id} /> {c.desc}</td><td className="r">{pct(Number(x.nivel_servico) * 100, 0)}</td><td className="r">{int(x.prazo_entrega_dias)} dias</td><td className="r">a cada {int(x.revisao_dias)} dias</td></tr>
                ) : null })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>O prazo de entrega padrão é de 7 dias. Para mudar por classe, edite a tabela <code>cfg_reposicao</code> no Supabase.</p>
        </section>
      )}
    </>
  )
}
