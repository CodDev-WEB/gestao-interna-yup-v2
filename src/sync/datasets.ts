// Conjuntos de dados extraídos do ERP (Santarém Sistemas / Meu ERP Online).
// Nomes de tabelas e colunas conferidos com o dicionário do banco do ERP ("tabelas banco.txt").
// Colunas iniciadas por "_" formam a chave primária no ERP.
//
// Este arquivo é a fonte única: a migração das tabelas espelho (supabase/migrations/*_erp_mirror.sql)
// é gerada a partir dele por `npm run gen:sql`, e o teste confere que estão iguais.

export type ColType = 'int' | 'num' | 'text' | 'date' | 'ts'

/**
 * snapshot: varre a tabela inteira a cada `refreshMinutes`; o que não apareceu na varredura
 *           completa é marcado com sync_deleted_at (nada é apagado).
 * append:   lê só chaves maiores que o cursor (registros novos); o cursor nunca volta.
 * recent:   relê a janela dos últimos N dias (status, cancelamentos, devoluções) na mesma tabela de destino.
 */
export type Kind = 'snapshot' | 'append' | 'recent'

export interface Dataset {
  /** Nome do job (único). */
  name: string
  /** Tabela no ERP. */
  table: string
  kind: Kind
  /** Colunas da chave, na ordem do ORDER BY (keyset). */
  keys: string[]
  /** Colunas extraídas (inclui as chaves). */
  columns: string[]
  refreshMinutes: number
  /** Só para kind 'recent': filtro da janela; recebe o literal SQL da data inicial ('AAAA-MM-DD'). */
  recentFilter?: (fromLiteral: string) => string
  description: string
}

// Colunas de texto cujo nome enganaria a inferência (ex.: "numero", "lote", "embalagem").
const TEXT_COLUMNS = new Set([
  'numero', 'serie', 'modelo', 'status', 'lote', '_lote', 'embalagem', '_embalagem', 'codigobarras', 'referencia',
  'codigoexterno', 'cfop', 'descricao', 'nome', 'sobrenome', 'marca', 'motivo', 'tipo', 'tipomovimento',
  'tipomovimentoestoque', 'tipomovimentofinanceiro', 'tipocategoria', 'tipofinalidade',
])
// Datas com hora (as demais dt* são só data).
const TIMESTAMP_COLUMNS = new Set(['dtalteracao', 'dataalteracao', 'datacadastro'])

/** Tipo da coluna no espelho, pela convenção de nomes do ERP. */
export function columnType(col: string): ColType {
  if (TEXT_COLUMNS.has(col)) return 'text'
  if (col.startsWith('flag')) return 'text'
  if (TIMESTAMP_COLUMNS.has(col) || col.startsWith('datahora')) return 'ts'
  if (/^_?dt/.test(col) || col === 'dataclientedesde') return 'date'
  if (/^_?id/.test(col)) return 'int'
  if (/^(val|qtd|per)/.test(col)) return 'num'
  return 'text'
}

/** Tabela de destino no Supabase. */
export const target = (d: Dataset) => `erp_${d.table}`

const cols = (s: string) => s.split(',').map(c => c.trim()).filter(Boolean)

