// Cálculos do Mix e demanda (no navegador, a partir das vendas mês a mês de cada produto).

export type ItemMes = { id: number; nome: string; fornecedor: string; idfornecedor: number; qtd: number[]; valor: number[]; clientes: number[]; vendas: number[]; dez_qtd: number; dez_valor: number }
export type RespMix = { ano: number; setor: string | null; meses_com_dados: number; mes_em_andamento: number | null; itens: ItemMes[] }
type Tupla = [number, string, number, number[], number[], number[], number, number]
export type RespMixBruta = Omit<RespMix, 'itens'> & { fornecedores: string[]; itens: Tupla[] }

/** O servidor manda cada item como tupla (resposta menor); aqui vira objeto, com 12 meses. */
export function decodificar(r: RespMixBruta): RespMix {
  const doze = (a: number[]) => [...a, ...Array(Math.max(0, 12 - a.length)).fill(0)]
  return { ...r, itens: r.itens.map(([id, nome, f, qtd, valor, clientes, dez_qtd, dez_valor]) => {
    const [idf, ...resto] = (r.fornecedores[f] ?? '0|').split('|')
    return { id, nome, idfornecedor: Number(idf), fornecedor: resto.join('|'), qtd: doze(qtd), valor: doze(valor), clientes: doze(clientes), vendas: Array(12).fill(0), dez_qtd, dez_valor }
  }) }
}

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/** Variação % de um mês contra o anterior (null quando o anterior é zero). */
export const variacao = (atual: number, anterior: number) => (anterior > 0 ? ((atual - anterior) / anterior) * 100 : null)

export type Categoria = 'alta' | 'queda' | 'estavel' | 'irregular' | 'novo' | 'parou'
export const CATEGORIAS: Record<Categoria, { nome: string; cls: string; desc: string }> = {
  alta: { nome: 'Em alta', cls: 'good', desc: 'Os últimos 3 meses venderam 20% ou mais acima dos 3 anteriores.' },
  queda: { nome: 'Em queda', cls: 'bad', desc: 'Os últimos 3 meses venderam 20% ou mais abaixo dos 3 anteriores.' },
  estavel: { nome: 'Estável', cls: 'info', desc: 'Vende todo mês, sem grande variação.' },
  irregular: { nome: 'Irregular / sazonal', cls: 'warn', desc: 'Vende em menos da metade dos meses: procura concentrada em algumas épocas.' },
  novo: { nome: 'Novo', cls: 'info', desc: 'Começou a vender nos últimos 3 meses.' },
  parou: { nome: 'Parou de vender', cls: 'bad', desc: 'Vendia em 3 ou mais meses do ano, mas não vendeu nada nos últimos 3 meses.' },
}

export type Diagnostico = {
  total: number; valor: number; media: number; mesesComVenda: number; melhorMes: number; melhorQtd: number; recordeRecente: boolean
  tendencia: number | null; categoria: Categoria; clientes: number; ultimoVsAnterior: number | null
}

