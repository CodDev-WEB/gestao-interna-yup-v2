// API de leitura do site (/api/dash/*). Só admin logado chega aqui (checado em index.ts).
// O navegador só envia filtros; cada filtro é validado contra uma lista fechada antes de virar consulta.

import { SupabaseError, type Supabase } from './supabase/client'
import { produtoDetalhe } from './produto'
import { clienteDetalhe, vendasCarregadasAte } from './cliente'

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

/** Tabela/view ainda não criada no Supabase: mensagem que diz o que instalar. */
function faltaMigracao(e: unknown) {
  if (e instanceof SupabaseError && /PGRST205|42P01|Could not find|does not exist/.test(e.message))
    return new DashError('A classificação por NCM ainda não foi instalada no banco. Rode no SQL Editor do Supabase as migrações 20261117010000_erp_mirror.sql, 20261118000000_resumo_mes.sql e 20261120000000_ncm_setores.sql (ou cadastre SUPABASE_DB_URL no GitHub para isso ser automático).')
  return e
}

type Num = number | string | null
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v))

/** Acrescenta a cada produto o último preço de compra (por unidade de estoque) e de quem foi comprado. */
async function comUltimaCompra(db: Supabase, rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.map(r => Number(r.idmercadoriavariacao)).filter(Number.isSafeInteger))]
  if (!ids.length) return rows
  const compras = await db.select<Record<string, Num>>('vw_compra_item', `idmercadoriavariacao=in.(${ids.join(',')})&select=idmercadoriavariacao,data,idfornecedor,qtd,qtdestoque,valtotalliquido&order=datahora.desc&limit=2000`)
  const ultima = new Map<number, Record<string, Num>>()
  for (const c of compras) if (!ultima.has(Number(c.idmercadoriavariacao)) && n(c.valtotalliquido) > 0) ultima.set(Number(c.idmercadoriavariacao), c)
  const idsForn = [...new Set([...ultima.values()].map(c => Number(c.idfornecedor)).filter(x => x > 0))]
  const pessoas = idsForn.length ? await db.select<Record<string, string | number | null>>('erp_pessoa', `_idpessoa=in.(${idsForn.join(',')})&select=_idpessoa,nome,sobrenome`) : []
  const nome = new Map(pessoas.map(p => [Number(p._idpessoa), [p.nome, p.sobrenome].map(x => String(x ?? '').trim()).filter(Boolean).join(' ')]))
  return rows.map(r => {
    const c = ultima.get(Number(r.idmercadoriavariacao))
    if (!c) return { ...r, ultimo_preco_compra: null, ultimo_fornecedor: null, ultima_compra: null }
    const un = n(c.qtdestoque) > 0 ? n(c.qtdestoque) : n(c.qtd)
    return { ...r, ultimo_preco_compra: un ? n(c.valtotalliquido) / un : null, ultimo_fornecedor: nome.get(Number(c.idfornecedor)) || (c.idfornecedor ? `Fornecedor ${c.idfornecedor}` : null), ultima_compra: c.data }
  })
}

const CLASSES = ['A', 'B', 'C']
const PROBLEMAS = ['estoque_negativo', 'sem_custo', 'sem_codigo_barras', 'ncm_invalido', 'lote_vencido']
const MOTIVOS = ['furto', 'avaria', 'erro_entrada', 'erro_venda', 'vencimento', 'outro']

/** Gestão do estoque (migração 20261121000000_gestao_estoque.sql) ainda não instalada: diz o que fazer. */
function faltaGestao(e: unknown) {
  if (e instanceof SupabaseError && /PGRST205|PGRST202|42P01|Could not find|does not exist/.test(e.message))
    return new DashError('A gestão do estoque (curva ABC, reposição, contagem e qualidade do dado) ainda não foi instalada no banco. Falta aplicar a migração 20261121000000_gestao_estoque.sql (automático quando o secret SUPABASE_DB_URL estiver certo no GitHub).')
  return e
}

/** Classe ABC de cada produto da página (itens sem venda no último ano são C). */
async function comClasse(db: Supabase, rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.map(r => Number(r.idmercadoriavariacao)).filter(Number.isSafeInteger))]
  if (!ids.length) return rows
  const abc = await db.select<{ idmercadoriavariacao: number; classe: string }>('mv_produto_abc', `idmercadoriavariacao=in.(${ids.join(',')})&select=idmercadoriavariacao,classe`).catch(() => null)
  if (!abc) return rows
  const classe = new Map(abc.map(a => [Number(a.idmercadoriavariacao), a.classe]))
  return rows.map(r => ({ ...r, classe: classe.get(Number(r.idmercadoriavariacao)) ?? 'C' }))
}

