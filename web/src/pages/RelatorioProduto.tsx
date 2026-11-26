// Relatório do produto: a ficha completa de um ou mais itens (ou de uma amostra sorteada), com as seções
// escolhidas e um período, na tela e em Excel/PDF. Mesmos dados da ficha do item, mais as vendas por vendedora e
// cada venda (quem vendeu, para quem). Configuração na URL: ?modo=produto&itens=1,2&secoes=...&de=&ate=

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Dices, FileSpreadsheet, FileText, Play, Plus, X } from 'lucide-react'
import { api } from '../api'
import { baixarExcel, baixarPdf, textoCelula, type Coluna, type Secao } from '../exportar'
import { quando, type Mov, type RespLog } from '../LogMovimentos'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading } from '../ui'

// Partes da ficha (tipo mínimo do que /dash/produto devolve).
type Ficha = {
  item: { id: number; descricao: string; codigobarras: string | null; referencia: string | null; embalagem: string | null; marca: string | null; secao: string | null; grupo: string | null; setor: string | null; situacao: string | null; cadastro_alterado: string | null }
  numeros: Record<string, number | string | null>
  preco_compra: Record<string, unknown>[]; precos: Record<string, unknown>[]; estoque_locais: Record<string, unknown>[]
  lotes: Record<string, unknown>[]; entradas: Record<string, unknown>[]
  vendas_mes: Record<string, unknown>[]; historico_preco: Record<string, unknown>[]
  linha_do_tempo: { quando: string; tipo: string; titulo: string; detalhe?: string; valor?: number | null }[]
}
type Rel = { linhas: Record<string, unknown>[]; totais: Record<string, unknown> }

export const SECOES = [
  { id: 'cadastro', nome: 'Cadastro e números', datas: false },
  { id: 'estoque', nome: 'Estoque por local', datas: false },
  { id: 'lotes', nome: 'Lotes disponíveis', datas: false },
  { id: 'entradas', nome: 'Entradas (compras)', datas: true },
  { id: 'fornecedores', nome: 'Preço de compra por fornecedor', datas: false },
  { id: 'precos', nome: 'Preços de venda atuais', datas: false },
  { id: 'evolucao', nome: 'Evolução do preço de venda', datas: true },
  { id: 'vendas_mes', nome: 'Vendas mês a mês', datas: true },
  { id: 'vendedoras', nome: 'Vendas por vendedora', datas: true },
  { id: 'vendas', nome: 'Cada venda (quem vendeu, para quem)', datas: true },
  { id: 'log', nome: 'Log de movimentações', datas: true },
  { id: 'tempo', nome: 'Linha do tempo', datas: true },
] as const
type IdSecao = typeof SECOES[number]['id']

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())
const menosDias = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd - d)).toISOString().slice(0, 10) }
const dia = (v: unknown) => String(v ?? '').slice(0, 10)
const noPeriodo = (v: unknown, de: string, ate: string) => { const d = dia(v); return !d || (d >= de && d <= ate) }
const SIT: Record<string, string> = { sem_saida_historica: 'Sem saída', parado: 'Parado', baixa_movimentacao: 'Baixa movimentação', excesso_estoque: 'Excesso de estoque', ruptura: 'Ruptura', saudavel: 'Saudável', sem_movimento: 'Sem movimento' }

