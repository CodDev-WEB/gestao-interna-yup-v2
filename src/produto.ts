// Ficha completa de um item (variação): cadastro, preço, estoque por local, lotes, entradas, vendas,
// histórico de preço e de saldo, inventários e uma linha do tempo que junta tudo.
// Toda consulta é filtrada por um id numérico validado; nada do navegador vira SQL.

import type { Supabase } from './supabase/client'

type Row = Record<string, unknown>
type Num = number | string | null | undefined
const num = (v: Num) => (v === null || v === undefined || v === '' ? null : Number(v))

function hojeBelem() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function diasEntre(de: string, ate: string) {
  return Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de.slice(0, 10) + 'T00:00:00Z')) / 86_400_000)
}
const nomePessoa = (p?: Row) => p ? [p.nome, p.sobrenome].map(x => String(x ?? '').trim()).filter(Boolean).join(' ') || null : null
const inList = (ids: unknown[]) => [...new Set(ids.filter(x => x !== null && x !== undefined && x !== 0).map(Number).filter(Number.isSafeInteger))]

/** Tipo de um documento do ERP, pelos mesmos critérios das views (vw_venda_item, vw_compra_item...). */
function tipoDocumento(d: Row | undefined, natureza?: Row): { tipo: string; nome: string } {
  if (!d) return { tipo: 'ajuste', nome: 'Movimentação manual' }
  const tm = d.tipomovimento, tf = d.tipomovimentofinanceiro, modelo = String(d.modelo ?? '')
  if (d.status && d.status !== 'E') return { tipo: 'cancelado', nome: 'Documento cancelado' }
  if (tm === 'S' && tf === 'R') return { tipo: 'venda', nome: 'Venda' }
  if (modelo === 'TM' && tm === 'E' && tf === 'P') return { tipo: 'devolucao', nome: 'Devolução de cliente' }
  if (tm === 'E' && tf === 'P') return { tipo: 'compra', nome: 'Entrada de compra' }
  const desc = String(natureza?.descricao ?? '').trim()
  if (desc) return { tipo: 'ajuste', nome: desc.charAt(0) + desc.slice(1).toLowerCase() }
  if (tm === 'E') return { tipo: 'ajuste', nome: 'Entrada de estoque' }
  if (tm === 'S') return { tipo: 'ajuste', nome: 'Saída de estoque' }
  return { tipo: 'ajuste', nome: `Movimentação (${modelo || 'sem modelo'})` }
}