/** Até onde a carga já trouxe os itens das vendas e os custos desses itens (data do documento no cursor de cada job). */
async function cargaVendas(db: Supabase) {
  const sync = await db.select<{ dataset: string; status: string; cursor: unknown[] | null }>('sync_state', 'dataset=in.(documento_mercadoria,documento_mercadoria_custo)&select=dataset,status,cursor')
  const ate = async (dataset: string) => {
    const s = sync.find(x => x.dataset === dataset)
    const id = Array.isArray(s?.cursor) ? Number(s!.cursor[0]) : null
    if (!id || !Number.isSafeInteger(id)) return { status: s?.status ?? null, ate: null as string | null }
    const [doc] = await db.select<{ datahora: string }>('erp_documento', `_iddocumento=eq.${id}&select=datahora`)
    return { status: s?.status ?? null, ate: doc ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date(doc.datahora)) : null }
  }
  const [itens, custos] = await Promise.all([ate('documento_mercadoria'), ate('documento_mercadoria_custo')])
  const emDia = (x: { status: string | null; ate: string | null }) => x.status === 'ok' || (x.ate !== null && x.ate >= addDays(hojeBelem(), -2))
  return { vendas_ate: itens.ate, custos_ate: custos.ate, vendas_completa: emDia(itens), custos_completa: emDia(custos) }
}