/** Monta as seções escolhidas de um item (tudo em formato de tabela, igual para tela, Excel e PDF). */
async function montarItem(id: number, secoes: IdSecao[], de: string, ate: string): Promise<{ titulo: string; secoes: Secao[] }> {
  const quer = (s: IdSecao) => secoes.includes(s)
  const rel = (p: Record<string, unknown>) => api<Rel>(`dash/relatorio?p=${encodeURIComponent(JSON.stringify({ fonte: 'vendas', de, ate, filtros: { produto: String(id) }, limite: 5000, ...p }))}`)
  const [f, porVend, cadaVenda, log] = await Promise.all([
    api<Ficha>(`dash/produto?id=${id}`),
    quer('vendedoras') ? rel({ grupos: ['vendedora'], metricas: ['documentos', 'qtd', 'bruto', 'desconto', 'liquido', 'lucro', 'margem'], ordem: 'liquido' }) : null,
    quer('vendas') ? rel({ grupos: ['documento', 'cliente', 'vendedora'], metricas: ['qtd', 'liquido', 'lucro'] }) : null,
    quer('log') ? api<RespLog>(`dash/log?variacao=${id}&de=${de}&ate=${ate}&limit=500`) : null,
  ])
  const n = f.numeros, it = f.item
  const out: Secao[] = []
  const t = (chave: string, titulo: string, tipo: Coluna['tipo'] = 'texto'): Coluna => ({ chave, titulo, tipo })
  if (quer('cadastro')) {
    out.push({ nome: 'Cadastro e números', cartoes: true, colunas: [t('indicador', 'Indicador'), t('valor', 'Valor'), t('detalhe', 'Detalhe')], linhas: [
      { indicador: 'Estoque', valor: `${textoCelula(n.estoque, 'numero')} un.`, detalhe: `${textoCelula(n.valor_estoque, 'moeda')} a custo` },
      { indicador: 'Preço de venda', valor: textoCelula(n.preco_venda, 'moeda'), detalhe: n.margem_pct !== null ? `margem ${textoCelula(n.margem_pct, 'pct')}` : '' },
      { indicador: 'Último preço de compra', valor: textoCelula(n.ultimo_preco_compra, 'moeda'), detalhe: [n.ultimo_fornecedor, n.ultima_compra_data ? textoCelula(n.ultima_compra_data, 'data') : null].filter(Boolean).join(' · ') },
      { indicador: 'Vendido em 90 dias', valor: `${textoCelula(n.qtd_90d, 'numero')} un.`, detalhe: `${textoCelula(n.faturamento_90d, 'moeda')} · margem ${textoCelula(n.margem_90d_pct, 'pct')}` },
    ] })
    out.push({ nome: 'Cadastro', colunas: [t('campo', 'Campo'), t('valor', 'Valor')], linhas: [
      ['Código', it.id], ['Descrição', it.descricao], ['Código de barras', it.codigobarras], ['Referência', it.referencia], ['Marca', it.marca], ['Embalagem', it.embalagem],
      ['Seção', it.secao], ['Grupo', it.grupo], ['Setor', it.setor], ['Situação', it.situacao ? SIT[it.situacao] ?? it.situacao : null], ['Cadastro alterado em', it.cadastro_alterado ? textoCelula(it.cadastro_alterado, 'data') : null],
      ['Custo unitário', textoCelula(n.custo, 'moeda')], ['Markup', textoCelula(n.markup_pct, 'pct')], ['Cobertura do estoque', n.cobertura_dias !== null ? `${textoCelula(n.cobertura_dias, 'inteiro')} dias` : null],
      ['Dias sem vender', textoCelula(n.dias_sem_venda, 'inteiro')], ['Primeira entrada', textoCelula(n.primeira_entrada, 'data')], ['Última entrada', textoCelula(n.ultima_entrada, 'data')],
      ['Primeira venda', textoCelula(n.primeira_venda, 'data')], ['Última venda', textoCelula(n.ultima_venda, 'data')],
      ['Total comprado (histórico)', `${textoCelula(n.qtd_comprada, 'numero')} un. · ${textoCelula(n.total_comprado, 'moeda')} em ${textoCelula(n.entradas, 'inteiro')} entradas`],
      ['Custo médio das compras', textoCelula(n.custo_medio_compras, 'moeda')],
    ].map(([campo, valor]) => ({ campo, valor: valor ?? '—' })) })
  }
  if (quer('estoque')) out.push({ nome: 'Estoque por local', colunas: [t('local', 'Local'), t('qtd', 'Saldo', 'numero'), t('reservado', 'Reservado', 'numero'), t('atualizado', 'Atualizado em', 'data')], linhas: f.estoque_locais })
  if (quer('lotes')) out.push({ nome: 'Lotes disponíveis', colunas: [t('lote', 'Lote'), t('dtentrada', 'Entrada', 'data'), t('dtvalidade', 'Validade', 'data'), t('dias_para_vencer', 'Dias p/ vencer', 'inteiro'), t('qtdsaldo', 'Disponível', 'numero'), t('qtd_lote', 'No lote', 'numero'), t('valor', 'Valor (custo)', 'moeda')],
    linhas: f.lotes.filter(l => Number(l.qtdsaldo) > 0).sort((a, b) => Number(a.dias_para_vencer) - Number(b.dias_para_vencer)) })
  if (quer('entradas')) {
    const linhas = f.entradas.filter(e => noPeriodo(e.data, de, ate))
    out.push({ nome: 'Entradas (compras)', colunas: [t('data', 'Data', 'data'), t('fornecedor', 'Fornecedor'), t('natureza', 'Operação'), t('unidades', 'Unidades', 'numero'), t('preco_unidade', 'Preço por unidade', 'moeda'), t('total', 'Total', 'moeda'), t('lote', 'Lote'), t('dtvalidade', 'Validade', 'data')], linhas,
      totais: { unidades: linhas.reduce((a, e) => a + Number(e.unidades ?? 0), 0), total: linhas.reduce((a, e) => a + Math.round(Number(e.total ?? 0) * 100), 0) / 100 } })
  }
  if (quer('fornecedores')) out.push({ nome: 'Preço de compra por fornecedor', colunas: [t('fornecedor', 'Fornecedor'), t('compras', 'Compras', 'inteiro'), t('unidades', 'Unidades', 'numero'), t('ultimo_preco', 'Último preço', 'moeda'), t('penultimo_preco', 'Anterior', 'moeda'), t('variacao_pct', 'Variação', 'pct'), t('menor_preco', 'Menor', 'moeda'), t('maior_preco', 'Maior', 'moeda'), t('preco_medio', 'Médio', 'moeda'), t('ultima_compra', 'Última compra', 'data')], linhas: f.preco_compra })
  if (quer('precos')) out.push({ nome: 'Preços de venda atuais', colunas: [t('tabela', 'Tabela', 'inteiro'), t('preco', 'Preço', 'moeda'), t('custo', 'Custo na tabela', 'moeda'), t('alterado', 'Alterado em', 'data')], linhas: f.precos.filter(p => p.ativo !== false) })
  if (quer('evolucao')) out.push({ nome: 'Evolução do preço de venda', colunas: [t('datahora', 'Data', 'data'), t('tabela', 'Tabela', 'inteiro'), t('de', 'De', 'moeda'), t('para', 'Para', 'moeda'), t('variacao_pct', 'Variação', 'pct')],
    linhas: f.historico_preco.filter(h => noPeriodo(h.datahora, de, ate)) })
  if (quer('vendas_mes')) {
    const linhas = f.vendas_mes.filter(v => noPeriodo(`${v.mes}-01`, de.slice(0, 8) + '01', ate)).map(v => ({ ...v, mes: String(v.mes).slice(0, 7) }) as Record<string, unknown>)
    out.push({ nome: 'Vendas mês a mês', colunas: [t('mes', 'Mês'), t('vendas', 'Vendas', 'inteiro'), t('qtd', 'Unidades', 'numero'), t('faturamento', 'Faturamento', 'moeda'), t('lucro', 'Lucro', 'moeda')], linhas,
      totais: { vendas: linhas.reduce((a, v) => a + Number(v.vendas ?? 0), 0), qtd: linhas.reduce((a, v) => a + Number(v.qtd ?? 0), 0), faturamento: linhas.reduce((a, v) => a + Math.round(Number(v.faturamento ?? 0) * 100), 0) / 100, lucro: linhas.reduce((a, v) => a + Math.round(Number(v.lucro ?? 0) * 100), 0) / 100 } })
  }
  if (porVend) out.push({ nome: 'Vendas por vendedora', colunas: [t('vendedora', 'Vendedora'), t('documentos', 'Vendas', 'inteiro'), t('qtd', 'Unidades', 'numero'), t('bruto', 'Bruto', 'moeda'), t('desconto', 'Desconto', 'moeda'), t('liquido', 'Líquido', 'moeda'), t('lucro', 'Lucro', 'moeda'), t('margem', 'Margem', 'pct')], linhas: porVend.linhas, totais: porVend.totais })
  if (cadaVenda) {
    const linhas = [...cadaVenda.linhas].sort((a, b) => dia(b.data_documento).localeCompare(dia(a.data_documento)))
    out.push({ nome: 'Cada venda', colunas: [t('data_documento', 'Data', 'data'), t('documento', 'Documento'), t('cliente', 'Cliente'), t('vendedora', 'Vendedora'), t('qtd', 'Unidades', 'numero'), t('liquido', 'Valor', 'moeda'), t('lucro', 'Lucro', 'moeda')], linhas, totais: cadaVenda.totais })
  }
  if (log) out.push({ nome: 'Log de movimentações', colunas: [t('data', 'Data', 'data'), t('hora', 'Hora'), t('operacao', 'Operação'), t('documento', 'Documento'), t('quantidade', 'Qtd', 'numero'), t('saldo', 'Saldo antes → depois'), t('valor', 'Valor', 'moeda'), t('usuario', 'Quem lançou'), t('vendedora', 'Vendedora')],
    linhas: log.linhas.map((m: Mov) => ({ data: dia(m.datahora), hora: quando(m.datahora).hora, operacao: m.operacao + (m.cancelado ? ' (cancelado)' : ''), documento: m.documento ?? '', quantidade: m.origem === 'preco' ? null : m.quantidade,
      saldo: m.origem === 'preco' ? `${textoCelula(m.antes, 'moeda')} → ${textoCelula(m.depois, 'moeda')}` : `${textoCelula(m.antes, 'numero')} → ${textoCelula(m.depois, 'numero')}`, valor: m.valor, usuario: m.usuario ?? '', vendedora: m.vendedora ?? '' })) })
  if (quer('tempo')) out.push({ nome: 'Linha do tempo', colunas: [t('quando', 'Data', 'data'), t('titulo', 'Evento'), t('detalhe', 'Detalhe'), t('valor', 'Valor', 'moeda')],
    linhas: f.linha_do_tempo.filter(e => noPeriodo(e.quando, de, '9999-12-31') && dia(e.quando) <= ate) })
  return { titulo: `${it.id} · ${it.descricao}`, secoes: out }
}

