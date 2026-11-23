// Ficha de um cliente: o que ele compra, com que ritmo, a compra típica do mês e sinais de que pode sair.
// Tudo calculado a partir dos itens vendidos a ele (vw_venda_item) e do RFM (vw_cliente_rfm).

import type { Supabase } from './supabase/client'

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const n0 = (v: unknown) => num(v) ?? 0
const DIA = 86_400_000
const dias = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10) + 'T00:00:00Z') - Date.parse(de.slice(0, 10) + 'T00:00:00Z')) / DIA)
const somaDias = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + n * DIA).toISOString().slice(0, 10)
const nomePessoa = (p?: Row) => p ? [p.nome, p.sobrenome].map(x => String(x ?? '').trim()).filter(Boolean).join(' ') || null : null
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
/** Itens de serviço (taxa, frete, entrega): não entram em lembretes nem na compra típica. */
const servico = (nome: string | null | undefined) => /^\s*(TAXA|FRETE)\b|ENTREGA|SERVI[CÇ]O/i.test(nome ?? '')
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function hojeBelem() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())
}
function localBelem(ts: string) {
  const d = new Date(ts)
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d)
  const g = (t: string) => f.find(p => p.type === t)?.value ?? ''
  return { hora: Number(g('hour')) % 24, dow: d.toLocaleDateString('en-US', { timeZone: 'America/Belem', weekday: 'short' }) }
}
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Data até a qual as vendas já foram copiadas do ERP (cursor da carga de itens). Antes dela, "atraso" não é confiável. */
export async function vendasCarregadasAte(db: Supabase): Promise<{ ate: string; completa: boolean }> {
  const hoje = hojeBelem()
  const [st] = await db.select<{ status: string; cursor: unknown[] | null }>('sync_state', 'dataset=eq.documento_mercadoria&select=status,cursor')
  const id = Array.isArray(st?.cursor) ? Number(st!.cursor[0]) : null
  if (!id || !Number.isSafeInteger(id)) return { ate: hoje, completa: true }
  const [d] = await db.select<{ datahora: string }>('erp_documento', `_iddocumento=eq.${id}&select=datahora`)
  const ate = d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date(d.datahora)) : hoje
  const completa = st?.status === 'ok' || ate >= somaDias(hoje, -2)
  return { ate: completa ? hoje : ate, completa }
}