/** Reduz a curva de Pareto a no máximo `max` pontos (sempre com o primeiro, o último e as viradas de classe). */
function amostra<T extends { posicao: number; classe: string }>(rows: T[], max = 120) {
  if (rows.length <= max) return rows
  const passo = rows.length / max
  return rows.filter((r, i) => i === 0 || i === rows.length - 1 || r.classe !== rows[i - 1].classe || Math.floor(i / passo) !== Math.floor((i - 1) / passo))
}

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
        db.select<{ dataset: string; status: string; last_synced_at: string | null; last_completed_at: string | null; cursor: unknown[] | null }>('sync_state', 'select=dataset,status,last_synced_at,last_completed_at,cursor'),
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
      // Até onde os itens das vendas já foram copiados: data do documento no cursor da carga de itens.
      // Enquanto não chega a hoje, as conclusões que dependem de vendas recentes não são confiáveis.
      const itens = sync.find(x => x.dataset === 'documento_mercadoria')
      const docCursor = Array.isArray(itens?.cursor) ? Number(itens!.cursor[0]) : null
      const [docRef] = docCursor && Number.isSafeInteger(docCursor) ? await db.select<{ datahora: string }>('erp_documento', `_iddocumento=eq.${docCursor}&select=datahora`) : []
      const vendasAte = docRef ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date(docRef.datahora)) : null
      const completa = itens?.status === 'ok' || (vendasAte !== null && vendasAte >= addDays(hojeBelem(), -2))
      // Último mês inteiro já carregado, para o resumo falar de números reais durante a carga.
      let ultimoMes: { mes: string; kpis: unknown } | null = null
      if (!completa && vendasAte) {
        const ini = addDays(vendasAte.slice(0, 8) + '01', -1).slice(0, 8) + '01'
        const fimMes = vendasAte.slice(0, 8) + '01'
        const kpis = await db.rpc('resumo_kpis', { p_ini: ini, p_fim: fimMes }).catch(() => null)
        if (kpis) ultimoMes = { mes: ini.slice(0, 7), kpis }
      }
      return {
        periodo: { inicio, fim, dias, anterior: { inicio: inicioAnt, fim: addDays(inicio, -1) } },
        atual: soma(inicio, fim), anterior: soma(inicioAnt, addDays(inicio, -1)),
        serie, capital, lotes,
        contagens: { fornecedores_aumento_10pct: aumentos, clientes_em_risco: risco, produtos_em_declinio: declinio },
        carga: { completa, vendas_ate: vendasAte, ultimo_mes: ultimoMes },
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
      const ncm = q.get('ncm')
      const filtroNcm = ncm === 'sem' ? '&ncm=is.null' : ncm && /^\d{2,8}$/.test(ncm) ? `&ncm=like.${ncm}*` : ''
      const filtro = (sit ? `&situacao=eq.${sit}` : '') + (setor ? `&setor=eq.${encodeURIComponent(setor)}` : '') + (s ? (/^\d{1,14}$/.test(s) ? `&or=(idmercadoriavariacao.eq.${s.length <= 9 ? s : -1},codigobarras.eq.${s})` : ilike('descricao', s)) : '') + filtroNcm
      const cols = ['valor_estoque', 'estoque_atual', 'dias_sem_venda', 'qtd_90d', 'faturamento_90d', 'lucro_90d', 'margem_90d_pct', 'cobertura_dias', 'descricao', 'ultima_venda']
      const consulta = `select=*${filtro}${order(q.get('ordem'), cols, 'valor_estoque', q.get('dir'))}`
      // Sem a migração do NCM instalada, cai para a view antiga (o filtro por NCM exige a nova).
      const page = await db.selectPage<Record<string, unknown>>('vw_produto_ncm', consulta, limit, offset).catch(e => {
        if (!filtroNcm && e instanceof SupabaseError && /vw_produto_ncm|PGRST205|42P01/.test(e.message)) return db.selectPage<Record<string, unknown>>('vw_produto_desempenho', consulta, limit, offset)
        throw faltaMigracao(e)
      })
      return { ...page, rows: await comClasse(db, await comUltimaCompra(db, page.rows)) }
    }

    case 'lotes': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const faixa = pick(q.get('faixa'), FAIXAS), s = busca(q.get('busca'))
      const filtro = (faixa ? `&faixa=eq.${faixa}` : '&faixa=neq.normal') + (q.get('risco') === '1' ? '&risco_perda=is.true' : '') + (s ? ilike('descricao', s) : '')
      // Ordem: o que vence primeiro no topo e os vencidos juntos no fim; empate fica agrupado por produto e lote.
      // Ordenando por valor ou unidades, o desempate continua sendo a validade.
      const col = pick(q.get('ordem'), ['dias_para_vencer', 'valor_em_risco', 'qtdsaldo']) ?? 'dias_para_vencer'
      const sentido = q.get('dir') === 'desc' ? 'desc' : 'asc'
      const ordem = col === 'dias_para_vencer'
        ? `&order=vencido.${sentido === 'asc' ? 'asc' : 'desc'},dias_para_vencer.${sentido},descricao.asc,lote.asc`
        : `&order=${col}.${q.get('dir') === 'asc' ? 'asc' : 'desc'}.nullslast,vencido.asc,dias_para_vencer.asc,descricao.asc`
      return db.selectPage('vw_lote_disponivel', `select=*${filtro}${ordem}`, limit, offset)
        .catch(e => { if (e instanceof SupabaseError && /vencido/.test(e.message)) return db.selectPage('vw_lote_disponivel', `select=*${filtro}&order=dias_para_vencer.asc,descricao.asc`, limit, offset); throw e })
    }

    case 'lotes-resumo':
      return db.select('vw_validade_resumo', 'select=*').catch(() => db.select('vw_lote_resumo', 'select=*'))

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
      // Filtros: recompra atrasada, tempo desde a última compra, valor total e número de compras mínimos.
      const ultima = pick(q.get('ultima'), ['30', '90', '180', '180+'])
      const faixa = ultima === '30' ? '&recencia_dias=lte.30' : ultima === '90' ? '&recencia_dias=gt.30&recencia_dias=lte.90'
        : ultima === '180' ? '&recencia_dias=gt.90&recencia_dias=lte.180' : ultima === '180+' ? '&recencia_dias=gt.180' : ''
      const minValor = int(q.get('min_valor'), 0, 0, 10_000_000), minCompras = int(q.get('min_compras'), 0, 0, 100_000)
      const recompra = pick(q.get('recompra'), ['atrasada', 'em_dia'])
      // Folga de 3 dias: quem compra quase todo dia não conta como atrasado por um dia de diferença.
      const ref = recompra ? (await vendasCarregadasAte(db)).ate : null
      const limite = ref ? new Date(Date.parse(ref + 'T00:00:00Z') - 3 * 86_400_000).toISOString().slice(0, 10) : null
      const filtro = (seg ? `&segmento=eq.${seg}` : '') + (s ? ilike('nome', s) : '') + faixa
        + (minValor ? `&valor_total=gte.${minValor}` : '') + (minCompras ? `&compras=gte.${minCompras}` : '')
        + (recompra === 'atrasada' ? `&proxima_compra_prevista=lt.${limite}&recencia_dias=lte.180` : recompra === 'em_dia' ? `&proxima_compra_prevista=gte.${limite}` : '')
      return db.selectPage('vw_cliente_rfm', `select=*${filtro}${order(q.get('ordem'), ['valor_total', 'compras', 'recencia_dias', 'ticket_medio', 'ultima_compra', 'proxima_compra_prevista'], 'valor_total', q.get('dir'))}`, limit, offset)
    }

    // Ficha do cliente (painel que abre ao clicar no nome).
    case 'cliente': {
      const id = q.get('id')
      if (!id || !/^\d{1,12}$/.test(id)) throw new DashError('Informe o id do cliente.')
      const r = await clienteDetalhe(Number(id), db)
      if (!r) throw new DashError('Cliente não encontrado.')
      return r
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

    // Árvore setor → grupo (capítulo NCM) → subgrupo (posição) → NCM, com números de estoque e venda.
    case 'categorias':
      return db.selectAll('vw_categoria_ncm', 'select=*&order=setor.asc,capitulo.asc.nullslast,posicao.asc,ncm.asc').catch(e => { throw faltaMigracao(e) })

    case 'ncm-regras':
      return db.select('cfg_ncm_setor', 'select=prefixo,setor&order=prefixo.asc').catch(e => { throw faltaMigracao(e) })

    // Resumo do mês: calculado no banco (função resumo_mes), uma chamada só.
    case 'mes': {
      const m = q.get('mes')
      const mes = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : hojeBelem().slice(0, 7)
      try { return await db.rpc('resumo_mes', { p_mes: `${mes}-01` }) }
      catch (e) {
        if (e instanceof SupabaseError && (e.status === 404 || /resumo_mes|PGRST202/.test(e.message))) throw new DashError('O resumo do mês ainda não foi instalado no banco. Falta aplicar a migração 20261118000000_resumo_mes.sql (ver Sincronização).')
        throw e
      }
    }

    // ---------- Auditoria e vendedoras ----------
    // Última auditoria ERP × sistema (ao centavo) e o histórico das últimas rodadas.
    case 'auditoria': {
      const [ultima] = await db.select('sync_runs', 'dataset=eq.auditoria&status=neq.error&select=started_at,finished_at,status,details&order=started_at.desc&limit=1')
      const historico = await db.select('sync_runs', 'dataset=eq.auditoria&select=started_at,finished_at,status,error&order=started_at.desc&limit=10')
      return { ultima: ultima ?? null, historico }
    }

    // Por vendedora no período: vendido, devoluções e o que ela comprou como cliente.
    case 'vendedoras':
    case 'vendedora': {
      const fim = hojeBelem()
      const de = ISO.test(q.get('de') ?? '') ? q.get('de')! : fim.slice(0, 8) + '01'
      const ate = ISO.test(q.get('ate') ?? '') ? q.get('ate')! : fim
      if (de > ate) throw new DashError('A data inicial é depois da final.')
      try {
        if (path === 'vendedoras') {
          const e = q.get('empresa'), empresa = e && /^\d{1,6}$/.test(e) ? Number(e) : null
          try { return { de, ate, empresa, ...(await db.rpc<Record<string, unknown>>('vendedoras_painel', { p_de: de, p_ate: ate, p_empresa: empresa })) } }
          catch (e) {
            // Banco ainda com a versão anterior da função (sem filtro de loja): mostra o que ela tem.
            if (!(e instanceof SupabaseError && /PGRST202|vendedoras_painel/.test(e.message))) throw e
            const lista = await db.rpc<{ vendas: number; liquido: number; devolvido: number; devolucoes: number }[]>('vendedoras_resumo', { p_de: de, p_ate: ate })
            const s = (f: (x: typeof lista[number]) => number) => lista.reduce((a, x) => a + Math.round(Number(f(x)) * 100), 0) / 100
            const porVend = lista.reduce((a, x) => a + Number(x.vendas), 0)
            return { de, ate, empresa: null, vendedoras: lista, empresas: [], totais: { vendas: porVend, vendas_por_vendedora: porVend, vendas_por_vendedora_dia: porVend, liquido: s(x => x.liquido), devolvido: s(x => x.devolvido), devolucoes: s(x => x.devolucoes) } }
          }
        }
        const id = int(q.get('id'), -1, 0, 2_000_000_000)
        if (id < 0) throw new DashError('Vendedora inválida.')
        return { de, ate, ...(await db.rpc<Record<string, unknown>>('vendedora_detalhe', { p_id: id, p_de: de, p_ate: ate })) }
      } catch (e) {
        if (e instanceof SupabaseError && (e.status === 404 || /vendedora|PGRST202/.test(e.message))) throw new DashError('O painel de vendedoras ainda não foi instalado no banco (migração 20261124000000_auditoria_vendedoras.sql).')
        throw e
      }
    }

    // Relatório montado pelo usuário: a configuração vai inteira para a função relatorio(), que só aceita
    // fontes, agrupamentos, métricas e filtros de listas fechadas.
    case 'relatorio': {
      let p: Record<string, unknown>
      try { p = JSON.parse(q.get('p') ?? '{}') } catch { throw new DashError('Configuração do relatório inválida.') }
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new DashError('Configuração do relatório inválida.')
      for (const k of ['de', 'ate']) if (p[k] != null && !ISO.test(String(p[k]))) throw new DashError('Data inválida no relatório.')
      try {
        // Custo e lucro vêm do custo médio (frações de centavo): arredonda ao centavo, como o resto do relatório.
        const r = await db.rpc<{ linhas: Record<string, unknown>[]; totais: Record<string, unknown> }>('relatorio', { p })
        const cent = (o: Record<string, unknown>) => { for (const k of ['custo', 'lucro']) if (typeof o[k] === 'number') o[k] = Math.round((o[k] as number) * 100) / 100; return o }
        r.linhas.forEach(cent); if (r.totais) cent(r.totais)
        return r
      }
      catch (e) {
        if (e instanceof SupabaseError && /PGRST202|function public\.relatorio/.test(e.message)) throw new DashError('O módulo de relatórios ainda não foi instalado no banco (migração 20261127000000_relatorio.sql).')
        if (e instanceof SupabaseError && e.status < 500) throw new DashError(e.message.replace(/^Supabase \d+: /, ''))
        throw e
      }
    }

    case 'meses':
      return db.select('vw_meses_movimento', 'select=mes,documentos&order=mes.desc').catch(() => [])

    // ---------- Gestão do estoque ----------
    // Curva ABC: quantos itens e quanto do faturamento em cada classe, e a curva de Pareto resumida.
    case 'abc': {
      try {
        const rows = await db.selectAll<{ posicao: number; acumulado_pct: Num; participacao_pct: Num; faturamento: Num; classe: string; referencia: string }>('mv_produto_abc', 'select=posicao,acumulado_pct,participacao_pct,faturamento,classe,referencia&order=posicao.asc')
        const total = rows.length
        const classes = CLASSES.map(c => {
          const r = rows.filter(x => x.classe === c)
          return { classe: c, itens: r.length, itens_pct: total ? r.length * 100 / total : 0, faturamento: r.reduce((a, x) => a + n(x.faturamento), 0), faturamento_pct: r.reduce((a, x) => a + n(x.participacao_pct), 0) }
        })
        const curva = amostra(rows.map(r => ({ posicao: Number(r.posicao), itens_pct: total ? Number(r.posicao) * 100 / total : 0, acumulado_pct: n(r.acumulado_pct), classe: r.classe })))
        return { total, referencia: rows[0]?.referencia ?? null, classes, curva }
      } catch (e) { throw faltaGestao(e) }
    }

    // Qualidade do dado: lista de problemas por item, do item A de maior valor para baixo.
    case 'qualidade': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const prob = pick(q.get('problema'), PROBLEMAS), cls = pick(q.get('classe'), CLASSES), s = busca(q.get('busca'))
      const filtro = (prob ? `&problema=eq.${prob}` : '') + (cls ? `&classe=eq.${cls}` : '') + (s ? ilike('descricao', s) : '')
      const ord = pick(q.get('ordem'), ['valor', 'faturamento', 'estoque', 'descricao'])
      const ordem = ord ? `&order=${ord}.${q.get('dir') === 'asc' ? 'asc' : 'desc'}.nullslast` : '&order=classe.asc,valor.desc.nullslast,faturamento.desc'
      return db.selectPage('vw_qualidade_dados', `select=*${filtro}${ordem}`, limit, offset).catch(e => { throw faltaGestao(e) })
    }

    case 'qualidade-resumo': {
      const [problemas, carga] = await Promise.all([db.select('vw_qualidade_resumo', 'select=*').catch(e => { throw faltaGestao(e) }), cargaVendas(db)])
      return { problemas, carga }
    }

    // Sugestão de compra: itens no ponto de pedido ou abaixo, com último preço e fornecedor.
    case 'reposicao': {
      const limit = int(q.get('limit'), 50, 1, 200), offset = int(q.get('offset'), 0, 0, 1_000_000)
      const cls = pick(q.get('classe'), CLASSES), s = busca(q.get('busca'))
      const filtro = (q.get('todos') === '1' ? '' : '&sugestao_compra=gt.0') + (cls ? `&classe=eq.${cls}` : '') + (q.get('ruptura') === '1' ? '&em_ruptura=is.true' : '') + (s ? ilike('descricao', s) : '')
      const ord = pick(q.get('ordem'), ['valor_sugestao', 'sugestao_compra', 'venda_media_diaria', 'cobertura_dias', 'estoque', 'descricao'])
      const ordem = ord ? `&order=${ord}.${q.get('dir') === 'asc' ? 'asc' : 'desc'}.nullslast` : '&order=classe.asc,em_ruptura.desc,venda_media_diaria.desc'
      const [page, carga, cfg] = await Promise.all([
        db.selectPage<Record<string, unknown>>('vw_reposicao', `select=*${filtro}${ordem}`, limit, offset).catch(e => { throw faltaGestao(e) }),
        cargaVendas(db),
        db.select('cfg_reposicao', 'select=*&order=classe.asc').catch(() => []),
      ])
      return { ...page, rows: await comUltimaCompra(db, page.rows), carga, parametros: cfg }
    }

    // Contagem cíclica: lista do dia (A, depois B, depois C) e o que falta por classe.
    case 'contagem': {
      const limit = int(q.get('limit'), 85, 1, 300), s = busca(q.get('busca')), cls = pick(q.get('classe'), CLASSES)
      // Só dígitos (leitor de código de barras): procura pelo EAN exato; senão, pela descrição.
      const filtro = (cls ? `&classe=eq.${cls}` : '') + (/^\d{6,14}$/.test(s) ? `&codigobarras=eq.${s}` : s ? ilike('descricao', s) : '')
      try {
        const [lista, resumo] = await Promise.all([
          db.select('vw_contagem_pendente', `select=*${filtro}&order=prioridade.asc,posicao.asc,valor_estoque.desc.nullslast&limit=${limit}`),
          db.select<{ classe: string; pendentes: Num }>('vw_contagem_resumo', 'select=classe,pendentes'),
        ])
        const qtd = (k: string) => n(resumo.find(r => r.classe === k)?.pendentes ?? 0)
        const a = qtd('A'), b = qtd('B'), c = qtd('C')
        return { lista, pendentes: { A: a, B: b, C: c }, por_dia: { A: Math.ceil(a / 22), B: Math.ceil(b / 66), C: Math.ceil(c / 264) } }
      } catch (e) { throw faltaGestao(e) }
    }

    // Conciliação: acurácia por mês e classe e as últimas contagens com a diferença para o sistema.
    case 'conciliacao': {
      try {
        const [acuracia, ultimas] = await Promise.all([
          db.select('vw_contagem_acuracia', 'select=*&order=mes.desc,classe.asc&limit=36'),
          db.select<Record<string, Num>>('cnt_contagem', 'select=*&order=contado_em.desc&limit=50'),
        ])
        const ids = [...new Set(ultimas.map(u => Number(u.idmercadoriavariacao)).filter(Number.isSafeInteger))]
        const nomes = ids.length ? await db.select<{ idmercadoriavariacao: number; descricao: string | null }>('vw_produto_desempenho', `idmercadoriavariacao=in.(${ids.join(',')})&select=idmercadoriavariacao,descricao`) : []
        const nome = new Map(nomes.map(x => [Number(x.idmercadoriavariacao), x.descricao]))
        return { acuracia, ultimas: ultimas.map(u => ({ ...u, descricao: nome.get(Number(u.idmercadoriavariacao)) ?? null, diferenca: n(u.qtd_contada) - n(u.qtd_sistema) })) }
      } catch (e) { throw faltaGestao(e) }
    }

    // Relatório de custo-serviço: um mês por linha.
    case 'custo-servico':
      return db.select('vw_custo_servico_mensal', 'select=*&order=mes.desc&limit=24').catch(e => { throw faltaGestao(e) })

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

