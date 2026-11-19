// Peças da gestão do estoque usadas em várias telas: etiqueta da classe ABC, nomes dos problemas de dado
// e o aviso de carga incompleta (vendas e custos que ainda não chegaram do ERP).

import { Link } from 'react-router-dom'
import { Hourglass } from 'lucide-react'
import { useApi } from './api'
import { data as fmtData, int } from './format'

export const CLASSES = [
  { id: 'A', nome: 'Classe A', desc: 'Os itens que somam 80% do faturamento do último ano' },
  { id: 'B', nome: 'Classe B', desc: 'Os próximos 15% do faturamento' },
  { id: 'C', nome: 'Classe C', desc: 'Os 5% restantes e os itens sem venda no último ano' },
] as const

/** Etiqueta A/B/C: a letra fica sempre visível, a cor só reforça. */
export function ClasseTag({ classe }: { classe: string | null | undefined }) {
  const c = classe === 'A' || classe === 'B' ? classe : 'C'
  const tom = c === 'A' ? 'info' : 'neutral'
  return <span className={`pill ${tom} classe-tag`} title={CLASSES.find(x => x.id === c)?.desc}>{c}</span>
}

export const PROBLEMAS = [
  { id: 'estoque_negativo', nome: 'Estoque negativo', desc: 'Saldo abaixo de zero no sistema: venda com código trocado ou entrada não lançada.' },
  { id: 'lote_vencido', nome: 'Lote vencido com saldo', desc: 'Lote com validade vencida que ainda tem saldo: perda real ou lote vendido sem baixa.' },
  { id: 'sem_codigo_barras', nome: 'Sem código de barras', desc: 'Tem estoque e não tem EAN: atrasa o caixa e a contagem.' },
  { id: 'ncm_invalido', nome: 'Sem NCM válido', desc: 'Tem estoque e não tem NCM de 8 dígitos: risco de rejeição da nota com a reforma tributária.' },
  { id: 'sem_custo', nome: 'Sem custo', desc: 'Tem estoque e o custo está zerado: distorce o valor do estoque e a margem.' },
] as const
export const problema = (id: string) => PROBLEMAS.find(p => p.id === id) ?? { id, nome: id, desc: '' }

export type Carga = { vendas_ate: string | null; custos_ate: string | null; vendas_completa: boolean; custos_completa: boolean }
export type ResumoQualidade = { problemas: { problema: string; itens: number; itens_a: number | null; valor: number | string | null }[]; carga: Carga }

/** Faixa no topo das telas que dependem de vendas e custos: diz até onde a carga chegou e o que ainda não é confiável. */
export function AvisoCarga({ carga, oQue }: { carga?: Carga | null; oQue: string }) {
  const { data } = useApi<ResumoQualidade>(carga === undefined ? 'dash/qualidade-resumo' : null)
  const c = carga ?? data?.carga
  if (!c || (c.vendas_completa && c.custos_completa)) return null
  const partes = [
    !c.vendas_completa && `as vendas estão carregadas até ${c.vendas_ate ? fmtData(c.vendas_ate) : 'o início do histórico'}`,
    !c.custos_completa && `os custos dos itens vendidos até ${c.custos_ate ? fmtData(c.custos_ate) : 'o início do histórico'}`,
  ].filter(Boolean)
  return (
    <div className="notice" role="status">
      <Hourglass size={18} aria-hidden />
      <div>A carga do ERP ainda está em andamento: {partes.join(' e ')}. {oQue} <Link to="/sincronizacao">Ver progresso</Link>.</div>
    </div>
  )
}

/** Texto curto para "x itens" com plural. */
export const itens = (n: number | null | undefined) => `${int(n ?? 0)} ${n === 1 ? 'item' : 'itens'}`
