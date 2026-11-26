import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { type Page, useApi } from '../api'
import { AvisoCarga, CLASSES, ClasseTag } from '../gestao'
import { brl, data, dec, int, pct } from '../format'
import { SETORES, SITUACOES, situacao } from '../labels'
import { ItemLink } from '../ProdutoPainel'
import { type Col, DataTable, Empty, ErrorState, Loading, PageHead, SearchBox, Tabs, useParam, useTableState } from '../ui'
import { SelectSetorComercial } from '../setoresComerciais'

type Produto = {
  idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; setor: string; secao: string | null; situacao: string
  estoque_atual: number | string; valor_estoque: number | string | null; qtd_90d: number | string; faturamento_90d: number | string
  margem_90d_pct: number | string | null; ultima_venda: string | null; dias_sem_venda: number | null; cobertura_dias: number | string | null
  ultimo_preco_compra: number | null; ultimo_fornecedor: string | null; ultima_compra: string | null; classe?: string; setor_comercial?: string | null
}
type Declinio = { idmercadoriavariacao: number; descricao: string | null; qtd_3_meses_atras: number | string; qtd_2_meses_atras: number | string; qtd_mes_passado: number | string; variacao_pct: number | string | null; estoque_atual: number | string }


function Lista() {
  const [sit, setSit] = useParam('situacao')
  const [setor, setSetor] = useParam('setor')
  const [setorc, setSetorc] = useParam('setorc')
  const [busca, setBusca] = useParam('busca')
  const [ncm, setNcm] = useParam('ncm')
  const t = useTableState('valor_estoque')
  const qs = new URLSearchParams({ limit: String(t.pageSize), offset: String((t.page - 1) * t.pageSize), ordem: t.sort, dir: t.dir })
  if (sit) qs.set('situacao', sit); if (setor) qs.set('setor', setor); if (setorc) qs.set('setorc', setorc); if (busca) qs.set('busca', busca); if (ncm) qs.set('ncm', ncm)
  const { data: p, error, loading, reload } = useApi<Page<Produto>>(`dash/produtos?${qs}`)
  const s = sit ? situacao(sit) : null

  const cols: Col<Produto>[] = [
    { key: 'descricao', label: 'Produto', wrap: true, sort: true, render: r => <><ItemLink id={r.idmercadoriavariacao}>{r.descricao || `Variação ${r.idmercadoriavariacao}`}</ItemLink><small>{r.codigobarras || '—'} · {r.setor_comercial ?? r.secao ?? 'sem seção'}</small></> },
    { key: 'classe', label: 'Classe', render: r => <ClasseTag classe={r.classe} /> },
    { key: 'situacao', label: 'Situação', render: r => { const x = situacao(r.situacao); return <span className="tag"><i style={{ background: x.cor }} aria-hidden />{x.nome}</span> } },
    { key: 'estoque_atual', label: 'Estoque', right: true, sort: true, render: r => dec(r.estoque_atual) },
    { key: 'valor_estoque', label: 'Valor (custo)', right: true, sort: true, className: 'money', render: r => brl(r.valor_estoque) },
    { key: 'compra', label: 'Último preço de compra', right: true, render: r => r.ultimo_preco_compra === null ? <span className="muted">—</span> : <>{brl(r.ultimo_preco_compra)}<small>{r.ultimo_fornecedor ?? '—'} · {data(r.ultima_compra)}</small></> },
    { key: 'qtd_90d', label: 'Vendido 90d', right: true, sort: true, render: r => dec(r.qtd_90d) },
    { key: 'faturamento_90d', extra: true, label: 'Faturamento 90d', right: true, sort: true, sm: false, render: r => brl(r.faturamento_90d) },
    { key: 'margem_90d_pct', extra: true, label: 'Margem 90d', right: true, sort: true, sm: false, render: r => pct(r.margem_90d_pct) },
    { key: 'ultima_venda', extra: true, label: 'Última venda', right: true, sort: true, sm: false, render: r => data(r.ultima_venda) },
    { key: 'dias_sem_venda', label: 'Dias sem venda', right: true, sort: true, render: r => int(r.dias_sem_venda) },
    { key: 'cobertura_dias', extra: true, label: 'Cobertura (dias)', right: true, sort: true, sm: false, render: r => int(r.cobertura_dias) },
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
        <SelectSetorComercial value={setorc} onChange={setSetorc} />
        <select className="select" value={setor} onChange={e => setSetor(e.target.value)} aria-label="Setor pelo NCM">
          <option value="">Todos os setores (NCM)</option>
          {[...SETORES, 'Não classificado'].map(x => <option key={x}>{x}</option>)}
        </select>
        <SearchBox value={busca} onChange={setBusca} placeholder="Nome, código interno ou código de barras" />
        {ncm && <button className="chip" aria-pressed onClick={() => setNcm('')} aria-label="Remover filtro de NCM">{ncm === 'sem' ? 'Sem NCM' : `NCM ${ncm}…`} ✕</button>}
      </div>
      {s && <p className="hint"><strong>{s.nome}:</strong> {s.desc}.</p>}
      {error ? <ErrorState message={error} onRetry={reload} /> : !p ? <Loading /> : p.rows.length === 0 ? <Empty>Nenhum produto com esses filtros.</Empty> : (
        <DataTable busy={loading} caption="Produtos" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={t.pageSize} onPage={t.onPage} onPageSize={t.onPageSize} sort={t.sort} dir={t.dir} onSort={t.onSort} rowKey={r => String(r.idmercadoriavariacao)} />
      )}
      {loading && p && <span className="sr-only" aria-live="polite">Atualizando</span>}
    </>
  )
}

