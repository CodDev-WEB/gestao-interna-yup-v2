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

export async function diagnosticar(info: RowErrorInfo & { lidos_no_ciclo?: number }, mensagem: string, db: Supabase): Promise<Diagnostico> {
  const r = info.registro ?? {}
  const idItem = num(r._idmercadoriavariacao ?? r.idmercadoriavariacao)
  const idDoc = num(r._iddocumento)
  const idPessoa = num(r._idpessoa ?? r.idpessoa)
  const idLocal = num(r._idlocalestoque ?? r.idlocalestoque), idEmpresa = num(r._idempresa ?? r.idempresa)

  const [prod, doc, pessoa, local] = await Promise.all([
    idItem !== null && Number.isSafeInteger(idItem) ? db.select<Row>('vw_produto_desempenho', `idmercadoriavariacao=eq.${idItem}&select=descricao,codigobarras,secao,setor,estoque_atual`).catch(() => []) : [],
    idDoc !== null && Number.isSafeInteger(idDoc) ? db.select<Row>('erp_documento', `_iddocumento=eq.${idDoc}&select=numero,serie,modelo,datahora,idpessoa`).catch(() => []) : [],
    idPessoa !== null && Number.isSafeInteger(idPessoa) ? db.select<Row>('erp_pessoa', `_idpessoa=eq.${idPessoa}&select=nome,sobrenome`).catch(() => []) : [],
    idLocal !== null && Number.isSafeInteger(idLocal) ? db.select<Row>('erp_local_estoque', `_idlocal=eq.${idLocal}${idEmpresa !== null && Number.isSafeInteger(idEmpresa) ? `&_idempresa=eq.${idEmpresa}` : ''}&select=descricao`).catch(() => []) : [],
  ])

  const chave = `${info.tabela}.${info.coluna}`
  const campo = CAMPOS[chave] ?? { nome: `campo "${info.coluna.replace(/^_/, '')}"`, tela: `Cadastro correspondente a "${TABELAS[info.tabela] ?? info.tabela}" no ERP.` }
  const recebido = valorLegivel(String(info.valor ?? ''))
  const p = prod[0]
  const item = idItem !== null ? { id: idItem, nome: (p?.descricao as string) ?? (r.descricao as string) ?? null, codigobarras: (p?.codigobarras as string) ?? (r.codigobarras as string) ?? null, secao: (p?.secao as string) ?? null, setor: (p?.setor as string) ?? null, estoque: num(p?.estoque_atual) } : undefined
  const lote = r._lote !== undefined || r.lote !== undefined ? {
    lote: String(r._lote ?? r.lote), entrada: r._dtentrada ? dataBr(String(r._dtentrada)) : null,
    validade: r._dtvalidade ?? r.dtvalidade ? valorLegivel(String(r._dtvalidade ?? r.dtvalidade)) : null,
    local: (local[0]?.descricao as string) ?? (idLocal !== null ? `Local ${idLocal}` : null), saldo: num(r.qtdsaldo),
  } : undefined
  const d = doc[0]
  const documento = idDoc !== null ? { id: idDoc, numero: (d?.numero as string) ?? (r.numero as string) ?? null, modelo: (d?.modelo as string) ?? (r.modelo as string) ?? null, data: d?.datahora ? dataBr(String(d.datahora)) : r.datahora && /^\d{4}-\d{2}-\d{2}/.test(String(r.datahora)) ? dataBr(String(r.datahora)) : null, pessoa: null as string | null } : undefined
  const pes = pessoa[0] ? { id: idPessoa!, nome: [pessoa[0].nome, pessoa[0].sobrenome].map(x => String(x ?? '').trim()).filter(Boolean).join(' ') || null } : idPessoa !== null ? { id: idPessoa, nome: (r.nome as string) ?? null } : undefined

  // Passo a passo, do jeito que a pessoa faz no ERP.
  const passos: string[] = []
  if (item) passos.push(`No ERP, abra o produto "${item.nome ?? `código ${item.id}`}" (código interno ${item.id}${item.codigobarras ? `, código de barras ${item.codigobarras}` : ''}).`)
  if (lote) passos.push(`Localize o lote "${lote.lote}"${lote.entrada ? `, com entrada em ${lote.entrada}` : ''}${lote.local ? `, no ${lote.local.toLowerCase()}` : ''}${lote.saldo !== null ? ` (saldo ${lote.saldo})` : ''}.`)
  if (documento && !item) passos.push(`No ERP, localize o documento ${documento.modelo ?? ''} nº ${documento.numero ?? documento.id}${documento.data ? ` de ${documento.data}` : ''} (código interno ${documento.id}).`)
  if (documento && item) passos.push(`O item está no documento ${documento.modelo ?? ''} nº ${documento.numero ?? documento.id}${documento.data ? ` de ${documento.data}` : ''}: abra esse documento.`)
  if (pes && !item && !documento) passos.push(`No ERP, abra o cadastro de "${pes.nome ?? `pessoa ${pes.id}`}" (código ${pes.id}).`)
  passos.push(/data|validade/i.test(campo.nome)
    ? `Corrija a ${campo.nome}: hoje está "${recebido}". Confira a data certa na embalagem ou na nota de entrada.`
    : `Corrija o ${campo.nome}: hoje está "${recebido}".`)
  passos.push('Salve. A leitura tenta de novo sozinha na próxima rodada; para não esperar, use "Ler de novo" nesta tela.')

  const tabela = TABELAS[info.tabela] ?? info.tabela
  return {
    titulo: item ? `${item.nome ?? `Produto ${item.id}`}: ${campo.nome} inválida` : `${tabela}: ${campo.nome} inválido(a)`,
    campo: campo.nome, valor_recebido: recebido, problema: explicar(info), onde_corrigir: campo.tela, passos,
    impacto: `A leitura de "${tabela}" está parada neste registro${info.lidos_no_ciclo ? ` (${info.lidos_no_ciclo.toLocaleString('pt-BR')} registros já lidos nesta volta)` : ''}. Os registros seguintes só entram depois da correção; as outras tabelas continuam normais.`,
    item, lote, documento, pessoa: pes, tecnico: mensagem,
  }
}
