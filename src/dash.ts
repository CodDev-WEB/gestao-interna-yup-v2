// API de leitura do site (/api/dash/*). Só admin logado chega aqui (checado em index.ts).
// O navegador só envia filtros; cada filtro é validado contra uma lista fechada antes de virar consulta.

import type { Supabase } from './supabase/client'
import { produtoDetalhe } from './produto'

export class DashError extends Error {}

const SITUACOES = ['sem_saida_historica', 'parado', 'baixa_movimentacao', 'excesso_estoque', 'ruptura', 'saudavel', 'sem_movimento']
const FAIXAS = ['vencido', 'critico_7d', 'alto_30d', 'atencao_60d', 'monitorar_90d', 'normal']
const SEGMENTOS = ['vip', 'recorrente', 'novo', 'em_risco', 'inativo', 'ocasional']
const SETORES = ['Alimentação', 'Farmácia', 'Diversos']

const ISO = /^\d{4}-\d{2}-\d{2}$/

function hojeBelem(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}
function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const pick = (v: string | null, allowed: string[]) => (v && allowed.includes(v) ? v : null)
const int = (v: string | null, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}
/** Texto de busca: só letras, números, espaço e hífen (vira ilike no PostgREST). */
const busca = (v: string | null) => (v ?? '').normalize('NFC').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 60)
const ilike = (col: string, s: string) => `&${col}=ilike.${encodeURIComponent(`*${s.replace(/ +/g, '*')}*`)}`
const order = (v: string | null, allowed: string[], def: string, dir: string | null) =>
  `&order=${pick(v, allowed) ?? def}.${dir === 'asc' ? 'asc' : 'desc'}.nullslast`

function periodo(q: URLSearchParams, padraoDias: number) {
  const fim = q.get('fim') && ISO.test(q.get('fim')!) ? q.get('fim')! : hojeBelem()
  const inicio = q.get('inicio') && ISO.test(q.get('inicio')!) ? q.get('inicio')! : addDays(fim, -(padraoDias - 1))
  if (inicio > fim) throw new DashError('Data inicial depois da final.')
  return { inicio, fim }
}

type Num = number | string | null
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v))