export async function clienteDetalhe(id: number, db: Supabase) {
  const [rfm, pessoa, vendas, devolucoes, carga] = await Promise.all([
    db.select<Row>('vw_cliente_rfm', `idcliente=eq.${id}&select=*`),
    db.select<Row>('erp_pessoa', `_idpessoa=eq.${id}&select=nome,sobrenome,tipo,datacadastro,dataclientedesde,flaginativo`),
    db.selectAll<Row>('vw_venda_item', `idcliente=eq.${id}&select=iddocumento,datahora,data,idmercadoriavariacao,descricao,qtd,valtotalbruto,valdesconto,valtotalliquido,lucro_bruto,custo_unitario,idpessoafuncionario&order=datahora.asc`),
    db.select<Row>('vw_devolucao_item', `idcliente=eq.${id}&select=data,iddocumento,qtd,valtotalliquido`),
    vendasCarregadasAte(db),
  ])
  if (!pessoa[0] && !vendas.length) return null
  const ref = carga.ate // data de referência: hoje, ou até onde as vendas já chegaram

  // ---------- Compras (documentos) ----------
  type Compra = { iddocumento: number; data: string; datahora: string; valor: number; itens: number; desconto: number; vendedor: number | null }
  const compras = new Map<number, Compra>()
  for (const v of vendas) {
    const k = Number(v.iddocumento)
    const c = compras.get(k) ?? { iddocumento: k, data: String(v.data), datahora: String(v.datahora), valor: 0, itens: 0, desconto: 0, vendedor: num(v.idpessoafuncionario) }
    c.valor += n0(v.valtotalliquido); c.itens += n0(v.qtd); c.desconto += n0(v.valdesconto)
    compras.set(k, c)
  }
  const lista = [...compras.values()].sort((a, b) => a.datahora.localeCompare(b.datahora))
  const datas = [...new Set(lista.map(c => c.data))]

  // ---------- Itens: o que compra, quanto, e o ciclo de recompra de cada um ----------
  type Item = { id: number; nome: string | null; setor: string | null; qtd: number; valor: number; lucro: number; com_custo: number; datas: string[]; vezes: number }
  const itens = new Map<number, Item>()
  for (const v of vendas) {
    const k = Number(v.idmercadoriavariacao); if (!Number.isSafeInteger(k)) continue
    const it = itens.get(k) ?? { id: k, nome: (v.descricao as string) || null, setor: null, qtd: 0, valor: 0, lucro: 0, com_custo: 0, datas: [], vezes: 0 }
    it.qtd += n0(v.qtd); it.valor += n0(v.valtotalliquido)
    if (v.custo_unitario !== null && v.custo_unitario !== undefined) { it.lucro += n0(v.lucro_bruto); it.com_custo += n0(v.valtotalliquido) }
    if (!it.datas.includes(String(v.data))) it.datas.push(String(v.data))
    itens.set(k, it)
  }
  const ids = [...itens.keys()].sort((a, b) => itens.get(b)!.valor - itens.get(a)!.valor).slice(0, 150)
  const idsVend = [...new Set(lista.map(c => c.vendedor).filter((x): x is number => !!x && x > 0))]
  const [nomes, classes, vendedores] = await Promise.all([
    ids.length ? db.select<Row>('vw_variacao_nome', `idmercadoriavariacao=in.(${ids.join(',')})&select=idmercadoriavariacao,nome`) : [],
    ids.length ? db.select<Row>('vw_produto_classe', `idmercadoriavariacao=in.(${ids.join(',')})&select=idmercadoriavariacao,setor`).catch(() => []) : [],
    idsVend.length ? db.select<Row>('erp_pessoa', `_idpessoa=in.(${idsVend.join(',')})&select=_idpessoa,nome,sobrenome`) : [],
  ])
  for (const r of nomes) { const it = itens.get(Number(r.idmercadoriavariacao)); if (it && r.nome) it.nome = String(r.nome) }
  for (const r of classes) { const it = itens.get(Number(r.idmercadoriavariacao)); if (it) it.setor = (r.setor as string) ?? null }

  const itensOut = ids.map(k => {
    const it = itens.get(k)!
    const ds = [...it.datas].sort()
    const gaps = ds.slice(1).map((d, i) => dias(ds[i], d)).filter(g => g > 0)
    const intervalo = gaps.length ? Math.round(media(gaps)!) : null
    const ultima = ds[ds.length - 1]
    const semComprar = dias(ultima, ref)
    const proxima = intervalo ? somaDias(ultima, intervalo) : null
    // Recorrente: comprou 3+ vezes. Atrasado: passou do ciclo com folga; parou: passou de 2 ciclos.
    const status = !intervalo || ds.length < 3 ? 'eventual'
      : semComprar > Math.max(2 * intervalo, intervalo + 30) ? 'parou'
      : semComprar > intervalo + Math.max(3, Math.round(intervalo * 0.25)) ? 'atrasado' : 'em_dia'
    return {
      id: k, nome: it.nome, setor: it.setor, qtd: it.qtd, valor: it.valor, vezes: ds.length,
      margem_pct: it.com_custo > 0 ? it.lucro / it.com_custo * 100 : null,
      primeira: ds[0], ultima, dias_sem_comprar: semComprar, intervalo_dias: intervalo, proxima_prevista: proxima,
      qtd_por_compra: it.qtd / ds.length, status,
    }
  })

  // ---------- Mês a mês (12 meses até a referência) e compra típica do mês ----------
  const meses: { mes: string; valor: number; compras: number; itens: number; principal: { id: number; nome: string | null; valor: number } | null }[] = []
  const refMes = ref.slice(0, 7)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(refMes.slice(0, 4)), Number(refMes.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7)
    meses.push({ mes: d, valor: 0, compras: 0, itens: 0, principal: null })
  }
  const porMesItem = new Map<string, Map<number, number>>()
  for (const v of vendas) {
    const m = String(v.data).slice(0, 7)
    const mm = meses.find(x => x.mes === m); if (!mm) continue
    mm.valor += n0(v.valtotalliquido); mm.itens += n0(v.qtd)
    const pm = porMesItem.get(m) ?? new Map(); porMesItem.set(m, pm)
    pm.set(Number(v.idmercadoriavariacao), (pm.get(Number(v.idmercadoriavariacao)) ?? 0) + n0(v.valtotalliquido))
  }
  for (const c of lista) { const mm = meses.find(x => x.mes === c.data.slice(0, 7)); if (mm) mm.compras++ }
  for (const mm of meses) {
    const pm = porMesItem.get(mm.mes); if (!pm) continue
    const [topId, topVal] = [...pm.entries()].sort((a, b) => b[1] - a[1])[0]
    mm.principal = { id: topId, nome: itens.get(topId)?.nome ?? null, valor: topVal }
  }
  // Compra típica: itens presentes em pelo menos 40% dos meses em que o cliente comprou (e em 2+ meses).
  const mesesAtivos = new Set(vendas.map(v => String(v.data).slice(0, 7)))
  const presenca = new Map<number, { meses: Set<string>; qtd: number; valor: number }>()
  for (const v of vendas) {
    const k = Number(v.idmercadoriavariacao)
    const p = presenca.get(k) ?? { meses: new Set(), qtd: 0, valor: 0 }
    p.meses.add(String(v.data).slice(0, 7)); p.qtd += n0(v.qtd); p.valor += n0(v.valtotalliquido); presenca.set(k, p)
  }
  const cesta = [...presenca.entries()]
    .filter(([k, p]) => !servico(itens.get(k)?.nome) && p.meses.size >= 2 && p.meses.size / Math.max(1, mesesAtivos.size) >= 0.4)
    .map(([k, p]) => ({ id: k, nome: itens.get(k)?.nome ?? null, meses: p.meses.size, presenca_pct: p.meses.size / mesesAtivos.size * 100, qtd_mes: p.qtd / p.meses.size, valor_mes: p.valor / p.meses.size }))
    .sort((a, b) => b.valor_mes - a.valor_mes).slice(0, 10)

  // ---------- Métricas de retenção ----------
  const r = rfm[0]
  const total = lista.reduce((a, c) => a + c.valor, 0)
  const ultima = lista[lista.length - 1]?.data ?? null
  const primeira = lista[0]?.data ?? null
  const gapsCompra = datas.slice(1).map((d, i) => dias(datas[i], d)).filter(g => g > 0)
  const intervalo = gapsCompra.length ? Math.round(media(gapsCompra)!) : null
  const semComprar = ultima ? dias(ultima, ref) : null
  const noPeriodo = (de: string, ate: string) => lista.filter(c => c.data > de && c.data <= ate)
  const ult90 = noPeriodo(somaDias(ref, -90), ref), ant90 = noPeriodo(somaDias(ref, -180), somaDias(ref, -90))
  const somaV = (cs: Compra[]) => cs.reduce((a, c) => a + c.valor, 0)
  const ult6 = meses.slice(-6)
  const valorMensal = ult6.reduce((a, m) => a + m.valor, 0) / 6
  const lucro = vendas.reduce((a, v) => a + (v.custo_unitario !== null && v.custo_unitario !== undefined ? n0(v.lucro_bruto) : 0), 0)
  const comCusto = vendas.reduce((a, v) => a + (v.custo_unitario !== null && v.custo_unitario !== undefined ? n0(v.valtotalliquido) : 0), 0)
  const bruto = vendas.reduce((a, v) => a + n0(v.valtotalbruto), 0)
  const desconto = vendas.reduce((a, v) => a + n0(v.valdesconto), 0)
  const devolvido = devolucoes.reduce((a, d) => a + n0(d.valtotalliquido), 0)
  const setores = new Map<string, number>()
  for (const it of itensOut) setores.set(it.setor ?? 'Não classificado', (setores.get(it.setor ?? 'Não classificado') ?? 0) + it.valor)
  const contaVend = new Map<number, number>()
  for (const c of lista) if (c.vendedor) contaVend.set(c.vendedor, (contaVend.get(c.vendedor) ?? 0) + 1)
  const [vendTop] = [...contaVend.entries()].sort((a, b) => b[1] - a[1])
  const vendNome = vendTop ? nomePessoa(vendedores.find(v => Number(v._idpessoa) === vendTop[0])) ?? `Vendedor ${vendTop[0]}` : null
  const dow = new Array(7).fill(0), horas = new Array(24).fill(0)
  for (const c of lista) { const l = localBelem(c.datahora); dow[DOW_EN.indexOf(l.dow)]++; horas[l.hora]++ }
  const diaFav = lista.length ? DIAS_SEMANA[dow.indexOf(Math.max(...dow))] : null
  const horaFav = lista.length ? horas.indexOf(Math.max(...horas)) : null
  const atraso = semComprar !== null && intervalo ? semComprar - intervalo : null
  const risco = !ultima ? 'sem_compras'
    : semComprar! > 180 ? 'perdido'
    : intervalo && semComprar! > Math.max(2 * intervalo, 30) ? 'alto'
    : intervalo && semComprar! > intervalo + Math.max(5, intervalo * 0.25) ? 'medio' : 'baixo'

  // ---------- Sugestões ----------
  const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const sug: { tipo: string; texto: string; item?: number }[] = []
  if (risco === 'alto' || risco === 'medio') sug.push({ tipo: risco === 'alto' ? 'alta' : 'media', texto: `Costuma voltar a cada ${intervalo} dias e está há ${semComprar} sem comprar. Vale um contato agora${valorMensal > 0 ? `: são cerca de ${fmtR(valorMensal)} por mês em jogo` : ''}.` })
  if (risco === 'perdido') sug.push({ tipo: 'alta', texto: `Não compra há ${semComprar} dias. Campanha de reativação: um cupom ou lembrete do item que mais comprava.` })
  for (const it of itensOut.filter(i => i.status === 'atrasado' && !servico(i.nome)).slice(0, 3))
    sug.push({ tipo: 'media', item: it.id, texto: `Lembrar de ${it.nome ?? 'um item'}: compra a cada ${it.intervalo_dias} dias e a última foi há ${it.dias_sem_comprar}.` })
  for (const it of itensOut.filter(i => i.status === 'parou' && !servico(i.nome)).slice(0, 2))
    sug.push({ tipo: 'alta', item: it.id, texto: `Parou de comprar ${it.nome ?? 'um item'} (comprava a cada ${it.intervalo_dias} dias). Pode estar comprando em outro lugar: confirme preço e estoque.` })
  const vU = somaV(ult90), vA = somaV(ant90)
  if (vA > 0 && vU < vA * 0.8) sug.push({ tipo: 'media', texto: `Gastou ${Math.round((1 - vU / vA) * 100)}% menos nos últimos 90 dias do que nos 90 anteriores.` })
  const temSetor = (s: string) => (setores.get(s) ?? 0) > 0
  if (total > 0 && temSetor('Alimentação') && !temSetor('Farmácia')) sug.push({ tipo: 'info', texto: 'Compra alimentação e nunca comprou na farmácia: ofereça antipulgas, vermífugo ou vacinas.' })
  if (total > 0 && temSetor('Farmácia') && !temSetor('Alimentação')) sug.push({ tipo: 'info', texto: 'Compra na farmácia e nunca comprou ração aqui: ofereça a ração do pet.' })
  if (vendNome && vendTop![1] >= 3) sug.push({ tipo: 'info', texto: `Quem mais atende este cliente: ${vendNome} (${vendTop![1]} compras). É a melhor pessoa para o contato.` })

  return {
    referencia: { data: ref, vendas_completas: carga.completa },
    cliente: {
      id, nome: nomePessoa(pessoa[0]) ?? (r?.nome as string) ?? `Cliente ${id}`, tipo: pessoa[0]?.tipo ?? null,
      cadastro: pessoa[0]?.datacadastro ?? null, cliente_desde: pessoa[0]?.dataclientedesde ?? primeira, inativo_no_erp: pessoa[0]?.flaginativo === 'T',
      segmento: (r?.segmento as string) ?? null,
    },
    metricas: {
      total, compras: lista.length, ticket_medio: lista.length ? total / lista.length : null, primeira, ultima,
      dias_sem_comprar: semComprar, intervalo_dias: intervalo, atraso_dias: atraso, risco,
      proxima_prevista: ultima && intervalo ? somaDias(ultima, intervalo) : null,
      valor_mensal_6m: valorMensal, valor_90d: vU, valor_90d_anterior: vA, variacao_90d_pct: vA > 0 ? (vU / vA - 1) * 100 : null,
      ticket_90d: ult90.length ? vU / ult90.length : null, ticket_90d_anterior: ant90.length ? vA / ant90.length : null,
      margem_pct: comCusto > 0 ? lucro / comCusto * 100 : null, desconto_pct: bruto > 0 ? desconto / bruto * 100 : null, devolvido,
      itens_por_compra: lista.length ? lista.reduce((a, c) => a + c.itens, 0) / lista.length : null, produtos_diferentes: itens.size,
      dia_preferido: diaFav, hora_preferida: horaFav, vendedor_principal: vendNome,
      setores: [...setores.entries()].map(([setor, valor]) => ({ setor, valor, pct: total ? valor / total * 100 : 0 })).sort((a, b) => b.valor - a.valor),
    },
    itens: itensOut, cesta, meses,
    compras: lista.slice(-40).reverse().map(c => ({ ...c, vendedor: c.vendedor ? nomePessoa(vendedores.find(v => Number(v._idpessoa) === c.vendedor)) : null })),
    sugestoes: sug,
  }
}
