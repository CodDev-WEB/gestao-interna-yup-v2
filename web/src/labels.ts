// Nomes e cores fixos por situação (a cor acompanha a situação, nunca a posição).

export const SITUACOES = [
  { id: 'saudavel', nome: 'Saudável', desc: 'Vende e o estoque cobre até 120 dias', cor: 'var(--s1)', texto: '#10363b' },
  { id: 'excesso_estoque', nome: 'Excesso de estoque', desc: 'Estoque para mais de 120 dias de venda', cor: 'var(--s2)', texto: '#3d1d05' },
  { id: 'baixa_movimentacao', nome: 'Baixa movimentação', desc: 'Última venda entre 30 e 90 dias', cor: 'var(--s3)', texto: '#fff' },
  { id: 'parado', nome: 'Parado', desc: 'Mais de 90 dias sem venda, com estoque', cor: 'var(--s4)', texto: '#3b3000' },
  { id: 'sem_saida_historica', nome: 'Sem saída', desc: 'Entrou no estoque e nunca vendeu', cor: 'var(--s5)', texto: '#3e0d22' },
  { id: 'sem_movimento', nome: 'Sem movimento', desc: 'Sem compra nem venda registradas', cor: 'var(--s-outro)', texto: '#1b2633' },
  { id: 'ruptura', nome: 'Ruptura', desc: 'Vendeu nos últimos 30 dias e está zerado', cor: 'var(--s6)', texto: '#fff' },
] as const

export const situacao = (id: string) => SITUACOES.find(s => s.id === id) ?? { id, nome: id, desc: '', cor: 'var(--s-outro)', texto: '#1b2633' }

export const FAIXAS = [
  { id: 'vencido', nome: 'Vencido', classe: 'status-bad', tom: 'red' },
  { id: 'critico_7d', nome: 'Vence em até 7 dias', classe: 'status-bad', tom: 'red' },
  { id: 'alto_30d', nome: 'Vence em até 30 dias', classe: 'status-warn', tom: 'gold' },
  { id: 'atencao_60d', nome: 'Vence em até 60 dias', classe: 'status-warn', tom: 'gold' },
  { id: 'monitorar_90d', nome: 'Vence em até 90 dias', classe: '', tom: 'blue' },
] as const
export const faixa = (id: string) => FAIXAS.find(f => f.id === id) ?? { id, nome: 'Mais de 90 dias', classe: '', tom: 'blue' }

export const SEGMENTOS = [
  { id: 'vip', nome: 'VIP', desc: 'Compram muito e com frequência' },
  { id: 'recorrente', nome: 'Recorrentes', desc: 'Voltam a comprar no ritmo de sempre' },
  { id: 'novo', nome: 'Novos', desc: 'Primeira compra nos últimos 30 dias' },
  { id: 'em_risco', nome: 'Em risco', desc: 'Passaram do dobro do intervalo habitual sem comprar' },
  { id: 'inativo', nome: 'Inativos', desc: 'Mais de 180 dias sem comprar' },
  { id: 'ocasional', nome: 'Ocasionais', desc: 'Compraram uma vez' },
] as const

export const SETORES = ['Alimentação', 'Farmácia', 'Diversos'] as const
export const SETOR_COR: Record<string, string> = { 'Alimentação': 'var(--s1)', 'Farmácia': 'var(--s2)', 'Diversos': 'var(--s3)', 'Não classificado': 'var(--s-outro)' }