/** A classificação dos produtos é pronta (mv_produto_classe): refaz na hora para a regra salva valer já. */
async function atualizarClasse(db: Supabase) {
  await db.rpc('atualizar_classe', {}).catch(e => { if (!(e instanceof SupabaseError && /atualizar_classe|PGRST202/.test(e.message))) throw e })
}

/** Cria, altera ou remove ({"prefixo", "setor": null}) uma regra de setor por prefixo de NCM. */
export async function salvarRegraNcm(db: Supabase, body: Record<string, unknown>) {
  const p = typeof body.prefixo === 'string' ? body.prefixo.replace(/\D/g, '') : ''
  if (!/^\d{2,8}$/.test(p)) throw new DashError('"prefixo" precisa ter de 2 a 8 dígitos do NCM.')
  if (body.setor === null) await db.deleteWhere('cfg_ncm_setor', `prefixo=eq.${p}`)
  else {
    if (typeof body.setor !== 'string' || !SETORES.includes(body.setor)) throw new DashError(`"setor" precisa ser um de: ${SETORES.join(', ')} (ou null).`)
    await db.upsert('cfg_ncm_setor', [{ prefixo: p, setor: body.setor }], 'prefixo')
  }
  await atualizarClasse(db)
  return { ok: true }
}

/** Classifica uma seção do ERP num setor (ou remove a classificação). */
export async function salvarSecao(db: Supabase, body: Record<string, unknown>) {
  const id = body.idsecao
  if (!Number.isSafeInteger(id)) throw new DashError('"idsecao" inválido.')
  if (body.setor === null) await db.deleteWhere('cfg_secao_setor', `idsecao=eq.${id}`)
  else {
    if (typeof body.setor !== 'string' || !SETORES.includes(body.setor)) throw new DashError(`"setor" precisa ser um de: ${SETORES.join(', ')} (ou null).`)
    await db.upsert('cfg_secao_setor', [{ idsecao: id, setor: body.setor }], 'idsecao')
  }
  await atualizarClasse(db)
  return { ok: true }
}

