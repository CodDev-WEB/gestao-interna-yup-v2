// Remove do espelho o que for de outra empresa (só a Yup, empresa 1, faz parte do sistema). A leitura do ERP já
// ignora as outras; isto apaga o que tinha entrado antes. Roda no cron até não sobrar nada (lotes de 200 documentos).

import type { Supabase } from './supabase/client'
import { EMPRESA_YUP } from './sync/datasets'

export async function limparOutrasEmpresas(db: Supabase): Promise<number> {
  const outra = `neq.${EMPRESA_YUP}`
  let docs = 0
  for (let i = 0; i < 3; i++) {
    const lote = await db.select<{ _iddocumento: number }>('erp_documento', `idempresa=${outra}&select=_iddocumento&limit=200`)
    if (!lote.length) break
    const ids = `_iddocumento=in.(${lote.map(d => Number(d._iddocumento)).join(',')})`
    for (const t of ['erp_documento_mercadoria_custo', 'erp_documento_mercadoria', 'erp_documento_cancelamento_historico', 'erp_mercadoria_estoque_historico', 'erp_documento']) await db.deleteWhere(t, ids)
    docs += lote.length
  }
  for (const t of ['erp_mercadoria_estoque', 'erp_mercadoria_estoque_lote', 'erp_mercadoria_custo', 'erp_mercadoria_tabela_preco', 'erp_mercadoria_tabela_preco_historico', 'erp_natureza_operacao', 'erp_local_estoque']) await db.deleteWhere(t, `_idempresa=${outra}`)
  await db.deleteWhere('erp_inventario', `idempresa=${outra}`)
  return docs
}