export async function dash(path: string, q: URLSearchParams, db: Supabase): Promise<unknown> {
  switch (path) {
    // Visão executiva: período atual vs anterior, capital por situação e pontos a atacar.
    case 'resumo': {
      const dias = int(q.get('dias'), 30, 7, 365)
      const fim = hojeBelem()
      const inicio = addDays(fim, -(dias - 1))
      const inicioAnt = addDays(inicio, -dias)
      const [diario, capital, lotes, aumentos, risco, declinio, sync] = await Promise.all([
        db.selectAll<Record<string, Num>>('vw_venda_diaria', `data=gte.${inicioAnt}&data=lte.${fim}&select=data,vendas,faturamento_bruto,devolucoes,faturamento_liquido,lucro_bruto,custo,itens_sem_custo&order=data.asc`),
        db.select('vw_capital_situacao', 'select=*'),
        db.select('vw_lote_resumo', 'select=*'),
        db.count('vw_fornecedor_preco_item', 'variacao_ultima_pct=gte.10'),
        db.count('vw_cliente_rfm', 'segmento=eq.em_risco'),
        db.count('vw_produto_declinio', 'queda_consecutiva=is.true&estoque_atual=gt.0'),
        db.select<{ dataset: string; status: string; last_synced_at: string | null; last_completed_at: string | null }>('sync_state', 'select=dataset,status,last_synced_at,last_completed_at'),
      ])
      // Soma por dia (a view separa por empresa).
      const porDia = new Map<string, { data: string; faturamento: number; lucro: number; vendas: number; devolucoes: number; sem_custo: number }>()
      for (const r of diario) {
        const k = String(r.data)
        const cur = porDia.get(k) ?? { data: k, faturamento: 0, lucro: 0, vendas: 0, devolucoes: 0, sem_custo: 0 }
        cur.faturamento += n(r.faturamento_liquido); cur.lucro += n(r.lucro_bruto); cur.vendas += n(r.vendas); cur.devolucoes += n(r.devolucoes); cur.sem_custo += n(r.itens_sem_custo)
        porDia.set(k, cur)
      }
      const soma = (de: string, ate: string) => {
        const t = { faturamento: 0, lucro: 0, vendas: 0, devolucoes: 0, sem_custo: 0 }
        for (const d of porDia.values()) if (d.data >= de && d.data <= ate) { t.faturamento += d.faturamento; t.lucro += d.lucro; t.vendas += d.vendas; t.devolucoes += d.devolucoes; t.sem_custo += d.sem_custo }
        return { ...t, margem: t.faturamento ? t.lucro / t.faturamento * 100 : null, ticket: t.vendas ? t.faturamento / t.vendas : null }
      }
      const serie: { data: string; faturamento: number; lucro: number; vendas: number }[] = []
      for (let d = inicio; d <= fim; d = addDays(d, 1)) { const v = porDia.get(d); serie.push({ data: d, faturamento: v?.faturamento ?? 0, lucro: v?.lucro ?? 0, vendas: v?.vendas ?? 0 }) }
      const ultima = sync.map(s => s.last_synced_at).filter(Boolean).sort().pop() ?? null
      return {
        periodo: { inicio, fim, dias, anterior: { inicio: inicioAnt, fim: addDays(inicio, -1) } },
        atual: soma(inicio, fim), anterior: soma(inicioAnt, addDays(inicio, -1)),
        serie, capital, lotes,
        contagens: { fornecedores_aumento_10pct: aumentos, clientes_em_risco: risco, produtos_em_declinio: declinio },
        sync: { ultima_atualizacao: ultima, jobs: sync.length, com_erro: sync.filter(s => s.status === 'error').length, em_andamento: sync.filter(s => s.status === 'running').length },
      }
    }

    case 'vendas': {
      const { inicio, fim } = periodo(q, 30)
      return { inicio, fim, dias: await db.selectAll('vw_venda_diaria', `data=gte.${inicio}&data=lte.${fim}&select=*&order=data.asc`) }
    }

    case 'produtos': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const sit = pick(q.get('situacao'), SITUACOES), setor = pick(q.get('setor'), [...SETORES, 'Não classificado']), s = busca(q.get('busca'))
      const filtro = (sit ? `&situacao=eq.${sit}` : '') + (setor ? `&setor=eq.${encodeURIComponent(setor)}` : '') + (s ? ilike('descricao', s) : '')
      const cols = ['valor_estoque', 'estoque_atual', 'dias_sem_venda', 'qtd_90d', 'faturamento_90d', 'lucro_90d', 'margem_90d_pct', 'cobertura_dias', 'descricao', 'ultima_venda']
      return db.selectPage('vw_produto_desempenho', `select=*${filtro}${order(q.get('ordem'), cols, 'valor_estoque', q.get('dir'))}`, limit, offset)
    }

    case 'lotes': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const faixa = pick(q.get('faixa'), FAIXAS), s = busca(q.get('busca'))
      const filtro = (faixa ? `&faixa=eq.${faixa}` : '&faixa=neq.normal') + (q.get('risco') === '1' ? '&risco_perda=is.true' : '') + (s ? ilike('descricao', s) : '')
      return db.selectPage('vw_lote_validade', `select=*${filtro}${order(q.get('ordem'), ['dias_para_vencer', 'valor_em_risco', 'qtdsaldo'], 'dias_para_vencer', q.get('dir') ?? 'asc')}`, limit, offset)
    }

    case 'lotes-resumo':
      return db.select('vw_lote_resumo', 'select=*')

    case 'fornecedores': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000), s = busca(q.get('busca'))
      return db.selectPage('vw_fornecedor_resumo', `select=*${s ? ilike('nome', s) : ''}${order(q.get('ordem'), ['total_comprado', 'compras', 'ticket_medio', 'skus', 'ultima_compra', 'participacao_pct'], 'total_comprado', q.get('dir'))}`, limit, offset)
    }

    case 'precos': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const forn = q.get('fornecedor') && /^\d{1,12}$/.test(q.get('fornecedor')!) ? `&idfornecedor=eq.${q.get('fornecedor')}` : ''
      const min = q.get('min') && /^-?\d{1,3}$/.test(q.get('min')!) ? `&variacao_ultima_pct=gte.${q.get('min')}` : ''
      return db.selectPage('vw_fornecedor_preco_item', `select=*${forn}${min}${order(q.get('ordem'), ['variacao_ultima_pct', 'ultimo_preco', 'ultima_compra', 'compras'], 'variacao_ultima_pct', q.get('dir'))}`, limit, offset)
    }

    case 'setores': {
      const desde = addDays(hojeBelem(), -400).slice(0, 7) + '-01'
      return db.selectAll('vw_setor_mensal', `mes=gte.${desde}&select=*&order=mes.asc`)
    }

    case 'clientes': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const seg = pick(q.get('segmento'), SEGMENTOS), s = busca(q.get('busca'))
      const filtro = (seg ? `&segmento=eq.${seg}` : '') + (s ? ilike('nome', s) : '')
      return db.selectPage('vw_cliente_rfm', `select=*${filtro}${order(q.get('ordem'), ['valor_total', 'compras', 'recencia_dias', 'ticket_medio', 'ultima_compra', 'proxima_compra_prevista'], 'valor_total', q.get('dir'))}`, limit, offset)
    }

    case 'clientes-segmentos': {
      const contagens = await Promise.all(SEGMENTOS.map(async sgm => [sgm, await db.count('vw_cliente_rfm', `segmento=eq.${sgm}`)] as const))
      return Object.fromEntries(contagens)
    }

    case 'declinio': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      return db.selectPage('vw_produto_declinio', `select=*&queda_consecutiva=is.true&order=qtd_3_meses_atras.desc`, limit, offset)
    }

    case 'secoes':
      return db.select('vw_secao_setor', 'select=*&order=descricao.asc')

    // Ficha completa de um item (painel que abre ao clicar no produto).
    case 'produto': {
      const id = q.get('id')
      if (!id || !/^\d{1,12}$/.test(id)) throw new DashError('Informe o id da variação.')
      const r = await produtoDetalhe(Number(id), db)
      if (!r) throw new DashError('Item não encontrado.')
      return r
    }
  }
  throw new DashError('Consulta desconhecida.')
}

/** Classifica uma seção do ERP num setor (ou remove a classificação). */
export async function salvarSecao(db: Supabase, body: Record<string, unknown>) {
  const id = body.idsecao
  if (!Number.isSafeInteger(id)) throw new DashError('"idsecao" inválido.')
  if (body.setor === null) { await db.deleteWhere('cfg_secao_setor', `idsecao=eq.${id}`); return { ok: true } }
  if (typeof body.setor !== 'string' || !SETORES.includes(body.setor)) throw new DashError(`"setor" precisa ser um de: ${SETORES.join(', ')} (ou null).`)
  await db.upsert('cfg_secao_setor', [{ idsecao: id, setor: body.setor }], 'idsecao')
  return { ok: true }
}