function Tabela({ s }: { s: Secao }) {
  if (s.cartoes) return (
    <div className="metrics compact">{s.linhas.map((c, i) => <div key={i} className="metric"><span className="metric-label">{String(c.indicador)}</span><strong className="metric-value">{String(c.valor)}</strong>{c.detalhe ? <span className="metric-detail">{String(c.detalhe)}</span> : null}</div>)}</div>
  )
  if (!s.linhas.length) return <p className="hint">Nada no período.</p>
  const num = (c: Coluna) => c.tipo !== 'texto' && c.tipo !== 'data'
  return (
    <div className="table-wrap cards-sm"><table>
      <caption className="sr-only">{s.nome}</caption>
      <thead><tr>{s.colunas.map(c => <th key={c.chave} className={num(c) ? 'r' : ''}>{c.titulo}</th>)}</tr></thead>
      <tbody>{s.linhas.map((l, i) => <tr key={i}>{s.colunas.map(c => <td key={c.chave} data-label={c.titulo} className={num(c) ? 'r' : 'wrap-texto'}>{textoCelula(l[c.chave], c.tipo)}</td>)}</tr>)}</tbody>
      {s.totais && <tfoot><tr>{s.colunas.map((c, i) => <td key={c.chave} className={num(c) ? 'r' : ''}>{s.totais![c.chave] !== undefined ? textoCelula(s.totais![c.chave], c.tipo) : i === 0 ? <b>Total</b> : ''}</td>)}</tr></tfoot>}
    </table></div>
  )
}

