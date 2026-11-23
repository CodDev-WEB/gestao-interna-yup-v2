// Log de modificações dos itens: cada mudança de saldo (venda, entrada, saída, ajuste, devolução) e de preço,
// com quem lançou, data e hora, documento, saldo antes e depois e valor. Usado na ficha do item (aba Log) e na
// página Log de movimentações (todos os itens, com filtros).

import { useEffect, useState } from 'react'
import { api } from './api'
import { brl, dec } from './format'
import { ItemLink } from './ProdutoPainel'
import { Empty, ErrorState, Loading } from './ui'

export type Mov = {
  id: string; origem: 'estoque' | 'preco'; datahora: string; idmercadoriavariacao: number; produto: string | null; tipo: string; operacao: string; cancelado: boolean | null
  antes: number | null; depois: number | null; quantidade: number | null; iddocumento: number | null; documento: string | null
  idusuario: number | null; usuario: string | null; idpessoa: number | null; pessoa: string | null; valor: number | null; vendedora: string | null
}
export type RespLog = { linhas: Mov[]; total: number }

export const TIPOS_LOG: { id: string; nome: string; cls: string }[] = [
  { id: 'venda', nome: 'Venda', cls: 'info' },
  { id: 'entrada', nome: 'Entrada (compra)', cls: 'good' },
  { id: 'devolucao', nome: 'Devolução', cls: 'warn' },
  { id: 'ajuste', nome: 'Ajuste de estoque', cls: 'bad' },
  { id: 'outra_entrada', nome: 'Outra entrada', cls: 'good' },
  { id: 'outra_saida', nome: 'Outra saída', cls: 'bad' },
  { id: 'implantacao', nome: 'Implantação', cls: 'neutral' },
  { id: 'preco', nome: 'Preço', cls: 'neutral' },
  { id: 'outro', nome: 'Outro', cls: 'neutral' },
]
const tipoDe = (t: string) => TIPOS_LOG.find(x => x.id === t) ?? { id: t, nome: t, cls: 'neutral' }

export const quando = (v: string) => {
  const d = new Date(v)
  return { data: d.toLocaleDateString('pt-BR', { timeZone: 'America/Belem' }), hora: d.toLocaleTimeString('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
}
const sinal = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${dec(n)}`

/** Uma linha do log, para a tabela (célula a célula). */
export function celulas(m: Mov, comProduto: boolean) {
  const t = tipoDe(m.tipo), q = quando(m.datahora), preco = m.origem === 'preco'
  return {
    quando: <><span className="title">{q.data}</span><small>{q.hora}</small></>,
    operacao: <>
      <span className={`pill ${t.cls}`}>{t.nome}</span>{m.cancelado && <span className="pill neutral" style={{ marginLeft: 4 }}>cancelado</span>}
      <small>{m.operacao}{m.documento ? ` · ${m.documento}` : ''}</small>
      {m.pessoa && <small>{m.pessoa}</small>}
    </>,
    produto: comProduto ? <ItemLink id={m.idmercadoriavariacao}>{m.produto ?? `Item ${m.idmercadoriavariacao}`}</ItemLink> : null,
    movimento: preco
      ? <><b>{brl(m.depois)}</b><small>preço antes {brl(m.antes)}</small></>
      : <><b className={m.quantidade !== null && m.quantidade < 0 ? 'down' : 'up'}>{sinal(m.quantidade)} un.</b><small>saldo {dec(m.antes)} → {dec(m.depois)}</small></>,
    valor: m.valor !== null ? brl(m.valor) : <span className="muted">—</span>,
    quem: m.usuario ? <>{m.usuario}{m.vendedora && m.vendedora !== m.usuario && <small>vendedora: {m.vendedora}</small>}</> : <span className="muted">{preco ? 'não informado pelo ERP' : '—'}</span>,
  }
}

/** Log de um item, mais recente primeiro, carregando de 30 em 30. */
export function LogItem({ variacao }: { variacao: number }) {
  const [linhas, setLinhas] = useState<Mov[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const carregar = async (offset: number) => {
    setCarregando(true); setErro(null)
    try {
      const r = await api<RespLog>(`dash/log?variacao=${variacao}&limit=30&offset=${offset}`)
      setLinhas(l => offset ? [...l, ...r.linhas] : r.linhas); setTotal(r.total)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setCarregando(false) }
  }
  useEffect(() => { setLinhas([]); setTotal(null); carregar(0) }, [variacao]) // eslint-disable-line react-hooks/exhaustive-deps
  if (erro) return <ErrorState message={erro} onRetry={() => carregar(linhas.length)} />
  if (total === null) return <Loading rows={6} />
  if (!linhas.length) return <Empty>Nenhuma movimentação registrada para este item.</Empty>
  return (
    <>
      <p className="hint">Cada mudança de saldo e de preço do item, da mais recente para a mais antiga: quem lançou no ERP, quando, o documento e o saldo antes e depois.</p>
      <div className="table-wrap cards-sm"><table>
        <caption className="sr-only">Log de modificações do item</caption>
        <thead><tr><th>Quando</th><th>Operação</th><th className="r">Movimento</th><th className="r">Valor</th><th>Quem lançou</th></tr></thead>
        <tbody>{linhas.map(m => { const c = celulas(m, false); return (
          <tr key={m.id}>
            <td data-label="Quando">{c.quando}</td>
            <td data-label="Operação" className="col-op">{c.operacao}</td>
            <td className="r" data-label="Movimento">{c.movimento}</td>
            <td className="r money" data-label="Valor">{c.valor}</td>
            <td data-label="Quem lançou">{c.quem}</td>
          </tr>) })}</tbody>
      </table></div>
      <div className="pager"><span>{linhas.length} de {total.toLocaleString('pt-BR')} registros</span>
        {linhas.length < total && <button type="button" className="btn secondary" disabled={carregando} onClick={() => carregar(linhas.length)}>{carregando ? 'Carregando…' : 'Mostrar mais'}</button>}
      </div>
    </>
  )
}