export async function produtoDetalhe(id: number, db: Supabase) {
  const hoje = hojeBelem()
  const desde12m = `${Number(hoje.slice(0, 4)) - 1}-${hoje.slice(5, 7)}-01`

  const [resumo, variacao, precos, estoque, custoAtual, lotes, compras, vendas, devolucoes, histPreco, histSaldo, inventarios, fornecedoresCad] = await Promise.all([
    db.select<Row>('vw_produto_desempenho', `idmercadoriavariacao=eq.${id}&select=*`),
    db.select<Row>('erp_mercadoria_variacao', `_idmercadoriavariacao=eq.${id}&select=idmercadoria,referencia,codigobarras,embalagem,marca,idmarca,dtalteracao`),
    db.select<Row>('erp_mercadoria_tabela_preco', `_idmercadoriavariacao=eq.${id}&sync_deleted_at=is.null&select=_idempresa,_idtabela,valpreco,valcusto,flaginativo,dtalteracao&order=_idempresa.asc,_idtabela.asc`),
    db.select<Row>('erp_mercadoria_estoque', `_idmercadoriavariacao=eq.${id}&sync_deleted_at=is.null&select=_idempresa,_idlocalestoque,qtdsaldo,qtdsaldoreserva,datahora`),
    db.select<Row>('erp_mercadoria_custo', `_idmercadoriavariacao=eq.${id}&sync_deleted_at=is.null&select=_idempresa,valcusto,valcustomedio,datahora`),
    db.select<Row>('erp_mercadoria_estoque_lote', `_idmercadoriavariacao=eq.${id}&sync_deleted_at=is.null&select=_idempresa,_idlocalestoque,_lote,_dtvalidade,_dtentrada,dtfabricacao,qtdsaldo,datahora&order=_dtvalidade.asc&limit=200`),
    db.select<Row>('vw_compra_item', `idmercadoriavariacao=eq.${id}&select=iddocumento,datahora,data,idfornecedor,idnaturezaoperacao,qtd,qtdestoque,valunitarioliquido,valtotalliquido,custo_unitario,lote,dtvalidade&order=datahora.desc&limit=200`),
    db.selectAll<Row>('vw_venda_item', `idmercadoriavariacao=eq.${id}&data=gte.${desde12m}&select=data,iddocumento,qtd,valtotalliquido,lucro_bruto,custo_unitario`),
    db.select<Row>('vw_devolucao_item', `idmercadoriavariacao=eq.${id}&select=data,iddocumento,qtd,valtotalliquido&order=data.desc&limit=100`),
    db.select<Row>('erp_mercadoria_tabela_preco_historico', `_idmercadoriavariacao=eq.${id}&select=_idhistorico,_idtabela,datahora,valprecotual,valpreconovo&order=datahora.desc&limit=200`),
    db.select<Row>('erp_mercadoria_estoque_historico', `idmercadoriavariacao=eq.${id}&select=_idhistorico,_iddocumento,_idlocalestoque,datahora,qtdsaldoatual,qtdnovosaldo&order=datahora.desc&limit=300`),
    db.select<Row>('erp_inventario_mercadoria', `idmercadoriavariacao=eq.${id}&select=_idinventario,datahora,qtdcontada,qtdanterior,valcusto,lote,dtvalidade&order=datahora.desc&limit=100`),
    db.select<Row>('erp_mercadoria_fornecedor', `_idmercadoriavariacao=eq.${id}&select=_idpessoa,_embalagem,qtdfator,codigoexterno`),
  ])

  const base = resumo[0]
  const v = variacao[0]
  if (!base && !v) return null

  // Nomes e documentos referenciados (uma consulta por tabela).
  const idsPessoa = inList([...compras.map(c => c.idfornecedor), ...fornecedoresCad.map(f => f._idpessoa)])
  const idsDoc = inList(histSaldo.map(h => h._iddocumento))
  const [pessoas, docs, mercadoria, marca, locais, naturezas] = await Promise.all([
    idsPessoa.length ? db.select<Row>('erp_pessoa', `_idpessoa=in.(${idsPessoa.join(',')})&select=_idpessoa,nome,sobrenome`) : [],
    idsDoc.length ? db.select<Row>('erp_documento', `_iddocumento=in.(${idsDoc.join(',')})&select=_iddocumento,numero,serie,modelo,tipomovimento,tipomovimentofinanceiro,status,idnaturezaoperacao,idpessoa`) : [],
    v?.idmercadoria ? db.select<Row>('erp_mercadoria', `_idmercadoria=eq.${Number(v.idmercadoria)}&select=referencia,dtalteracao,idsubgrupo`) : [],
    v?.idmarca ? db.select<Row>('erp_mercadoria_marca', `_idmarca=eq.${Number(v.idmarca)}&select=descricao`) : [],
    db.select<Row>('erp_local_estoque', 'select=_idempresa,_idlocal,descricao'),
    db.select<Row>('erp_natureza_operacao', 'select=_idempresa,_idnatureza,descricao'),
  ])
  const pessoa = new Map(pessoas.map(p => [Number(p._idpessoa), p]))
  const doc = new Map(docs.map(d => [Number(d._iddocumento), d]))
  const local = (emp: unknown, id: unknown) => locais.find(l => l._idempresa === emp && l._idlocal === id)?.descricao as string | undefined
  const natureza = (id: unknown) => naturezas.find(n => n._idnatureza === id)

  // Preço de venda principal: primeira tabela ativa.
  const precoAtivo = precos.find(p => p.flaginativo !== 'T') ?? precos[0]
  const precoVenda = num(precoAtivo?.valpreco as Num)
  const custo = num(base?.custo_unitario as Num) ?? num(custoAtual[0]?.valcustomedio as Num) ?? num(custoAtual[0]?.valcusto as Num)
  const markup = precoVenda && custo ? (precoVenda / custo - 1) * 100 : null
  const margem = precoVenda && custo ? (1 - custo / precoVenda) * 100 : null

  // Vendas por mês (últimos 12 meses).
  const meses = new Map<string, { mes: string; qtd: number; faturamento: number; lucro: number; vendas: Set<unknown> }>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7)
    meses.set(d, { mes: d, qtd: 0, faturamento: 0, lucro: 0, vendas: new Set() })
  }
  for (const r of vendas) {
    const m = meses.get(String(r.data).slice(0, 7)); if (!m) continue
    m.qtd += num(r.qtd as Num) ?? 0; m.faturamento += num(r.valtotalliquido as Num) ?? 0; m.lucro += num(r.lucro_bruto as Num) ?? 0; m.vendas.add(r.iddocumento)
  }
  const vendasMes = [...meses.values()].map(m => ({ mes: m.mes, qtd: m.qtd, faturamento: m.faturamento, lucro: m.lucro, vendas: m.vendas.size }))

  const entradas = compras.map(c => {
    const qtd = num(c.qtd as Num) ?? 0
    const qtdEstoque = num(c.qtdestoque as Num)
    const total = num(c.valtotalliquido as Num)
    // Unidades que entraram no estoque (a nota pode vir em caixa/fardo; qtdestoque já está convertido).
    const unidades = qtdEstoque && qtdEstoque > 0 ? qtdEstoque : qtd
    return {
      iddocumento: c.iddocumento, datahora: c.datahora, data: c.data, idfornecedor: num(c.idfornecedor as Num),
      fornecedor: nomePessoa(pessoa.get(Number(c.idfornecedor))) ?? (c.idfornecedor ? `Fornecedor ${c.idfornecedor}` : null),
      // Preço pago ao fornecedor: por unidade da nota e por unidade de estoque.
      preco_nota: num(c.valunitarioliquido as Num) ?? (total !== null && qtd ? total / qtd : null),
      unidades, preco_unidade: total !== null && unidades ? total / unidades : null,
      natureza: (natureza(c.idnaturezaoperacao)?.descricao as string | undefined) ?? null,
      qtd, total, custo_unitario: num(c.custo_unitario as Num) ?? (total !== null && qtd ? total / qtd : null),
      lote: c.lote || null, dtvalidade: c.dtvalidade ?? null,
    }
  })

  // Preço de compra por fornecedor (entradas já vêm da mais recente para a mais antiga).
  const porForn = new Map<string, typeof entradas>()
  for (const e of entradas) { const k = String(e.idfornecedor ?? e.fornecedor ?? '?'); porForn.set(k, [...(porForn.get(k) ?? []), e]) }
  const precoCompra = [...porForn.values()].map(es => {
    const comPreco = es.filter(e => e.preco_unidade !== null)
    const ult = comPreco[0], pen = comPreco[1]
    const un = es.reduce((a, e) => a + e.unidades, 0), tot = es.reduce((a, e) => a + (e.total ?? 0), 0)
    const ps = comPreco.map(e => e.preco_unidade as number)
    return {
      idfornecedor: es[0].idfornecedor, fornecedor: es[0].fornecedor ?? 'Fornecedor não identificado', compras: es.length, unidades: un, total: tot,
      ultimo_preco: ult?.preco_unidade ?? null, ultima_compra: ult?.data ?? es[0].data, penultimo_preco: pen?.preco_unidade ?? null,
      variacao_pct: ult && pen && pen.preco_unidade ? ((ult.preco_unidade as number) / pen.preco_unidade - 1) * 100 : null,
      menor_preco: ps.length ? Math.min(...ps) : null, maior_preco: ps.length ? Math.max(...ps) : null, preco_medio: un ? tot / un : null,
      mais_barato: false,
    }
  }).sort((a, b) => String(b.ultima_compra).localeCompare(String(a.ultima_compra)))
  const menorUltimo = Math.min(...precoCompra.map(p => p.ultimo_preco ?? Infinity))
  if (precoCompra.length > 1 && isFinite(menorUltimo)) for (const p of precoCompra) p.mais_barato = p.ultimo_preco === menorUltimo
  const ultimaEntrada = entradas.find(e => e.preco_unidade !== null)

  // O ERP não baixa o saldo do lote na venda: o disponível de cada lote é o estoque do local repartido entre
  // os lotes, do que vence por último para o que vence primeiro (sai primeiro o que vence primeiro).
  const disponivelLote = new Map<Row, number>()
  for (const chave of new Set(lotes.map(l => `${l._idempresa}|${l._idlocalestoque}`))) {
    const [emp, loc] = chave.split('|')
    let resta = Math.max(0, estoque.filter(e => String(e._idempresa) === emp && String(e._idlocalestoque) === loc).reduce((a, e) => a + (num(e.qtdsaldo as Num) ?? 0), 0))
    const doLocal = lotes.filter(l => `${l._idempresa}|${l._idlocalestoque}` === chave && (num(l.qtdsaldo as Num) ?? 0) > 0)
      .sort((a, b) => String(b._dtvalidade).localeCompare(String(a._dtvalidade)) || String(b._dtentrada).localeCompare(String(a._dtentrada)))
    for (const l of doLocal) { const q = Math.min(num(l.qtdsaldo as Num) ?? 0, resta); disponivelLote.set(l, q); resta -= q }
  }
  const lotesOut = lotes.map(l => {
    const validade = String(l._dtvalidade)
    const dias = diasEntre(hoje, validade)
    const registrado = num(l.qtdsaldo as Num) ?? 0, disp = disponivelLote.get(l) ?? 0
    return {
      lote: l._lote, dtentrada: l._dtentrada, dtfabricacao: l.dtfabricacao ?? null, dtvalidade: validade, dias_para_vencer: dias,
      qtdsaldo: disp, qtd_lote: registrado, qtd_ja_saiu: Math.max(0, registrado - disp), local: local(l._idempresa, l._idlocalestoque) ?? `Local ${l._idlocalestoque}`,
      valor: custo !== null ? disp * custo : null,
      // Entrada que trouxe este lote, quando a nota informa lote/validade.
      entrada: entradas.find(e => e.lote === l._lote && (!e.dtvalidade || e.dtvalidade === validade)) ?? null,
    }
  })

  const precosHist = histPreco.map(h => {
    const de = num(h.valprecotual as Num), para = num(h.valpreconovo as Num)
    return { datahora: h.datahora, tabela: h._idtabela, de, para, variacao_pct: de && para !== null ? (para / de - 1) * 100 : null }
  })

  const saldoHist = histSaldo.map(h => {
    const d = doc.get(Number(h._iddocumento))
    const t = tipoDocumento(d, d ? natureza(d.idnaturezaoperacao) : undefined)
    const de = num(h.qtdsaldoatual as Num) ?? 0, para = num(h.qtdnovosaldo as Num) ?? 0
    return { datahora: h.datahora, iddocumento: h._iddocumento, documento: d ? `${d.modelo ?? ''} ${d.numero ?? ''}`.trim() : null, tipo: t.tipo, nome: t.nome, de, para, diferenca: para - de, local: local(d?.idempresa ?? 1, h._idlocalestoque) ?? null }
  })

  // Linha do tempo: tudo que mudou no item, do mais recente para o mais antigo.
  type Evento = { quando: string; tipo: string; titulo: string; detalhe?: string; valor?: number | null }
  const ev: Evento[] = []
  for (const e of entradas) ev.push({ quando: String(e.datahora ?? e.data), tipo: 'entrada', titulo: `Entrada de ${fmtQtd(e.unidades)} ${un(e.unidades)}`, detalhe: [e.fornecedor, e.preco_unidade !== null ? `pago ${brl(e.preco_unidade)}/un` : null, e.lote ? `lote ${e.lote}` : null, e.dtvalidade ? `validade ${dataBr(String(e.dtvalidade))}` : null].filter(Boolean).join(' · '), valor: e.total })
  for (const p of precosHist) ev.push({ quando: String(p.datahora), tipo: 'preco', titulo: `Preço de venda ${p.de !== null && p.para !== null && p.para < p.de ? 'reduzido' : 'alterado'}`, detalhe: `${brl(p.de)} → ${brl(p.para)}${p.variacao_pct !== null ? ` (${p.variacao_pct > 0 ? '+' : ''}${p.variacao_pct.toFixed(1).replace('.', ',')}%)` : ''}${p.tabela !== 1 ? ` · tabela ${p.tabela}` : ''}` })
  for (const s of saldoHist) if (s.tipo !== 'venda' && s.tipo !== 'compra') ev.push({ quando: String(s.datahora), tipo: s.tipo === 'devolucao' ? 'devolucao' : 'ajuste', titulo: s.nome, detalhe: `saldo ${fmtQtd(s.de)} → ${fmtQtd(s.para)} (${s.diferenca > 0 ? '+' : ''}${fmtQtd(s.diferenca)})${s.documento ? ` · ${s.documento}` : ''}` })
  for (const i of inventarios) ev.push({ quando: String(i.datahora), tipo: 'inventario', titulo: 'Contagem de inventário', detalhe: `contado ${fmtQtd(num(i.qtdcontada as Num))}, sistema tinha ${fmtQtd(num(i.qtdanterior as Num))}${i.lote ? ` · lote ${i.lote}` : ''}` })
  for (const d of devolucoes) if (!saldoHist.some(s => s.iddocumento === d.iddocumento)) ev.push({ quando: String(d.data), tipo: 'devolucao', titulo: `Devolução de ${fmtQtd(num(d.qtd as Num))} ${un(num(d.qtd as Num))}`, valor: num(d.valtotalliquido as Num) })
  for (const l of lotesOut) if (l.qtdsaldo > 0) ev.push({ quando: l.dtvalidade, tipo: l.dias_para_vencer < 0 ? 'vencido' : 'validade', titulo: l.dias_para_vencer < 0 ? `Lote ${l.lote} venceu` : `Lote ${l.lote} vence`, detalhe: `${fmtQtd(l.qtdsaldo)} ${un(l.qtdsaldo)} em saldo${l.valor !== null ? ` · ${brl(l.valor)} a custo` : ''}` })
  if (base?.primeira_venda) ev.push({ quando: String(base.primeira_venda), tipo: 'marco', titulo: 'Primeira venda registrada' })
  if (base?.ultima_venda) ev.push({ quando: String(base.ultima_venda), tipo: 'venda', titulo: 'Última venda', detalhe: base.dias_sem_venda !== null ? `há ${base.dias_sem_venda} dias` : undefined })
  if (precoAtivo?.dtalteracao) ev.push({ quando: String(precoAtivo.dtalteracao), tipo: 'preco', titulo: 'Último reajuste do preço de venda', detalhe: `preço atual ${brl(precoVenda)}` })
  if (v?.dtalteracao) ev.push({ quando: String(v.dtalteracao), tipo: 'cadastro', titulo: 'Cadastro do item alterado no ERP' })
  ev.sort((a, b) => b.quando.localeCompare(a.quando))
  // Eventos futuros (validade) ficam no topo como "próximos".
  const linha = ev.slice(0, 250).map(e => ({ ...e, futuro: e.quando.slice(0, 10) > hoje }))

  const totalComprado = entradas.reduce((a, e) => a + (e.total ?? 0), 0)
  const qtdComprada = entradas.reduce((a, e) => a + e.unidades, 0)

  return {
    hoje,
    item: {
      id, idmercadoria: v?.idmercadoria ?? base?.idmercadoria ?? null,
      descricao: base?.descricao ?? `Variação ${id}`,
      codigobarras: v?.codigobarras ?? base?.codigobarras ?? null,
      referencia: v?.referencia || mercadoria[0]?.referencia || null,
      embalagem: v?.embalagem ?? null,
      marca: (marca[0]?.descricao as string | undefined) ?? v?.marca ?? null,
      secao: base?.secao ?? null, grupo: base?.grupo ?? null, setor: base?.setor ?? null,
      situacao: base?.situacao ?? null,
      cadastro_alterado: v?.dtalteracao ?? null,
    },
    numeros: {
      estoque: num(base?.estoque_atual as Num) ?? 0, custo, valor_estoque: num(base?.valor_estoque as Num),
      preco_venda: precoVenda, preco_alterado: precoAtivo?.dtalteracao ?? null, markup_pct: markup, margem_pct: margem,
      qtd_30d: num(base?.qtd_30d as Num) ?? 0, qtd_90d: num(base?.qtd_90d as Num) ?? 0, faturamento_90d: num(base?.faturamento_90d as Num) ?? 0,
      margem_90d_pct: num(base?.margem_90d_pct as Num), cobertura_dias: num(base?.cobertura_dias as Num), dias_sem_venda: num(base?.dias_sem_venda as Num),
      primeira_entrada: base?.primeira_entrada ?? null, ultima_entrada: base?.ultima_entrada ?? null,
      primeira_venda: base?.primeira_venda ?? null, ultima_venda: base?.ultima_venda ?? null,
      qtd_comprada: qtdComprada, total_comprado: totalComprado, entradas: entradas.length,
      custo_medio_compras: qtdComprada ? totalComprado / qtdComprada : null,
      ultimo_preco_compra: ultimaEntrada?.preco_unidade ?? null, ultimo_fornecedor: ultimaEntrada?.fornecedor ?? null, ultima_compra_data: ultimaEntrada?.data ?? null,
    },
    preco_compra: precoCompra,
    precos: precos.map(p => ({ empresa: p._idempresa, tabela: p._idtabela, preco: num(p.valpreco as Num), custo: num(p.valcusto as Num), ativo: p.flaginativo !== 'T', alterado: p.dtalteracao })),
    estoque_locais: estoque.map(e => ({ local: local(e._idempresa, e._idlocalestoque) ?? `Local ${e._idlocalestoque}`, empresa: e._idempresa, qtd: num(e.qtdsaldo as Num) ?? 0, reservado: num(e.qtdsaldoreserva as Num) ?? 0, atualizado: e.datahora })),
    fornecedores: fornecedoresCad.map(f => ({ id: f._idpessoa, nome: nomePessoa(pessoa.get(Number(f._idpessoa))) ?? `Fornecedor ${f._idpessoa}`, embalagem: f._embalagem || null, fator: num(f.qtdfator as Num), codigo: f.codigoexterno || null })),
    lotes: lotesOut, entradas, vendas_mes: vendasMes,
    historico_preco: precosHist, historico_saldo: saldoHist,
    inventarios: inventarios.map(i => ({ datahora: i.datahora, contado: num(i.qtdcontada as Num), anterior: num(i.qtdanterior as Num), lote: i.lote || null })),
    linha_do_tempo: linha,
    carga: { historico_preco: histPreco.length > 0, historico_saldo: histSaldo.length > 0, vendas: vendas.length > 0 || base?.ultima_venda != null },
  }
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const qtdFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const brl = (v: number | null) => (v === null ? '—' : brlFmt.format(v))
const fmtQtd = (v: number | null) => (v === null ? '—' : qtdFmt.format(v))
const un = (v: number | null) => (v === 1 ? 'unidade' : 'unidades')
const dataBr = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