type Achado = { idmercadoriavariacao: number; descricao: string | null }

export default function RelatorioProduto() {
  const [sp, setSp] = useSearchParams()
  const set = (k: Record<string, string | null>) => setSp(prev => { const n = new URLSearchParams(prev); for (const [a, b] of Object.entries(k)) b === null || b === '' ? n.delete(a) : n.set(a, b); return n }, { replace: true })
  const itens = (sp.get('itens') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 30)
  const secoes = ((sp.get('secoes') ?? SECOES.map(s => s.id).join(',')).split(',').filter(x => SECOES.some(s => s.id === x))) as IdSecao[]
  const de = sp.get('de') ?? menosDias(hoje(), 364), ate = sp.get('ate') ?? hoje()
  const [nomes, setNomes] = useState<Record<number, string>>({})
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [amostra, setAmostra] = useState({ n: '5', situacao: '', setor: '' })
  const [res, setRes] = useState<{ titulo: string; secoes: Secao[] }[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  useEffect(() => {
    const q = busca.trim(); if (q.length < 2) { setAchados([]); return }
    const t = setTimeout(() => { api<{ rows: Achado[] }>(`dash/produtos?busca=${encodeURIComponent(q)}&limit=8`).then(r => setAchados(r.rows)).catch(() => setAchados([])) }, 300)
    return () => clearTimeout(t)
  }, [busca])

  // Itens vindos de um link (ex.: botão Relatório da ficha): busca os nomes que faltam.
  useEffect(() => {
    const faltam = itens.filter(id => !nomes[id])
    if (!faltam.length) return
    Promise.all(faltam.map(id => api<{ rows: Achado[] }>(`dash/produtos?busca=${id}&limit=1`).then(r => r.rows.find(x => Number(x.idmercadoriavariacao) === id)).catch(() => undefined)))
      .then(rs => setNomes(n => ({ ...n, ...Object.fromEntries(rs.filter(Boolean).map(x => [x!.idmercadoriavariacao, x!.descricao ?? ''])) })))
  }, [itens.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const adicionar = (a: Achado[]) => {
    setNomes(n => ({ ...n, ...Object.fromEntries(a.map(x => [x.idmercadoriavariacao, x.descricao ?? `Item ${x.idmercadoriavariacao}`])) }))
    set({ itens: [...new Set([...itens, ...a.map(x => x.idmercadoriavariacao)])].slice(0, 30).join(',') })
    setBusca(''); setAchados([]); setRes(null)
  }
  const [sorteando, setSorteando] = useState(false)
  const sortear = async () => {
    setErro(null); setSorteando(true)
    try {
      const qs = new URLSearchParams({ n: amostra.n }); if (amostra.situacao) qs.set('situacao', amostra.situacao); if (amostra.setor) qs.set('setor', amostra.setor)
      const r = await api<Achado[]>(`dash/produtos-amostra?${qs}`)
      if (!r.length) setErro('Nenhum produto com esse filtro para sortear.'); else adicionar(r)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setSorteando(false) }
  }
  const gerar = async () => {
    if (!itens.length) { setErro('Escolha pelo menos um produto.'); return }
    setGerando(true); setErro(null)
    try { setRes(await Promise.all(itens.map(id => montarItem(id, secoes, de, ate)))) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setGerando(false) }
  }
  const periodo = `Período: ${textoCelula(de, 'data')} a ${textoCelula(ate, 'data')}`
  const baixar = (tipo: 'xlsx' | 'pdf') => {
    if (!res) return
    const varios = res.length > 1
    const doc = {
      titulo: varios ? `Relatório de produtos (${res.length} itens)` : `Ficha do produto ${res[0].titulo}`,
      subtitulo: `${periodo} · Seções: ${SECOES.filter(s => secoes.includes(s.id)).map(s => s.nome).join(', ')}`,
      arquivo: varios ? `relatorio produtos ${hoje()}` : `ficha produto ${itens[0]} ${hoje()}`,
      secoes: res.flatMap(r => r.secoes.map(s => ({ ...s, nome: varios ? `${r.titulo.split(' · ')[0]} · ${s.nome}` : s.nome }))),
    }
    // No PDF com vários itens, o nome completo do produto abre a primeira seção de cada um.
    if (varios && tipo === 'pdf') doc.secoes = res.flatMap(r => r.secoes.map((s, i) => ({ ...s, nome: i === 0 ? `${r.titulo} — ${s.nome}` : s.nome })))
    return tipo === 'xlsx' ? baixarExcel(doc) : baixarPdf(doc)
  }
  const alternar = (id: IdSecao) => set({ secoes: (secoes.includes(id) ? secoes.filter(s => s !== id) : [...secoes, id]).join(',') || 'cadastro' })

  return (
    <>
      <div className="rel-grid">
        <fieldset className="aud-card rel-bloco">
          <legend>1. Produtos <small>(até 30)</small></legend>
          <div className="rel-filtros">
            <label>Buscar e adicionar
              <input className="input" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, código ou código de barras" />
            </label>
          </div>
          {achados.length > 0 && <ul className="plain rel-achados">{achados.map(a => <li key={a.idmercadoriavariacao}><button type="button" className="chip" onClick={() => adicionar([a])}><Plus size={13} aria-hidden /> <span className="cod">{a.idmercadoriavariacao}</span> {a.descricao}</button></li>)}</ul>}
          <div className="rel-amostra">
            <span className="rel-rotulo">Ou sortear uma amostra</span>
            <div className="rel-filtros">
              <label>Quantidade<select className="select" value={amostra.n} onChange={e => setAmostra(a => ({ ...a, n: e.target.value }))}>{['3', '5', '10', '20'].map(x => <option key={x}>{x}</option>)}</select></label>
              <label>Situação<select className="select" value={amostra.situacao} onChange={e => setAmostra(a => ({ ...a, situacao: e.target.value }))}><option value="">Qualquer</option>{Object.entries(SIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Setor<select className="select" value={amostra.setor} onChange={e => setAmostra(a => ({ ...a, setor: e.target.value }))}><option value="">Todos</option>{['Alimentação', 'Farmácia', 'Diversos', 'Não classificado'].map(s => <option key={s}>{s}</option>)}</select></label>
            </div>
            <button type="button" className="btn secondary" onClick={sortear} disabled={sorteando}><Dices size={16} aria-hidden />{sorteando ? 'Sorteando…' : 'Sortear amostra'}</button>
          </div>
          {itens.length > 0 && <div className="chips" style={{ marginTop: 12 }}>{itens.map(id => (
            <span key={id} className="chip-salvo"><span className="chip"><span className="cod">{id}</span> {nomes[id] ?? ''}</span>
              <button type="button" className="chip-x" onClick={() => { set({ itens: itens.filter(x => x !== id).join(',') }); setRes(null) }} aria-label={`Tirar o item ${id}`}><X size={13} aria-hidden /></button></span>))}
            <button type="button" className="ver-mais" onClick={() => { set({ itens: null }); setRes(null) }}>limpar</button></div>}
        </fieldset>
        <fieldset className="aud-card rel-bloco">
          <legend>2. O que mostrar</legend>
          <div className="rel-opcoes">{SECOES.map(s => <label key={s.id} className="rel-op"><input type="checkbox" checked={secoes.includes(s.id)} onChange={() => alternar(s.id)} />{s.nome}</label>)}</div>
          <div className="chips" style={{ marginTop: 10 }}>
            <button type="button" className="chip" onClick={() => set({ secoes: SECOES.map(s => s.id).join(',') })}>Ficha completa</button>
            <button type="button" className="chip" onClick={() => set({ secoes: 'cadastro,evolucao,precos,fornecedores' })}>Só preços</button>
            <button type="button" className="chip" onClick={() => set({ secoes: 'cadastro,entradas,vendas_mes,vendedoras,vendas' })}>Compra e venda</button>
            <button type="button" className="chip" onClick={() => set({ secoes: 'log,tempo' })}>Histórico</button>
            <button type="button" className="chip" onClick={() => set({ secoes: 'vendedoras,vendas' })}>Quem vendeu</button>
          </div>
        </fieldset>
        <fieldset className="aud-card rel-bloco">
          <legend>3. Período <small>(entradas, preços, vendas, log e linha do tempo)</small></legend>
          <div className="rel-linha">
            <label className="field-inline">De <input className="input" type="date" value={de} max={ate} onChange={e => e.target.value && set({ de: e.target.value })} /></label>
            <label className="field-inline">até <input className="input" type="date" value={ate} min={de} onChange={e => e.target.value && set({ ate: e.target.value })} /></label>
            <div className="chips">
              <button type="button" className="chip" onClick={() => set({ de: menosDias(hoje(), 29), ate: hoje() })}>30 dias</button>
              <button type="button" className="chip" onClick={() => set({ de: menosDias(hoje(), 89), ate: hoje() })}>90 dias</button>
              <button type="button" className="chip" onClick={() => set({ de: menosDias(hoje(), 364), ate: hoje() })}>12 meses</button>
              <button type="button" className="chip" onClick={() => set({ de: '2000-01-01', ate: hoje() })}>Tudo</button>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="rel-acoes">
        <button type="button" className="btn" onClick={gerar} disabled={gerando || !itens.length}><Play size={16} aria-hidden />{gerando ? 'Gerando…' : 'Gerar relatório do produto'}</button>
        {res && <>
          <button type="button" className="btn secondary" onClick={() => baixar('xlsx')}><FileSpreadsheet size={16} aria-hidden />Baixar Excel</button>
          <button type="button" className="btn secondary" onClick={() => baixar('pdf')}><FileText size={16} aria-hidden />Baixar PDF</button>
        </>}
      </div>
      {erro && <ErrorState message={erro} />}
      {gerando && !res ? <Loading rows={6} /> : !res ? (itens.length ? null : <Empty>Escolha um ou mais produtos (ou sorteie uma amostra), marque o que quer ver e clique em Gerar.</Empty>) : res.map(r => (
        <section key={r.titulo} className="rel-item">
          <h2><ItemLink id={Number(r.titulo.split(' · ')[0])}>{r.titulo.split(' · ').slice(1).join(' · ')}</ItemLink></h2>
          <p className="hint">{periodo}</p>
          {r.secoes.map(s => <div key={s.nome} className="rel-secao"><h3>{s.nome}</h3><Tabela s={s} /></div>)}
        </section>
      ))}
    </>
  )
}
