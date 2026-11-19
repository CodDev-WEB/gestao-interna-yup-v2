// Diagnóstico de leitura: transforma o erro técnico de um registro do ERP em "o que corrigir e onde",
// com o item, o lote ou o documento afetado já identificados.

import type { Supabase } from '../supabase/client'
import type { RowErrorInfo } from './convert'

type Row = Record<string, unknown>

export type Diagnostico = {
  titulo: string
  campo: string
  valor_recebido: string
  problema: string
  onde_corrigir: string
  passos: string[]
  impacto: string
  item?: { id: number; nome: string | null; codigobarras: string | null; secao: string | null; setor: string | null; estoque: number | null }
  lote?: { lote: string; entrada: string | null; validade: string | null; local: string | null; saldo: number | null }
  documento?: { id: number; numero: string | null; modelo: string | null; data: string | null; pessoa: string | null }
  pessoa?: { id: number; nome: string | null }
  tecnico: string
}

/** Separa a mensagem técnica do detalhe estruturado gravado pela sincronização (após "§"). */
export function lerErro(lastError: string | null | undefined): { mensagem: string; info: (RowErrorInfo & { lidos_no_ciclo?: number }) | null } {
  if (!lastError) return { mensagem: '', info: null }
  const i = lastError.indexOf('\n§')
  if (i < 0) return { mensagem: lastError, info: null }
  try { return { mensagem: lastError.slice(0, i), info: JSON.parse(lastError.slice(i + 2)) } } catch { return { mensagem: lastError.slice(0, i), info: null } }
}

// Nome amigável de cada campo e a tela do ERP onde ele é editado.
const CAMPOS: Record<string, { nome: string; tela: string }> = {
  'mercadoria_estoque_lote._dtvalidade': { nome: 'validade do lote', tela: 'Cadastro do produto → Lotes (estoque por lote). Se o lote entrou por nota, corrija também a validade no item da nota de entrada.' },
  'mercadoria_estoque_lote._dtentrada': { nome: 'data de entrada do lote', tela: 'Cadastro do produto → Lotes (estoque por lote).' },
  'mercadoria_estoque_lote.dtfabricacao': { nome: 'data de fabricação do lote', tela: 'Cadastro do produto → Lotes (estoque por lote).' },
  'mercadoria_estoque_lote.qtdsaldo': { nome: 'saldo do lote', tela: 'Cadastro do produto → Lotes (estoque por lote).' },
  'documento.datahora': { nome: 'data do documento', tela: 'Movimentações → localize o documento (nota, venda ou ajuste) pelo número.' },
  'documento.datahoramovimento': { nome: 'data de movimento do documento', tela: 'Movimentações → localize o documento pelo número.' },
  'documento_mercadoria.dtvalidade': { nome: 'validade informada no item da nota', tela: 'Movimentações → abra a nota e edite o item (lote e validade).' },
  'documento_mercadoria.qtd': { nome: 'quantidade do item no documento', tela: 'Movimentações → abra o documento e confira o item.' },
  'inventario_mercadoria.dtvalidade': { nome: 'validade na contagem de inventário', tela: 'Estoque → Inventários → abra o inventário e confira o item.' },
  'mercadoria_tabela_preco.valpreco': { nome: 'preço de venda', tela: 'Cadastro do produto → Preços / tabela de preço.' },
  'pessoa.datacadastro': { nome: 'data de cadastro da pessoa', tela: 'Cadastro de pessoas (clientes/fornecedores).' },
  'pessoa.dataclientedesde': { nome: 'data "cliente desde"', tela: 'Cadastro de pessoas (clientes/fornecedores).' },
}

