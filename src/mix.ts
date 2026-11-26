// Mix e demanda: vendas de cada produto mês a mês no ano (e o fornecedor principal), e, para uma linha de
// produto (mesmo produto em embalagens diferentes), as compras de cada cliente mês a mês — base para ver quem
// trocou a embalagem grande pela pequena. Usa a função relatorio() do banco (agrupada e exata ao centavo).

import type { Supabase } from './supabase/client'

type Rel = { linhas: Record<string, unknown>[] }
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const rel = (db: Supabase, p: Record<string, unknown>) => db.rpc<Rel>('relatorio', { p: { limite: 5000, ...p } })
const fimDoMes = (ano: number, m: number) => new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10)

export async function mixAno(db: Supabase, ano: number, setor: string | null, hoje: string) {
  const ultimoMes = Number(hoje.slice(0, 4)) === ano ? Number(hoje.slice(5, 7)) : Number(hoje.slice(0, 4)) > ano ? 12 : 0
  const filtros = setor ? { setor } : {}
  const metricas = ['qtd', 'liquido', 'clientes', 'documentos']
  const meses = Array.from({ length: ultimoMes }, (_, i) => i + 1)
  const [porMes, dezAnterior, compras] = await Promise.all([
    Promise.all(meses.map(m => rel(db, { fonte: 'vendas', de: `${ano}-${String(m).padStart(2, '0')}-01`, ate: fimDoMes(ano, m), grupos: ['item'], metricas, filtros }))),
    rel(db, { fonte: 'vendas', de: `${ano - 1}-12-01`, ate: `${ano - 1}-12-31`, grupos: ['item'], metricas: ['qtd', 'liquido'], filtros }),
    rel(db, { fonte: 'compras', de: `${ano - 1}-01-01`, ate: `${ano}-12-31`, grupos: ['item', 'fornecedor'], metricas: ['qtd'], ordem: 'qtd' }),
  ])
  // Fornecedor principal de cada item: o que mais entregou unidades nos dois anos.
  const forn = new Map<number, { id: number; nome: string; qtd: number }>()
  for (const r of compras.linhas) {
    const id = n(r.variacao), q = n(r.qtd)
    if (!forn.has(id) || forn.get(id)!.qtd < q) forn.set(id, { id: n(r.codigo_fornecedor), nome: String(r.fornecedor ?? 'Sem fornecedor'), qtd: q })
  }
  const itens = new Map<number, { id: number; nome: string; qtd: number[]; valor: number[]; clientes: number[]; vendas: number[]; dez_qtd: number; dez_valor: number }>()
  const item = (r: Record<string, unknown>) => {
    const id = n(r.variacao)
    if (!itens.has(id)) itens.set(id, { id, nome: String(r.produto ?? `Item ${id}`), qtd: Array(12).fill(0), valor: Array(12).fill(0), clientes: Array(12).fill(0), vendas: Array(12).fill(0), dez_qtd: 0, dez_valor: 0 })
    return itens.get(id)!
  }
  porMes.forEach((r, i) => { for (const l of r.linhas) { const it = item(l); it.qtd[i] = n(l.qtd); it.valor[i] = n(l.liquido); it.clientes[i] = n(l.clientes); it.vendas[i] = n(l.documentos) } })
  for (const l of dezAnterior.linhas) { const id = n(l.variacao); if (itens.has(id)) { itens.get(id)!.dez_qtd = n(l.qtd); itens.get(id)!.dez_valor = n(l.liquido) } }
  // Formato compacto (o ano inteiro de milhares de itens): fornecedores numa lista e cada item como tupla.
  const fornecedores: string[] = [], idxForn = new Map<string, number>()
  const fi = (nome: string, id: number) => { const k = `${id}|${nome}`; if (!idxForn.has(k)) { idxForn.set(k, fornecedores.length); fornecedores.push(`${id}|${nome}`) } return idxForn.get(k)! }
  const corta = (a: number[], casas = 3) => a.slice(0, ultimoMes).map(x => Math.round(x * 10 ** casas) / 10 ** casas)
  return {
    ano, setor, meses_com_dados: ultimoMes, mes_em_andamento: Number(hoje.slice(0, 4)) === ano ? ultimoMes : null, fornecedores,
    // [id, nome, índice do fornecedor, qtd por mês, valor por mês, clientes por mês, qtd dez. anterior, valor dez. anterior]
    itens: [...itens.values()].map(it => [it.id, it.nome, fi(forn.get(it.id)?.nome ?? 'Sem compra registrada', forn.get(it.id)?.id ?? 0), corta(it.qtd), corta(it.valor, 2), corta(it.clientes, 0), it.dez_qtd, Math.round(it.dez_valor * 100) / 100]),
  }
}

/** Compras de cada cliente, mês a mês, de cada item de uma linha de produto (até 8 embalagens), em 18 meses. */
export async function mixFamilia(db: Supabase, ids: number[], hoje: string, relItem: (db: Supabase, p: Record<string, unknown>) => Promise<Rel>) {
  const [y, m] = hoje.split('-').map(Number)
  const de = new Date(Date.UTC(y, m - 18, 1)).toISOString().slice(0, 10)
  const lista = ids.slice(0, 8)
  const rs = await Promise.all(lista.map(id => relItem(db, { fonte: 'vendas', de, ate: hoje, grupos: ['cliente', 'mes'], metricas: ['qtd', 'liquido'], item: id })))
  return { de, ate: hoje, itens: lista.map((id, i) => ({ id, linhas: rs[i].linhas.map(l => ({ cliente: n(l.codigo_cliente), nome: String(l.cliente ?? ''), mes: String(l.mes), qtd: n(l.qtd), valor: n(l.liquido) })) })) }
}