/** Registra uma contagem física. O saldo do sistema e o custo são lidos aqui, no momento da contagem. */
export async function salvarContagem(db: Supabase, body: Record<string, unknown>, quem: string) {
  const id = body.idmercadoriavariacao
  if (!Number.isSafeInteger(id) || (id as number) <= 0) throw new DashError('"idmercadoriavariacao" inválido.')
  const qtd = typeof body.qtd_contada === 'number' ? body.qtd_contada : Number(body.qtd_contada)
  if (!Number.isFinite(qtd) || qtd < 0 || qtd > 1_000_000) throw new DashError('"qtd_contada" precisa ser um número de 0 a 1.000.000.')
  const motivo = body.motivo === undefined || body.motivo === null || body.motivo === '' ? null : body.motivo
  if (motivo !== null && (typeof motivo !== 'string' || !MOTIVOS.includes(motivo))) throw new DashError(`"motivo" precisa ser um de: ${MOTIVOS.join(', ')}.`)
  const obs = typeof body.observacao === 'string' ? body.observacao.trim().slice(0, 300) : null
  const [item] = await db.select<{ estoque_atual: Num; custo_unitario: Num }>('vw_produto_desempenho', `idmercadoriavariacao=eq.${id}&select=estoque_atual,custo_unitario`)
  if (!item) throw new DashError('Item não encontrado.')
  const [abc] = await db.select<{ classe: string }>('mv_produto_abc', `idmercadoriavariacao=eq.${id}&select=classe`).catch(e => { throw faltaGestao(e) })
  const [salvo] = await db.insert<Record<string, unknown>>('cnt_contagem', {
    idmercadoriavariacao: id, qtd_contada: qtd, qtd_sistema: n(item.estoque_atual), custo_unitario: item.custo_unitario === null ? null : n(item.custo_unitario),
    classe: abc?.classe ?? 'C', motivo, observacao: obs || null, contado_por: quem.slice(0, 120),
  }).catch(e => { throw faltaGestao(e) })
  return { ok: true, contagem: salvo, diferenca: qtd - n(item.estoque_atual) }
}