// Colunas por tabela (subconjunto útil para a gestão; dados sensíveis como senha e CPF/CNPJ ficam de fora).
const C = {
  documento: cols('_iddocumento, idempresa, idpessoa, idusuario, datahora, datahoramovimento, numero, serie, modelo, tipomovimento, tipomovimentoestoque, tipomovimentofinanceiro, idnaturezaoperacao, status'),
  documento_mercadoria: cols('_iddocumento, _idsequencia, idmercadoria, idmercadoriavariacao, descricao, qtd, qtdfator, qtdestoque, qtddevolucao, valunitarioliquido, valtotalbruto, valtotalliquido, valdesconto, valacrescimo, valdescontocashback, idsecao, idgrupo, idsubgrupo, idmarca, idlocalestoque, idpessoafuncionario, lote, dtvalidade, flagbonificacao, iddocumentoorigem'),
  documento_mercadoria_custo: cols('_iddocumento, _idsequencia, idmercadoriavariacao, valcusto, valcustomedio, valfrete, valipi, valicmsst, valoutroscustos'),
  documento_cancelamento_historico: cols('_iddocumento, datahora, motivo'),
  mercadoria: cols('_idmercadoria, descricao, referencia, idtipo, idsecao, idgrupo, idsubgrupo, dtalteracao'),
  mercadoria_variacao: cols('_idmercadoriavariacao, idmercadoria, descricao, referencia, codigobarras, embalagem, marca, idmarca, dtalteracao'),
  mercadoria_secao: cols('_idsecao, descricao, flaginativo'),
  mercadoria_grupo: cols('_idgrupo, descricao, flaginativo'),
  mercadoria_subgrupo: cols('_idsubgrupo, descricao, flaginativo'),
  mercadoria_marca: cols('_idmarca, descricao, flaginativo'),
  natureza_operacao: cols('_idempresa, _idnatureza, descricao, tipomovimento, tipocategoria, cfop, flagmovimentarestoque, flagmovimentarfinanceiro, flagmovimentarcusto, flaginativo'),
  local_estoque: cols('_idempresa, _idlocal, descricao, flaginativo'),
  pessoa: cols('_idpessoa, nome, sobrenome, tipo, idgrupo, datacadastro, dataalteracao, dataclientedesde, flaginativo'),
  mercadoria_fornecedor: cols('_idmercadoriavariacao, _idpessoa, _embalagem, qtdfator, codigoexterno'),
  mercadoria_custo: cols('_idempresa, _idmercadoriavariacao, valcusto, valcustomedio, datahora'),
  mercadoria_estoque: cols('_idempresa, _idlocalestoque, _idmercadoriavariacao, qtdsaldo, qtdsaldoreserva, datahora'),
  mercadoria_estoque_lote: cols('_idempresa, _idlocalestoque, _idmercadoriavariacao, _lote, _dtvalidade, _dtentrada, qtdsaldo, datahora, dtfabricacao'),
  mercadoria_tabela_preco: cols('_idempresa, _idmercadoriavariacao, _idtabela, valpreco, valcusto, flaginativo, dtalteracao'),
  mercadoria_tabela_preco_historico: cols('_idhistorico, _idempresa, _idmercadoriavariacao, _idtabela, datahora, valprecotual, valpreconovo'),
  mercadoria_estoque_historico: cols('_idhistorico, _iddocumento, _idlocalestoque, idmercadoriavariacao, datahora, qtdsaldoatual, qtdnovosaldo'),
  inventario: cols('_idinventario, idempresa, descricao, idlocalestoque, status, datahora, iddocumento, tipofinalidade'),
  inventario_mercadoria: cols('_idinventario, _idsequencia, idmercadoriavariacao, datahora, qtdcontada, qtdanterior, valcusto, valcustomedio, lote, dtvalidade'),
}

const keysOf = (columns: string[]) => columns.filter(c => c.startsWith('_'))

function ds(name: string, table: keyof typeof C, kind: Kind, refreshMinutes: number, description: string, recentFilter?: Dataset['recentFilter']): Dataset {
  const columns = C[table]
  return { name, table, kind, keys: keysOf(columns), columns, refreshMinutes, recentFilter, description }
}

const docWindow = (from: string) => `t._iddocumento IN (SELECT d._iddocumento FROM documento d WHERE d.datahora >= ${from})`

