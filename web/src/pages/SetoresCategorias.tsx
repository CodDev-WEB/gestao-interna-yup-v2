import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, FolderTree, Hash, PackageX } from 'lucide-react'
import { type Page, useApi } from '../api'
import { brl, brlCurto, dec, int, pct } from '../format'
import { SETORES, SETOR_COR, situacao } from '../labels'
import { formatarNcm, nomeCapitulo, nomePosicao } from '../ncm'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, PageHead, SearchBox, useParam } from '../ui'
import { SetoresTabs } from './Setores'

type Linha = {
  setor: string; capitulo: string | null; posicao: string | null; ncm: string | null; ncm_descricao: string | null
  produtos: number; com_estoque: number; valor_estoque: number | string; faturamento_90d: number | string; lucro_90d: number | string; qtd_90d: number | string
  por_regra_ncm: number; por_secao: number
}
type Soma = { produtos: number; com_estoque: number; valor_estoque: number; faturamento_90d: number; lucro_90d: number; qtd_90d: number }
type Prod = { idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; estoque_atual: number | string; valor_estoque: number | string | null; qtd_90d: number | string; situacao: string; origem_setor: string | null }

const vazio = (): Soma => ({ produtos: 0, com_estoque: 0, valor_estoque: 0, faturamento_90d: 0, lucro_90d: 0, qtd_90d: 0 })
function somar(a: Soma, l: Linha) {
  a.produtos += Number(l.produtos); a.com_estoque += Number(l.com_estoque); a.valor_estoque += Number(l.valor_estoque)
  a.faturamento_90d += Number(l.faturamento_90d); a.lucro_90d += Number(l.lucro_90d); a.qtd_90d += Number(l.qtd_90d)
  return a
}
const ORDEM = [...SETORES, 'Não classificado']

/** Linha resumida de um nível da árvore (setor, grupo, subgrupo ou NCM). */
function Numeros({ s, total }: { s: Soma; total: number }) {
  return (
    <span className="tree-nums">
      <span title="Produtos (com estoque)"><b>{int(s.produtos)}</b> prod.{s.com_estoque !== s.produtos && <small> · {int(s.com_estoque)} c/ estoque</small>}</span>
      <span title="Valor do estoque a custo"><b>{brlCurto(s.valor_estoque)}</b> estoque</span>
      <span title="Faturamento nos últimos 90 dias"><b>{brlCurto(s.faturamento_90d)}</b> 90d{total > 0 && <small> · {pct(s.faturamento_90d / total * 100)}</small>}</span>
      <span title="Margem nos últimos 90 dias">margem <b>{s.faturamento_90d > 0 ? pct(s.lucro_90d / s.faturamento_90d * 100) : '—'}</b></span>
    </span>
  )
}