function Declinio() {
  const t = useTableState('qtd_3_meses_atras')
  const { data: p, error, loading, reload } = useApi<Page<Declinio>>(`dash/declinio?limit=${t.pageSize}&offset=${(t.page - 1) * t.pageSize}`)
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
        <DataTable busy={loading} caption="Produtos em declínio" cols={cols} rows={p.rows} total={p.total} page={t.page} pageSize={t.pageSize} onPage={t.onPage} onPageSize={t.onPageSize} rowKey={r => String(r.idmercadoriavariacao)} />
      )}
    </>
  )
}

type Abc = { total: number; referencia: string | null; classes: { classe: 'A' | 'B' | 'C'; itens: number; itens_pct: number; faturamento: number; faturamento_pct: number }[]; curva: { posicao: number; itens_pct: number; acumulado_pct: number; classe: string }[] }

/** Curva ABC (Pareto): poucos itens fazem a maior parte do faturamento, e cada classe pede um cuidado. */
function Curva() {
  const { data: d, error, reload } = useApi<Abc>('dash/abc')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!d) return <Loading rows={6} />
  if (!d.total) return <Empty>Ainda não há vendas carregadas para montar a curva ABC.</Empty>
  const a = d.classes.find(c => c.classe === 'A')
  return (
    <>
      <AvisoCarga oQue="A curva usa o último ano de vendas já carregado." />
      <div className="metrics" style={{ marginBottom: 18 }}>
        {d.classes.map(c => (
          <div key={c.classe} className="metric">
            <span className="metric-label">{CLASSES.find(x => x.id === c.classe)?.nome}</span>
            <strong className="metric-value">{int(c.itens)} itens</strong>
            <span className="metric-detail">{pct(c.itens_pct, 0)} dos itens · {pct(c.faturamento_pct, 0)} do faturamento</span>
          </div>
        ))}
        <div className="metric">
          <span className="metric-label">Itens vendidos no ano</span>
          <strong className="metric-value">{int(d.total)}</strong>
          <span className="metric-detail">até {data(d.referencia)}</span>
        </div>
      </div>
      <section className="panel" aria-labelledby="pareto-h">
        <h2 id="pareto-h">{a ? `${pct(a.itens_pct, 0)} dos itens fazem 80% do faturamento` : 'Curva ABC'}</h2>
        <p>Itens ordenados do que mais vende para o que menos vende. A classe A recebe contagem mensal e nível de serviço de 98%; a B, 95%; a C, 90%.</p>
        <div style={{ height: 260 }} role="img" aria-label={`Curva ABC: ${a ? `${int(a.itens)} itens da classe A fazem 80% do faturamento` : ''} de ${int(d.total)} itens vendidos.`}>
          <ResponsiveContainer>
            <AreaChart data={d.curva} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="itens_pct" type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
              <ReferenceLine y={80} stroke="var(--line-2)" strokeDasharray="4 4" label={{ value: 'A até 80%', position: 'insideBottomRight', fill: 'var(--muted)', fontSize: 12 }} />
              <ReferenceLine y={95} stroke="var(--line-2)" strokeDasharray="4 4" label={{ value: 'B até 95%', position: 'insideBottomRight', fill: 'var(--muted)', fontSize: 12 }} />
              <Tooltip content={({ active, payload }) => active && payload?.length ? (
                <div className="chart-tip"><strong>Classe {String(payload[0].payload.classe)}</strong>{pct(Number(payload[0].payload.itens_pct), 1)} dos itens fazem {pct(Number(payload[0].payload.acumulado_pct), 1)} do faturamento</div>
              ) : null} />
              <Area type="monotone" dataKey="acumulado_pct" stroke="var(--turquoise-ink)" strokeWidth={2} fill="var(--turquoise-soft)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  )
}

export default function Produtos() {
  const [aba, setAba] = useParam('aba', 'lista')
  return (
    <>
      <PageHead section="PRODUTOS" title="Produtos e estoque"
        tabs={<Tabs abas label="Visão" value={aba} onChange={setAba} options={[{ id: 'lista', label: 'Por situação' }, { id: 'abc', label: 'Curva ABC' }, { id: 'declinio', label: 'Em declínio' }]} />}>
        Cada variação com estoque, valor a custo, giro dos últimos 90 dias e a situação que pede ação.
      </PageHead>
      {aba === 'declinio' ? <Declinio /> : aba === 'abc' ? <Curva /> : <Lista />}
    </>
  )
}