/** meses = meses com dados; completos = meses fechados (o mês em andamento fica fora da tendência). */
export function diagnosticar(it: ItemMes, meses: number, completos: number): Diagnostico {
  const q = it.qtd.slice(0, meses)
  const total = q.reduce((a, x) => a + x, 0)
  const valor = it.valor.slice(0, meses).reduce((a, x) => a + x, 0)
  const fechados = it.qtd.slice(0, completos)
  const mesesComVenda = fechados.filter(x => x > 0).length
  let melhorMes = 0
  q.forEach((x, i) => { if (x > q[melhorMes]) melhorMes = i })
  const melhorQtd = q[melhorMes] ?? 0
  const recordeRecente = melhorQtd > 0 && melhorMes >= completos - 1 && q.slice(0, melhorMes).every(x => x < melhorQtd)
  const ult3 = fechados.slice(-3), ant3 = fechados.slice(-6, -3)
  const m3 = ult3.length ? ult3.reduce((a, x) => a + x, 0) / ult3.length : 0
  const a3 = ant3.length ? ant3.reduce((a, x) => a + x, 0) / ant3.length : 0
  const tendencia = ant3.length && a3 > 0 ? ((m3 - a3) / a3) * 100 : null
  const primeiro = fechados.findIndex(x => x > 0)
  let categoria: Categoria
  if (primeiro >= 0 && primeiro >= completos - 3 && it.dez_qtd === 0) categoria = 'novo'
  else if (mesesComVenda >= 3 && ult3.every(x => x === 0)) categoria = 'parou' // vendia com regularidade e sumiu
  else if (completos >= 4 && mesesComVenda / completos < 0.5) categoria = 'irregular'
  else if (tendencia !== null && tendencia >= 20) categoria = 'alta'
  else if (tendencia !== null && tendencia <= -20) categoria = 'queda'
  else categoria = 'estavel'
  const ultimo = completos - 1
  return {
    total, valor, media: completos ? fechados.reduce((a, x) => a + x, 0) / completos : 0, mesesComVenda, melhorMes, melhorQtd, recordeRecente,
    tendencia, categoria, clientes: it.clientes.slice(0, meses).reduce((a, x) => a + x, 0),
    ultimoVsAnterior: ultimo >= 1 ? variacao(it.qtd[ultimo], it.qtd[ultimo - 1]) : ultimo === 0 ? variacao(it.qtd[0], it.dez_qtd) : null,
  }
}

// ---------- Linhas de produto e embalagens ----------