/** Produtos de um NCM (carrega só quando o nível é aberto). */
function ProdutosDoNcm({ ncm }: { ncm: string | null }) {
  const { data, error, reload } = useApi<Page<Prod>>(`dash/produtos?ncm=${ncm ?? 'sem'}&limit=50&ordem=valor_estoque&dir=desc`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <Loading rows={3} />
  if (!data.rows.length) return <Empty>Nenhum produto.</Empty>
  return (
    <>
      <ul className="tree-prods">
        {data.rows.map(p => { const s = situacao(p.situacao); return (
          <li key={p.idmercadoriavariacao}>
            <ItemLink id={p.idmercadoriavariacao}>{p.descricao ?? `Produto ${p.idmercadoriavariacao}`}</ItemLink>
            <span className="muted">{p.codigobarras ?? '—'}</span>
            <span className="tag"><i style={{ background: s.cor }} aria-hidden />{s.nome}</span>
            <span>{dec(p.estoque_atual)} un. · {brl(p.valor_estoque)}</span>
            <span>{dec(p.qtd_90d)} vend. 90d</span>
            {p.origem_setor === 'secao' && <span className="pill neutral" title="Setor veio da seção do ERP, não de uma regra de NCM">setor pela seção</span>}
          </li>
        ) })}
      </ul>
      {data.total > data.rows.length && <p className="hint" style={{ margin: '8px 0 0' }}>Mostrando 50 de {int(data.total)}. <Link to={`/produtos?ncm=${ncm ?? 'sem'}`}>Ver todos em Produtos</Link></p>}
    </>
  )
}

function No({ nivel, titulo, codigo, s, total, children, aberto }: { nivel: number; titulo: ReactNode; codigo?: string; s: Soma; total: number; children: ReactNode; aberto?: boolean }) {
  const [open, setOpen] = useState(!!aberto)
  return (
    <details className={`tree-node n${nivel}`} open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="tree-title">{codigo && <code>{codigo}</code>}{titulo}</span>
        <Numeros s={s} total={total} />
      </summary>
      {open && <div className="tree-children">{children}</div>}
    </details>
  )
}

export default function SetoresCategorias() {
  const { data, error, reload } = useApi<Linha[]>('dash/categorias')
  const [setorSel, setSetor] = useParam('setor')
  const [busca, setBusca] = useParam('busca')

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase().replace(/\./g, '')
    return (data ?? []).filter(l => (!setorSel || l.setor === setorSel) && (!q || (l.ncm ?? '').startsWith(q) || (l.ncm_descricao ?? '').toLowerCase().includes(q)
      || nomeCapitulo(l.capitulo).toLowerCase().includes(q) || nomePosicao(l.posicao, l.ncm_descricao).toLowerCase().includes(q)))
  }, [data, setorSel, busca])

  if (error) return <><SetoresTabs /><ErrorState message={error} onRetry={reload} /></>
  if (!data) return <><SetoresTabs /><Loading rows={8} /></>

  const tudo = data.reduce(somar, vazio())
  const semNcm = data.filter(l => !l.ncm).reduce(somar, vazio())
  const total = tudo.faturamento_90d
  const capitulos = new Set(data.filter(l => l.capitulo).map(l => l.capitulo)).size
  const ncms = new Set(data.filter(l => l.ncm).map(l => l.ncm)).size

  // Agrupa: setor → capítulo → posição → NCM.
  const arvore = new Map<string, Map<string, Map<string, Linha[]>>>()
  for (const l of linhas) {
    const s = arvore.get(l.setor) ?? new Map(); arvore.set(l.setor, s)
    const c = s.get(l.capitulo ?? '') ?? new Map(); s.set(l.capitulo ?? '', c)
    const p = c.get(l.posicao ?? '') ?? []; c.set(l.posicao ?? '', p); p.push(l)
  }
  const soma = (ls: Linha[]) => ls.reduce(somar, vazio())
  const porValor = <T,>(m: Map<string, T>, f: (v: T) => Linha[]) => [...m.entries()].sort((a, b) => soma(f(b[1])).valor_estoque - soma(f(a[1])).valor_estoque)
  const flat2 = (c: Map<string, Linha[]>) => [...c.values()].flat()
  const flat3 = (s: Map<string, Map<string, Linha[]>>) => [...s.values()].flatMap(flat2)

  return (
    <>
      <SetoresTabs />
      <PageHead section="SETORES / CATEGORIAS" title="Categorias por NCM">
        Os produtos organizados pelo NCM do cadastro: setor → grupo (capítulo, 2 primeiros dígitos) → subgrupo (posição, 4 dígitos) → NCM (8 dígitos). Clique para abrir cada nível.
      </PageHead>

      <div className="metrics" style={{ marginBottom: 16 }}>
        <Metric icon={<Hash size={18} />} tone="turquoise" label="Produtos com NCM" value={pct(tudo.produtos ? (tudo.produtos - semNcm.produtos) / tudo.produtos * 100 : null)} detail={`${int(tudo.produtos - semNcm.produtos)} de ${int(tudo.produtos)} produtos`} />
        <Metric icon={<FolderTree size={18} />} tone="blue" label="Grupos (capítulos)" value={int(capitulos)} detail={`${int(ncms)} NCMs diferentes`} />
        <Metric icon={<Boxes size={18} />} tone="gold" label="Estoque classificado" value={brlCurto(tudo.valor_estoque - semNcm.valor_estoque)} detail={`de ${brlCurto(tudo.valor_estoque)} a custo`} />
        <Metric icon={<PackageX size={18} />} tone={semNcm.produtos ? 'red' : 'green'} label="Sem NCM" value={int(semNcm.produtos)} detail={semNcm.produtos ? `${brlCurto(semNcm.valor_estoque)} em estoque` : 'todos os produtos têm NCM'} />
      </div>
      {data.length > 0 && tudo.produtos > 0 && semNcm.produtos === tudo.produtos && (
        <div className="notice"><Hash size={18} aria-hidden /><div><strong>Os NCMs ainda não chegaram do ERP.</strong> O cadastro de produtos é relido uma vez por dia; quando o NCM for copiado, a árvore se monta sozinha.</div></div>
      )}

      <div className="controls">
        <div className="chips" role="group" aria-label="Setor">
          <button className="chip" aria-pressed={!setorSel} onClick={() => setSetor('')}>Todos</button>
          {ORDEM.map(s => <button key={s} className="chip" aria-pressed={setorSel === s} onClick={() => setSetor(s)}><i style={{ background: SETOR_COR[s] }} aria-hidden />{s}</button>)}
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar NCM ou categoria" />
      </div>

      {arvore.size === 0 ? <Empty>Nenhuma categoria com esses filtros.</Empty> : (
        <div className="tree">
          {[...arvore.entries()].sort((a, b) => ORDEM.indexOf(a[0]) - ORDEM.indexOf(b[0])).map(([setor, caps]) => (
            <No key={setor} nivel={0} aberto={arvore.size === 1 || !!busca} s={soma(flat3(caps))} total={total}
              titulo={<span className="tag tree-setor"><i style={{ background: SETOR_COR[setor] }} aria-hidden />{setor}</span>}>
              {porValor(caps, flat2).map(([cap, poss]) => (
                <No key={cap} nivel={1} codigo={cap || undefined} titulo={nomeCapitulo(cap || null)} s={soma(flat2(poss))} total={total} aberto={!!busca}>
                  {porValor(poss, x => x).map(([pos, ls]) => (
                    <No key={pos} nivel={2} codigo={pos || undefined} titulo={nomePosicao(pos || null, ls[0]?.ncm_descricao)} s={soma(ls)} total={total} aberto={!!busca && ls.length === 1}>
                      {[...ls].sort((a, b) => Number(b.valor_estoque) - Number(a.valor_estoque)).map(l => (
                        <No key={l.ncm ?? 'sem'} nivel={3} codigo={l.ncm ? formatarNcm(l.ncm) : undefined} titulo={l.ncm_descricao ?? (l.ncm ? 'Descrição do NCM ainda não carregada' : 'Produtos sem NCM no cadastro')} s={soma([l])} total={total}>
                          <ProdutosDoNcm ncm={l.ncm} />
                        </No>
                      ))}
                    </No>
                  ))}
                </No>
              ))}
            </No>
          ))}
        </div>
      )}
    </>
  )
}