const TABELAS: Record<string, string> = {
  mercadoria_estoque_lote: 'Saldo por lote e validade', documento: 'Documentos', documento_mercadoria: 'Itens dos documentos',
  inventario_mercadoria: 'Contagens de inventário', mercadoria_tabela_preco: 'Preços de venda', pessoa: 'Clientes e fornecedores',
  mercadoria: 'Cadastro de mercadorias', mercadoria_variacao: 'Variações', mercadoria_estoque: 'Saldo por local', mercadoria_custo: 'Custos',
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const dataBr = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

/** Mostra o valor recebido como a pessoa veria no ERP (datas em dd/mm/aaaa). */
function valorLegivel(v: string) {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return v.length > 60 ? v.slice(0, 60) + '…' : v
}

function explicar(info: RowErrorInfo): string {
  const v = String(info.valor ?? '')
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? v.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (/data/.test(info.motivo) && iso) {
    const [ano, mes, dia] = v.includes('/') ? [Number(iso[3]), Number(iso[2]), Number(iso[1])] : [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    if (ano < 1900 || ano > 2200) return `O ano ${String(ano).padStart(4, '0')} não existe para esta data (o sistema aceita de 1900 a 2200). Quase sempre é erro de digitação no ano.`
    if (mes < 1 || mes > 12) return `O mês ${mes} não existe.`
    return `O dia ${dia}/${mes} não existe nesse mês.`
  }
  if (/data/.test(info.motivo)) return 'O valor não está num formato de data reconhecível.'
  if (/número|inteiro|finito/.test(info.motivo)) return 'Era esperado um número, mas veio texto ou um valor fora do padrão.'
  if (/hora/.test(info.motivo)) return 'A hora informada não existe (ex.: 25:00).'
  return `Valor fora do padrão (${info.motivo}).`
}

type Ctx = { prod: Map<number, Row>; doc: Map<number, Row>; pessoa: Map<number, Row>; local: Map<string, Row> }
export type Acao = 'em_branco' | 'ignorado' | undefined

const ids = (infos: RowErrorInfo[], ...cols: string[]) =>
  [...new Set(infos.map(i => { for (const c of cols) { const v = num(i.registro?.[c]); if (v !== null && Number.isSafeInteger(v)) return v } return null }).filter((v): v is number => v !== null))]

/** Busca de uma vez (uma consulta por tabela) os nomes de itens, documentos, pessoas e locais citados. */
async function contexto(infos: RowErrorInfo[], db: Supabase): Promise<Ctx> {
  const it = ids(infos, '_idmercadoriavariacao', 'idmercadoriavariacao'), dc = ids(infos, '_iddocumento'), ps = ids(infos, '_idpessoa', 'idpessoa'), lc = ids(infos, '_idlocalestoque', 'idlocalestoque')
  const [prod, doc, pessoa, local] = await Promise.all([
    it.length ? db.select<Row>('vw_produto_desempenho', `idmercadoriavariacao=in.(${it.join(',')})&select=idmercadoriavariacao,descricao,codigobarras,secao,setor,estoque_atual`).catch(() => []) : [],
    dc.length ? db.select<Row>('erp_documento', `_iddocumento=in.(${dc.join(',')})&select=_iddocumento,numero,serie,modelo,datahora,idpessoa`).catch(() => []) : [],
    ps.length ? db.select<Row>('erp_pessoa', `_idpessoa=in.(${ps.join(',')})&select=_idpessoa,nome,sobrenome`).catch(() => []) : [],
    lc.length ? db.select<Row>('erp_local_estoque', `_idlocal=in.(${lc.join(',')})&select=_idempresa,_idlocal,descricao`).catch(() => []) : [],
  ])
  return {
    prod: new Map(prod.map(r => [Number(r.idmercadoriavariacao), r])), doc: new Map(doc.map(r => [Number(r._iddocumento), r])),
    pessoa: new Map(pessoa.map(r => [Number(r._idpessoa), r])), local: new Map(local.map(r => [`${r._idempresa}-${r._idlocal}`, r])),
  }
}

export async function diagnosticar(info: RowErrorInfo & { lidos_no_ciclo?: number }, mensagem: string, db: Supabase, acao?: Acao): Promise<Diagnostico> {
  return montar(info, mensagem, await contexto([info], db), acao)
}

/** Vários avisos com as consultas agrupadas (cabe no limite de subrequests do Worker). */
export async function diagnosticarVarios(lista: { info: RowErrorInfo; acao: Acao; chave: string }[], db: Supabase) {
  const ctx = await contexto(lista.map(l => l.info), db)
  return lista.map(l => ({ chave: l.chave, acao: l.acao, ...montar(l.info, '', ctx, l.acao) }))
}

function montar(info: RowErrorInfo & { lidos_no_ciclo?: number }, mensagem: string, ctx: Ctx, acao: Acao): Diagnostico {
  const r = info.registro ?? {}
  const idItem = num(r._idmercadoriavariacao ?? r.idmercadoriavariacao)
  const idDoc = num(r._iddocumento)
  const idPessoa = num(r._idpessoa ?? r.idpessoa)
  const idLocal = num(r._idlocalestoque ?? r.idlocalestoque), idEmpresa = num(r._idempresa ?? r.idempresa) ?? 1

  const chave = `${info.tabela}.${info.coluna}`
  const campo = CAMPOS[chave] ?? { nome: `campo "${info.coluna.replace(/^_/, '')}"`, tela: `Cadastro correspondente a "${TABELAS[info.tabela] ?? info.tabela}" no ERP.` }
  const recebido = valorLegivel(String(info.valor ?? ''))
  const p = idItem !== null ? ctx.prod.get(idItem) : undefined
  const item = idItem !== null ? { id: idItem, nome: (p?.descricao as string) ?? (r.descricao as string) ?? null, codigobarras: (p?.codigobarras as string) ?? (r.codigobarras as string) ?? null, secao: (p?.secao as string) ?? null, setor: (p?.setor as string) ?? null, estoque: num(p?.estoque_atual) } : undefined
  const loc = idLocal !== null ? ctx.local.get(`${idEmpresa}-${idLocal}`) ?? ctx.local.get(`1-${idLocal}`) : undefined
  const ehLote = info.tabela === 'mercadoria_estoque_lote'
  const lote = r._lote !== undefined || r.lote !== undefined ? {
    lote: String(r._lote ?? r.lote), entrada: r._dtentrada ? dataBr(String(r._dtentrada)) : null,
    validade: r._dtvalidade ?? r.dtvalidade ? valorLegivel(String(r._dtvalidade ?? r.dtvalidade)) : null,
    local: ehLote ? (loc?.descricao as string) ?? (idLocal !== null ? `Local ${idLocal}` : null) : null, saldo: ehLote ? num(r.qtdsaldo) : null,
  } : undefined
  const d = idDoc !== null ? ctx.doc.get(idDoc) : undefined
  const documento = idDoc !== null ? { id: idDoc, numero: (d?.numero as string) ?? (r.numero as string) ?? null, modelo: (d?.modelo as string) ?? (r.modelo as string) ?? null, data: d?.datahora ? dataBr(String(d.datahora)) : r.datahora && /^\d{4}-\d{2}-\d{2}/.test(String(r.datahora)) ? valorLegivel(String(r.datahora)) : null, pessoa: null as string | null } : undefined
  const pr = idPessoa !== null ? ctx.pessoa.get(idPessoa) : undefined
  const pes = pr ? { id: idPessoa!, nome: [pr.nome, pr.sobrenome].map(x => String(x ?? '').trim()).filter(Boolean).join(' ') || null } : idPessoa !== null ? { id: idPessoa, nome: (r.nome as string) ?? null } : undefined

  // Passo a passo, do jeito que a pessoa faz no ERP.
  const passos: string[] = []
  const nomeItem = item ? `"${item.nome ?? `código ${item.id}`}" (código interno ${item.id}${item.codigobarras ? `, código de barras ${item.codigobarras}` : ''})` : ''
  const nomeDoc = documento ? `${documento.modelo ? `modelo ${documento.modelo} ` : ''}${documento.numero ? `nº ${documento.numero} ` : ''}${documento.data ? `de ${documento.data} ` : ''}(código interno ${documento.id})` : ''
  if (documento) {
    passos.push(`No ERP, abra o documento ${nomeDoc}.`)
    if (item) passos.push(`Localize nele o item ${nomeItem}${lote ? `, lote "${lote.lote}"` : ''}.`)
  } else if (item) {
    passos.push(`No ERP, abra o produto ${nomeItem}.`)
    if (lote) passos.push(`Localize o lote "${lote.lote}"${lote.entrada ? `, com entrada em ${lote.entrada}` : ''}${lote.local ? `, no ${lote.local.toLowerCase()}` : ''}${lote.saldo !== null ? ` (saldo ${lote.saldo})` : ''}.`)
  }
  if (pes && !item && !documento) passos.push(`No ERP, abra o cadastro de "${pes.nome ?? `pessoa ${pes.id}`}" (código ${pes.id}).`)
  passos.push(/data|validade/i.test(campo.nome)
    ? `Corrija a ${campo.nome}: hoje está "${recebido}". Confira a data certa na embalagem ou na nota de entrada.`
    : `Corrija o ${campo.nome}: hoje está "${recebido}".`)
  passos.push(acao === 'em_branco' ? 'Salve no ERP e clique em "Marcar como resolvido" aqui.'
    : acao === 'ignorado' ? 'Salve. O registro entra na próxima leitura completa desta tabela; depois disso, clique em "Marcar como resolvido".'
    : 'Salve. A leitura tenta de novo sozinha na próxima rodada; para não esperar, use "Ler de novo" nesta tela.')

  const tabela = TABELAS[info.tabela] ?? info.tabela
  const impacto = acao === 'em_branco'
    ? `A leitura não parou: aqui no sistema a ${campo.nome} ficou em branco e o resto do registro foi copiado normalmente. Corrigir no ERP mantém o cadastro certo (documentos antigos não são relidos, então o valor corrigido só aparece aqui se o documento for dos últimos dias).`
    : acao === 'ignorado'
      ? `A leitura não parou, mas este registro não foi copiado: a ${campo.nome} faz parte da identificação dele. Os demais registros de "${tabela}" foram lidos normalmente.`
      : `A leitura de "${tabela}" está parada neste registro${info.lidos_no_ciclo ? ` (${info.lidos_no_ciclo.toLocaleString('pt-BR')} registros já lidos nesta volta)` : ''}. Os registros seguintes só entram depois da correção; as outras tabelas continuam normais.`
  return {
    titulo: item ? `${item.nome ?? `Produto ${item.id}`}: ${campo.nome} inválida` : `${tabela}: ${campo.nome} inválido(a)`,
    campo: campo.nome, valor_recebido: recebido, problema: explicar(info), onde_corrigir: campo.tela, passos, impacto,
    item, lote, documento, pessoa: pes, tecnico: mensagem || `${info.tabela}.${info.coluna} = ${JSON.stringify(info.valor)}: ${info.motivo}`,
  }
}