/** Ordem = prioridade de execução: cadastros pequenos primeiro, depois saldos, depois o histórico grande. */
export const DATASETS: Dataset[] = [
  ds('mercadoria_secao', 'mercadoria_secao', 'snapshot', 1440, 'Seções (setores) das mercadorias'),
  ds('mercadoria_grupo', 'mercadoria_grupo', 'snapshot', 1440, 'Grupos das mercadorias'),
  ds('mercadoria_subgrupo', 'mercadoria_subgrupo', 'snapshot', 1440, 'Subgrupos das mercadorias'),
  ds('mercadoria_marca', 'mercadoria_marca', 'snapshot', 1440, 'Marcas'),
  ds('natureza_operacao', 'natureza_operacao', 'snapshot', 1440, 'Naturezas de operação (regras de estoque/financeiro)'),
  ds('local_estoque', 'local_estoque', 'snapshot', 1440, 'Locais de estoque'),
  ds('mercadoria', 'mercadoria', 'snapshot', 1440, 'Cadastro de mercadorias'),
  ds('mercadoria_variacao', 'mercadoria_variacao', 'snapshot', 1440, 'Variações (SKU, embalagem, código de barras)'),
  ds('pessoa', 'pessoa', 'snapshot', 1440, 'Clientes, fornecedores e funcionários (sem documentos pessoais)'),
  ds('mercadoria_fornecedor', 'mercadoria_fornecedor', 'snapshot', 1440, 'Fornecedores de cada variação'),
  ds('mercadoria_estoque', 'mercadoria_estoque', 'snapshot', 360, 'Saldo atual por local'),
  ds('mercadoria_custo', 'mercadoria_custo', 'snapshot', 1440, 'Custo e custo médio atuais'),
  ds('mercadoria_estoque_lote', 'mercadoria_estoque_lote', 'snapshot', 720, 'Saldo por lote e validade'),
  ds('mercadoria_tabela_preco', 'mercadoria_tabela_preco', 'snapshot', 1440, 'Preços de venda atuais'),
  ds('inventario', 'inventario', 'snapshot', 360, 'Inventários'),
  ds('inventario_mercadoria', 'inventario_mercadoria', 'snapshot', 1440, 'Contagens de inventário'),
  ds('documento', 'documento', 'append', 5, 'Documentos novos (vendas, compras, devoluções...)'),
  ds('documento_mercadoria', 'documento_mercadoria', 'append', 5, 'Itens dos documentos novos'),
  ds('documento_mercadoria_custo', 'documento_mercadoria_custo', 'append', 5, 'Custo dos itens dos documentos novos'),
  ds('documento_recente', 'documento', 'recent', 720, 'Relê documentos dos últimos dias (status e cancelamentos)', from => `t.datahora >= ${from}`),
  ds('documento_mercadoria_recente', 'documento_mercadoria', 'recent', 720, 'Relê itens dos documentos dos últimos dias', docWindow),
  ds('documento_mercadoria_custo_recente', 'documento_mercadoria_custo', 'recent', 720, 'Relê custos dos itens dos últimos dias', docWindow),
  ds('documento_cancelamento_historico', 'documento_cancelamento_historico', 'append', 15, 'Cancelamentos de documentos'),
  ds('mercadoria_tabela_preco_historico', 'mercadoria_tabela_preco_historico', 'append', 60, 'Histórico de alterações de preço'),
  ds('mercadoria_estoque_historico', 'mercadoria_estoque_historico', 'append', 30, 'Histórico de saldos (linha do tempo do estoque)'),
]

// Defesa: identificadores entram no SQL sem aspas, então só letras minúsculas, números e "_".
for (const d of DATASETS) {
  for (const id of [d.table, ...d.columns]) if (!/^[a-z_][a-z0-9_]*$/.test(id)) throw new Error(`Identificador inválido em ${d.name}: ${id}`)
  if (!d.keys.length) throw new Error(`Dataset ${d.name} sem chave.`)
  if (d.kind === 'recent' && !d.recentFilter) throw new Error(`Dataset ${d.name} sem filtro de janela.`)
}
if (new Set(DATASETS.map(d => d.name)).size !== DATASETS.length) throw new Error('Nomes de dataset repetidos.')

export const DATASET_BY_NAME = new Map(DATASETS.map(d => [d.name, d]))

/** Uma definição por tabela de destino (para gerar o SQL do espelho). */
export function mirrorTables(): Dataset[] {
  const seen = new Map<string, Dataset>()
  for (const d of DATASETS) if (!seen.has(d.table)) seen.set(d.table, d)
  return [...seen.values()]
}