/** Tamanho da embalagem em gramas ou mililitros, lido da descrição ("10,1KG", "500G", "2L"). */
export function tamanho(desc: string): { valor: number; unidade: 'g' | 'ml'; texto: string } | null {
  const re = /(\d+(?:[.,]\d+)?)\s*(KG|K|GR|G|ML|LT|L)\b/gi
  let m: RegExpExecArray | null, ultimo: RegExpExecArray | null = null
  while ((m = re.exec(desc))) ultimo = m
  if (!ultimo) return null
  const n = Number(ultimo[1].replace(',', '.')), u = ultimo[2].toUpperCase()
  if (!isFinite(n) || n <= 0) return null
  const valor = u === 'KG' || u === 'K' ? n * 1000 : u === 'L' || u === 'LT' ? n * 1000 : n
  return { valor, unidade: u === 'ML' || u === 'L' || u === 'LT' ? 'ml' : 'g', texto: ultimo[0].replace(/\s+/g, '') }
}
/** Linha do produto: a descrição sem o tamanho e sem a marca de avaria (B.O). */
export function linhaDe(desc: string) {
  const t = tamanho(desc)
  let s = desc.toUpperCase()
  if (t) { const i = s.lastIndexOf(t.texto.toUpperCase()); if (i >= 0) s = s.slice(0, i) + s.slice(i + t.texto.length) }
  return s.replace(/[-–]?\s*B\.?\s?O\.?\s*$/i, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export type Embalagem = { id: number; nome: string; tamanho: number; texto: string; antes: number; depois: number; partAntes: number; partDepois: number; precoKgAntes: number | null; precoKgDepois: number | null; mesesSemVendaRecentes: number }
export type Linha = { chave: string; nome: string; embalagens: Embalagem[]; kgAntes: number; kgDepois: number; variacaoDemanda: number | null; migracao: number; causas: string[] }

/**
 * Linhas com 2+ embalagens e a migração para embalagens menores: participação (em peso/volume) das menores
 * nos 3 últimos meses fechados contra os 3 anteriores. Causas prováveis: preço por kg da maior subiu, a maior
 * ficou meses sem vender (falta?), a demanda da linha inteira caiu, ou escolha dos clientes.
 */
export function linhasComMigracao(itens: ItemMes[], completos: number): Linha[] {
  if (completos < 6) return []
  const grupos = new Map<string, ItemMes[]>()
  for (const it of itens) { const t = tamanho(it.nome); if (!t) continue; const k = linhaDe(it.nome); if (k.length < 6) continue; grupos.set(k, [...(grupos.get(k) ?? []), it]) }
  const out: Linha[] = []
  for (const [chave, lista] of grupos) {
    const porTamanho = new Map<number, ItemMes[]>()
    for (const it of lista) { const t = tamanho(it.nome)!.valor; porTamanho.set(t, [...(porTamanho.get(t) ?? []), it]) }
    if (porTamanho.size < 2) continue
    const janela = (it: ItemMes, de: number, ate: number) => it.qtd.slice(de, ate).reduce((a, x) => a + x, 0)
    const valorJ = (it: ItemMes, de: number, ate: number) => it.valor.slice(de, ate).reduce((a, x) => a + x, 0)
    const embalagens: Embalagem[] = [...porTamanho.entries()].map(([tam, its]) => {
      const antes = its.reduce((a, it) => a + janela(it, completos - 6, completos - 3), 0), depois = its.reduce((a, it) => a + janela(it, completos - 3, completos), 0)
      const vAntes = its.reduce((a, it) => a + valorJ(it, completos - 6, completos - 3), 0), vDepois = its.reduce((a, it) => a + valorJ(it, completos - 3, completos), 0)
      const semVenda = Array.from({ length: 3 }, (_, i) => completos - 3 + i).filter(m => its.every(it => it.qtd[m] === 0)).length
      return { id: its[0].id, nome: its.map(i => i.nome).join(' / '), tamanho: tam, texto: tamanho(its[0].nome)!.texto, antes, depois, partAntes: 0, partDepois: 0,
        precoKgAntes: antes ? vAntes / (antes * tam / 1000) : null, precoKgDepois: depois ? vDepois / (depois * tam / 1000) : null, mesesSemVendaRecentes: semVenda }
    }).sort((a, b) => b.tamanho - a.tamanho)
    const kgAntes = embalagens.reduce((a, e) => a + e.antes * e.tamanho / 1000, 0), kgDepois = embalagens.reduce((a, e) => a + e.depois * e.tamanho / 1000, 0)
    if (kgAntes + kgDepois === 0) continue
    for (const e of embalagens) { e.partAntes = kgAntes ? (e.antes * e.tamanho / 1000) / kgAntes * 100 : 0; e.partDepois = kgDepois ? (e.depois * e.tamanho / 1000) / kgDepois * 100 : 0 }
    const maior = embalagens[0]
    // Volume pequeno demais para tirar conclusão (evita alarme por 1 ou 2 unidades).
    if (embalagens.reduce((a, e) => a + e.antes + e.depois, 0) < 12 || maior.antes < 5) continue
    const migracao = maior.partAntes - maior.partDepois // pontos que a maior perdeu
    const variacaoDemanda = kgAntes ? ((kgDepois - kgAntes) / kgAntes) * 100 : null
    const causas: string[] = []
    if (maior.precoKgAntes && maior.precoKgDepois && maior.precoKgDepois > maior.precoKgAntes * 1.08) causas.push(`Preço: o kg da embalagem ${maior.texto} subiu ${Math.round((maior.precoKgDepois / maior.precoKgAntes - 1) * 100)}%`)
    if (maior.mesesSemVendaRecentes > 0) causas.push(`Possível falta: a embalagem ${maior.texto} ficou ${maior.mesesSemVendaRecentes} ${maior.mesesSemVendaRecentes === 1 ? 'mês' : 'meses'} sem vender`)
    if (variacaoDemanda !== null && variacaoDemanda <= -20) causas.push(`Mercado: a linha inteira vendeu ${Math.abs(Math.round(variacaoDemanda))}% menos (em peso)`)
    if (!causas.length && migracao >= 10) causas.push('Escolha dos clientes: preço, estoque e demanda da linha estáveis')
    out.push({ chave, nome: chave, embalagens, kgAntes, kgDepois, variacaoDemanda, migracao, causas })
  }
  return out.sort((a, b) => b.migracao - a.migracao)
}
