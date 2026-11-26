// Relatórios montados pelo usuário: escolhe a fonte, o período, como agrupar, o que somar, os filtros e a
// ordem; gera na tela e baixa em Excel ou PDF. A configuração fica na URL (dá para mandar o link) e pode ser
// salva como modelo neste navegador.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, FileText, Play, Save, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { baixarExcel, baixarPdf, textoCelula, type Coluna, type Tipo } from '../exportar'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, PageHead, Tabs } from '../ui'
import RelatorioProduto from './RelatorioProduto'

type Fonte = 'vendas' | 'compras' | 'devolucoes' | 'estoque' | 'validades'
type Def = { id: string; nome: string }
const GRUPOS: Record<string, string> = {
  dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano', empresa: 'Loja (empresa)', item: 'Produto', setor: 'Setor', secao: 'Seção',
  vendedora: 'Vendedora', cliente: 'Cliente', fornecedor: 'Fornecedor', documento: 'Documento (venda/nota)', faixa: 'Situação / faixa', lote: 'Lote',
}
const METRICAS: Record<string, { nome: string; tipo: Tipo }> = {
  qtd: { nome: 'Quantidade', tipo: 'numero' }, bruto: { nome: 'Valor bruto', tipo: 'moeda' }, desconto: { nome: 'Desconto', tipo: 'moeda' },
  liquido: { nome: 'Valor líquido', tipo: 'moeda' }, custo: { nome: 'Custo', tipo: 'moeda' }, lucro: { nome: 'Lucro bruto', tipo: 'moeda' },
  margem: { nome: 'Margem %', tipo: 'pct' }, documentos: { nome: 'Nº de documentos', tipo: 'inteiro' }, itens: { nome: 'Nº de linhas', tipo: 'inteiro' },
  ticket: { nome: 'Ticket médio', tipo: 'moeda' }, clientes: { nome: 'Nº de clientes', tipo: 'inteiro' }, produtos: { nome: 'Nº de produtos', tipo: 'inteiro' },
}
const FONTES: Record<Fonte, { nome: string; desc: string; periodo: string | null; grupos: string[]; metricas: string[]; nomes?: Record<string, string>; filtros: string[] }> = {
  vendas: { nome: 'Vendas', desc: 'Itens vendidos (saída a receber efetivada).', periodo: 'Data da venda', grupos: ['dia', 'semana', 'mes', 'ano', 'empresa', 'item', 'setor', 'secao', 'vendedora', 'cliente', 'documento'], metricas: ['qtd', 'bruto', 'desconto', 'liquido', 'custo', 'lucro', 'margem', 'documentos', 'itens', 'ticket', 'clientes', 'produtos'], nomes: { documentos: 'Nº de vendas' }, filtros: ['empresa', 'vendedora', 'cliente', 'setor', 'secao', 'produto'] },
  devolucoes: { nome: 'Devoluções', desc: 'Itens devolvidos (modelo TM).', periodo: 'Data da devolução', grupos: ['dia', 'semana', 'mes', 'ano', 'empresa', 'item', 'setor', 'secao', 'vendedora', 'cliente', 'documento'], metricas: ['qtd', 'liquido', 'documentos', 'itens', 'clientes', 'produtos'], nomes: { liquido: 'Valor devolvido', documentos: 'Nº de devoluções' }, filtros: ['empresa', 'vendedora', 'cliente', 'setor', 'secao', 'produto'] },
  compras: { nome: 'Compras (entradas)', desc: 'Itens das notas de entrada efetivadas.', periodo: 'Data da entrada', grupos: ['dia', 'semana', 'mes', 'ano', 'empresa', 'item', 'setor', 'secao', 'fornecedor', 'documento', 'lote'], metricas: ['qtd', 'liquido', 'documentos', 'itens', 'produtos'], nomes: { liquido: 'Valor comprado', documentos: 'Nº de notas', qtd: 'Unidades' }, filtros: ['empresa', 'fornecedor', 'setor', 'secao', 'produto'] },
  estoque: { nome: 'Estoque atual', desc: 'Saldo de agora, a custo (sem período).', periodo: null, grupos: ['item', 'setor', 'secao', 'faixa'], metricas: ['qtd', 'custo', 'produtos'], nomes: { qtd: 'Unidades em estoque', custo: 'Valor em estoque (custo)', faixa: 'Situação' }, filtros: ['setor', 'secao', 'produto'] },
  validades: { nome: 'Validades (disponível)', desc: 'Unidades disponíveis por lote e validade.', periodo: 'Data de validade', grupos: ['mes', 'empresa', 'item', 'setor', 'faixa', 'lote'], metricas: ['qtd', 'custo', 'produtos', 'itens'], nomes: { qtd: 'Unidades disponíveis', custo: 'Valor a custo', itens: 'Nº de lotes', mes: 'Mês de validade' }, filtros: ['empresa', 'setor', 'produto', 'faixa'] },
}
const FILTROS: Record<string, string> = { empresa: 'Loja (código da empresa)', vendedora: 'Vendedora', cliente: 'Código do cliente', fornecedor: 'Código do fornecedor', setor: 'Setor', secao: 'Seção (parte do nome)', produto: 'Produto (nome ou código)', faixa: 'Faixa de validade' }
const SETORES = ['Alimentação', 'Farmácia', 'Diversos', 'Não classificado']
const FAIXAS: Def[] = [{ id: 'vencido', nome: 'Vencido' }, { id: 'critico_7d', nome: 'Até 7 dias' }, { id: 'alto_30d', nome: 'Até 30 dias' }, { id: 'atencao_60d', nome: 'Até 60 dias' }, { id: 'monitorar_90d', nome: 'Até 90 dias' }, { id: 'normal', nome: 'Mais de 90 dias' }]

/** Colunas que cada agrupamento traz no resultado. */
function colunasDoGrupo(g: string, f: Fonte): Coluna[] {
  switch (g) {
    case 'dia': return [{ chave: 'dia', titulo: 'Dia', tipo: 'data' }]
    case 'semana': return [{ chave: 'semana', titulo: 'Semana de', tipo: 'data' }]
    case 'mes': return [{ chave: 'mes', titulo: f === 'validades' ? 'Mês de validade' : 'Mês', tipo: 'texto' }]
    case 'ano': return [{ chave: 'ano', titulo: 'Ano', tipo: 'texto' }]
    case 'empresa': return [{ chave: 'empresa', titulo: 'Loja', tipo: 'texto' }]
    case 'item': return [{ chave: 'codigo', titulo: 'Código', tipo: 'texto' }, { chave: 'produto', titulo: 'Produto', tipo: 'texto' }]
    case 'setor': return [{ chave: 'setor', titulo: 'Setor', tipo: 'texto' }]
    case 'secao': return [{ chave: 'secao', titulo: 'Seção', tipo: 'texto' }]
    case 'vendedora': return [{ chave: 'codigo_vendedora', titulo: 'Cód. vendedora', tipo: 'texto' }, { chave: 'vendedora', titulo: 'Vendedora', tipo: 'texto' }]
    case 'cliente': return [{ chave: 'codigo_cliente', titulo: 'Cód. cliente', tipo: 'texto' }, { chave: 'cliente', titulo: 'Cliente', tipo: 'texto' }]
    case 'fornecedor': return [{ chave: 'codigo_fornecedor', titulo: 'Cód. fornecedor', tipo: 'texto' }, { chave: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto' }]
    case 'documento': return [{ chave: 'documento', titulo: 'Documento', tipo: 'texto' }, { chave: 'data_documento', titulo: 'Data', tipo: 'data' }]
    case 'faixa': return [{ chave: 'faixa', titulo: f === 'estoque' ? 'Situação' : 'Faixa', tipo: 'texto' }]
    case 'lote': return [{ chave: 'codigo', titulo: 'Código', tipo: 'texto' }, { chave: 'produto', titulo: 'Produto', tipo: 'texto' }, { chave: 'lote', titulo: 'Lote', tipo: 'texto' }, { chave: 'validade', titulo: 'Validade', tipo: 'data' }]
    default: return []
  }
}

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())
const mais = (iso: string, d: number) => { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10) }
const inicioMes = () => hoje().slice(0, 8) + '01'

type Modelo = { nome: string; qs: string }
const MODELOS_PRONTOS: Modelo[] = [
  { nome: 'Vendas por vendedora no mês', qs: `fonte=vendas&g=vendedora&m=documentos,bruto,desconto,liquido,lucro,margem,ticket&ordem=liquido` },
  { nome: 'Produtos mais vendidos', qs: `fonte=vendas&g=item&m=qtd,liquido,lucro,margem,documentos&ordem=liquido&limite=100` },
  { nome: 'Vendas dia a dia', qs: `fonte=vendas&g=dia&m=documentos,liquido,lucro,ticket&ordem=dia&dir=asc` },
  { nome: 'Vendas por setor e seção', qs: `fonte=vendas&g=setor,secao&m=qtd,liquido,lucro,margem&ordem=liquido` },
  { nome: 'Melhores clientes', qs: `fonte=vendas&g=cliente&m=documentos,liquido,ticket&ordem=liquido&limite=100` },
  { nome: 'Compras por fornecedor', qs: `fonte=compras&g=fornecedor&m=documentos,qtd,liquido,produtos&ordem=liquido` },
  { nome: 'Devoluções por vendedora', qs: `fonte=devolucoes&g=vendedora&m=documentos,qtd,liquido&ordem=liquido` },
  { nome: 'Estoque por setor', qs: `fonte=estoque&g=setor,secao&m=produtos,qtd,custo&ordem=custo` },
  { nome: 'Vencidos e a vencer por produto', qs: `fonte=validades&g=item&m=qtd,custo&de=2000-01-01&ate=${mais(hoje(), 90)}` },
]
const CHAVE_MODELOS = 'yup-relatorios-modelos'
function lerModelos(): Modelo[] { try { return JSON.parse(localStorage.getItem(CHAVE_MODELOS) || '[]') } catch { return [] } }
function gravarModelos(m: Modelo[]) { try { localStorage.setItem(CHAVE_MODELOS, JSON.stringify(m)) } catch { /* sem storage */ } }

type Resultado = { linhas: Record<string, unknown>[]; totais: Record<string, unknown>; total_linhas: number; limitado: boolean }

function RelatorioLivre() {
  const [sp, setSp] = useSearchParams()
  const fonte = (FONTES[sp.get('fonte') as Fonte] ? sp.get('fonte') : 'vendas') as Fonte
  const def = FONTES[fonte]
  const de = sp.get('de') ?? inicioMes(), ate = sp.get('ate') ?? hoje()
  const grupos = (sp.get('g') ?? 'mes').split(',').filter(g => def.grupos.includes(g)).slice(0, 3)
  const metricas = (sp.get('m') ?? 'liquido').split(',').filter(m => def.metricas.includes(m))
  const filtros: Record<string, string> = {}
  for (const f of def.filtros) { const v = sp.get(`f_${f}`); if (v) filtros[f] = v }
  const ordem = sp.get('ordem') ?? '', dir = sp.get('dir') ?? (fonte === 'validades' ? 'asc' : 'desc'), limite = sp.get('limite') ?? '1000'
  const set = (k: Record<string, string | null>) => setSp(prev => { const n = new URLSearchParams(prev); for (const [a, b] of Object.entries(k)) b === null || b === '' ? n.delete(a) : n.set(a, b); return n }, { replace: true })
  const nomeMetrica = (m: string) => def.nomes?.[m] ?? METRICAS[m].nome
  const nomeGrupo = (g: string) => def.nomes?.[g] ?? GRUPOS[g]

  const [res, setRes] = useState<Resultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [config, setConfig] = useState('')
  const [modelos, setModelos] = useState<Modelo[]>(lerModelos)
  const vend = useApi<{ vendedoras: { id: number; nome: string }[] }>(def.filtros.includes('vendedora') ? `dash/vendedoras?de=${mais(hoje(), -365)}&ate=${hoje()}` : null)

  const params = useMemo(() => ({ fonte, de: def.periodo ? de : null, ate: def.periodo ? ate : null, grupos, metricas, filtros, ordem: ordem || undefined, dir, limite: Number(limite) || 1000 }),
    [fonte, de, ate, grupos.join(), metricas.join(), JSON.stringify(filtros), ordem, dir, limite]) // eslint-disable-line react-hooks/exhaustive-deps
  const chave = JSON.stringify(params)
  const desatualizado = res !== null && config !== chave

  const gerar = async () => {
    if (!metricas.length) { setErro('Escolha pelo menos um valor para somar.'); return }
    setGerando(true); setErro(null)
    try { setRes(await api<Resultado>(`dash/relatorio?p=${encodeURIComponent(chave)}`)); setConfig(chave) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGerando(false) }
  }
  useEffect(() => { setRes(null) }, [fonte])

  const colunas: Coluna[] = [...grupos.flatMap(g => colunasDoGrupo(g, fonte)), ...(fonte === 'validades' && grupos.length && !grupos.includes('lote') ? [{ chave: 'proxima_validade', titulo: 'Validade mais próxima', tipo: 'data' as Tipo }] : []), ...metricas.map(m => ({ chave: m, titulo: nomeMetrica(m), tipo: METRICAS[m].tipo }))]
    .filter((c, i, a) => a.findIndex(x => x.chave === c.chave) === i)
  const rotulo = (c: Coluna, v: unknown) => c.chave === 'faixa' ? (FAIXAS.find(f => f.id === v)?.nome ?? String(v ?? '—').replace(/_/g, ' ')) : textoCelula(v, c.tipo)
  const linhasFmt: Record<string, unknown>[] = (res?.linhas ?? []).map(l => ({ ...l, faixa: l.faixa !== undefined ? rotulo({ chave: 'faixa', titulo: '', tipo: 'texto' }, l.faixa) : undefined }))
  const descricao = [
    def.nome,
    def.periodo ? `${def.periodo}: ${textoCelula(de, 'data')} a ${textoCelula(ate, 'data')}` : 'posição atual',
    grupos.length ? `por ${grupos.map(nomeGrupo).join(' › ')}` : 'total geral',
    ...Object.entries(filtros).map(([k, v]) => `${FILTROS[k]}: ${k === 'vendedora' ? (vend.data?.vendedoras.find(x => String(x.id) === v)?.nome ?? v) : k === 'faixa' ? FAIXAS.find(f => f.id === v)?.nome ?? v : v}`),
  ].join(' · ')
  const baixar = (tipo: 'xlsx' | 'pdf') => {
    if (!res) return
    const doc = { titulo: `Relatório de ${def.nome.toLowerCase()}`, subtitulo: descricao + (res.limitado ? ` · mostrando ${res.linhas.length} de ${res.total_linhas} linhas` : ''), arquivo: `relatorio ${fonte} ${hoje()}`,
      secoes: [{ nome: def.nome, colunas, linhas: linhasFmt, totais: grupos.length ? res.totais : null }] }
    return tipo === 'xlsx' ? baixarExcel(doc) : baixarPdf(doc)
  }
  const aplicarModelo = (qs: string) => { const n = new URLSearchParams(qs); if (!n.get('de') && FONTES[(n.get('fonte') ?? 'vendas') as Fonte].periodo) { n.set('de', inicioMes()); n.set('ate', hoje()) } setSp(n, { replace: true }); setRes(null) }
  const salvar = () => {
    const nome = window.prompt('Nome do modelo de relatório:', `${def.nome} por ${grupos.map(nomeGrupo).join(' e ') || 'total'}`)
    if (!nome) return
    const novo = [...modelos.filter(m => m.nome !== nome), { nome, qs: sp.toString() }]
    setModelos(novo); gravarModelos(novo)
  }
  const excluir = (nome: string) => { const novo = modelos.filter(m => m.nome !== nome); setModelos(novo); gravarModelos(novo) }
  const alternar = (lista: string[], v: string, max = 99) => lista.includes(v) ? lista.filter(x => x !== v) : lista.length >= max ? lista : [...lista, v]

  return (
    <>

      <section className="rel-modelos" aria-label="Modelos">
        <span className="rel-rotulo">Começar de um modelo</span>
        <div className="chips">
          {MODELOS_PRONTOS.map(m => <button key={m.nome} type="button" className="chip" onClick={() => aplicarModelo(m.qs)}>{m.nome}</button>)}
          {modelos.map(m => (
            <span key={m.nome} className="chip-salvo">
              <button type="button" className="chip" aria-pressed="false" onClick={() => aplicarModelo(m.qs)}>★ {m.nome}</button>
              <button type="button" className="chip-x" onClick={() => excluir(m.nome)} aria-label={`Excluir o modelo ${m.nome}`}><Trash2 size={13} aria-hidden /></button>
            </span>
          ))}
        </div>
      </section>

      <div className="rel-grid">
        <fieldset className="aud-card rel-bloco">
          <legend>1. Dados</legend>
          <div className="rel-fontes" role="radiogroup" aria-label="Fonte dos dados">
            {(Object.keys(FONTES) as Fonte[]).map(f => (
              <label key={f} className={`rel-fonte${f === fonte ? ' on' : ''}`}>
                <input type="radio" name="fonte" checked={f === fonte} onChange={() => set({ fonte: f, g: null, m: null, ordem: null })} />
                <b>{FONTES[f].nome}</b><small>{FONTES[f].desc}</small>
              </label>
            ))}
          </div>
          {def.periodo && (
            <div className="rel-linha">
              <label className="field-inline">{def.periodo}: de <input className="input" type="date" value={de} max={ate} onChange={e => e.target.value && set({ de: e.target.value })} /></label>
              <label className="field-inline">até <input className="input" type="date" value={ate} min={de} onChange={e => e.target.value && set({ ate: e.target.value })} /></label>
              <div className="chips">
                <button type="button" className="chip" onClick={() => set({ de: inicioMes(), ate: hoje() })}>Este mês</button>
                <button type="button" className="chip" onClick={() => { const i = inicioMes(); const fim = mais(i, -1); set({ de: fim.slice(0, 8) + '01', ate: fim }) }}>Mês passado</button>
                <button type="button" className="chip" onClick={() => set({ de: mais(hoje(), -29), ate: hoje() })}>30 dias</button>
                <button type="button" className="chip" onClick={() => set({ de: hoje().slice(0, 4) + '-01-01', ate: hoje() })}>Este ano</button>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="aud-card rel-bloco">
          <legend>2. Agrupar por <small>(até 3, na ordem em que marcar)</small></legend>
          <div className="rel-opcoes">
            {def.grupos.map(g => (
              <label key={g} className="rel-op"><input type="checkbox" checked={grupos.includes(g)} disabled={!grupos.includes(g) && grupos.length >= 3} onChange={() => set({ g: alternar(grupos, g, 3).join(',') || 'nenhum' })} />
                {nomeGrupo(g)}{grupos.includes(g) && <span className="rel-n">{grupos.indexOf(g) + 1}</span>}</label>
            ))}
          </div>
          {!grupos.length && <p className="hint">Sem agrupamento: o relatório mostra só o total geral.</p>}
        </fieldset>

        <fieldset className="aud-card rel-bloco">
          <legend>3. Valores</legend>
          <div className="rel-opcoes">
            {def.metricas.map(m => <label key={m} className="rel-op"><input type="checkbox" checked={metricas.includes(m)} onChange={() => set({ m: alternar(metricas, m).join(',') || 'nenhum' })} />{nomeMetrica(m)}</label>)}
          </div>
        </fieldset>

        <fieldset className="aud-card rel-bloco">
          <legend>4. Filtros e ordem</legend>
          <div className="rel-filtros">
            {def.filtros.map(f => (
              <label key={f}>{FILTROS[f]}
                {f === 'setor' ? <select className="select" value={filtros.setor ?? ''} onChange={e => set({ f_setor: e.target.value })}><option value="">Todos</option>{SETORES.map(s => <option key={s}>{s}</option>)}</select>
                  : f === 'faixa' ? <select className="select" value={filtros.faixa ?? ''} onChange={e => set({ f_faixa: e.target.value })}><option value="">Todas</option>{FAIXAS.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
                  : f === 'vendedora' ? <select className="select" value={filtros.vendedora ?? ''} onChange={e => set({ f_vendedora: e.target.value })}><option value="">Todas</option>{(vend.data?.vendedoras ?? []).map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}</select>
                  : <input className="input" inputMode={['empresa', 'cliente', 'fornecedor'].includes(f) ? 'numeric' : undefined} value={filtros[f] ?? ''} onChange={e => set({ [`f_${f}`]: ['empresa', 'cliente', 'fornecedor'].includes(f) ? e.target.value.replace(/\D/g, '') : e.target.value.slice(0, 60) })} placeholder={f === 'produto' ? 'ex.: dipirona ou 1234' : ''} />}
              </label>
            ))}
            <label>Ordenar por
              <select className="select" value={ordem} onChange={e => set({ ordem: e.target.value })}>
                <option value="">{fonte === 'validades' ? 'Validade (vence primeiro no topo)' : 'Automático'}</option>
                {metricas.map(m => <option key={m} value={m}>{nomeMetrica(m)}</option>)}
                {grupos.filter(g => ['dia', 'semana', 'mes', 'ano', 'empresa', 'setor', 'secao', 'faixa'].includes(g)).map(g => <option key={g} value={g}>{nomeGrupo(g)}</option>)}
              </select>
            </label>
            <label>Sentido
              <select className="select" value={dir} onChange={e => set({ dir: e.target.value })}><option value="desc">{fonte === 'validades' && !ordem ? 'Vence por último primeiro' : 'Maior para menor'}</option><option value="asc">{fonte === 'validades' && !ordem ? 'Vence primeiro no topo' : 'Menor para maior'}</option></select>
            </label>
            <label>Máximo de linhas
              <select className="select" value={limite} onChange={e => set({ limite: e.target.value })}>{['50', '100', '500', '1000', '5000'].map(x => <option key={x}>{x}</option>)}</select>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="rel-acoes">
        <button type="button" className="btn" onClick={gerar} disabled={gerando || !metricas.length}><Play size={16} aria-hidden />{gerando ? 'Gerando…' : res && !desatualizado ? 'Gerar de novo' : 'Gerar relatório'}</button>
        <button type="button" className="btn secondary" onClick={salvar}><Save size={16} aria-hidden />Salvar como modelo</button>
        {res && <>
          <button type="button" className="btn secondary" onClick={() => baixar('xlsx')} disabled={desatualizado}><FileSpreadsheet size={16} aria-hidden />Baixar Excel</button>
          <button type="button" className="btn secondary" onClick={() => baixar('pdf')} disabled={desatualizado}><FileText size={16} aria-hidden />Baixar PDF</button>
        </>}
      </div>

      {erro && <ErrorState message={erro} />}
      {gerando && !res ? <Loading rows={6} /> : res && (
        <section aria-live="polite" style={{ opacity: desatualizado ? 0.55 : 1 }}>
          <p className="hint"><b>{descricao}</b>{desatualizado ? ' · você mudou a configuração: clique em Gerar para atualizar.' : ''}{res.limitado ? ` · mostrando ${res.linhas.length} de ${res.total_linhas} linhas (aumente o máximo ou filtre mais).` : ''}</p>
          {!res.linhas.length ? <Empty>Nenhum dado com essa configuração.</Empty> : (
            <div className="table-wrap cards-sm"><table>
              <caption className="sr-only">Resultado do relatório</caption>
              <thead><tr>{colunas.map(c => <th key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'r'}>{c.titulo}</th>)}</tr></thead>
              <tbody>{linhasFmt.map((l, i) => (
                <tr key={i}>{colunas.map(c => (
                  <td key={c.chave} data-label={c.titulo} className={c.tipo === 'texto' || c.tipo === 'data' ? (c.chave === 'produto' ? 'wrap' : '') : 'r money'}>
                    {c.chave === 'produto' && l.variacao ? <ItemLink id={Number(l.variacao)}>{String(l.produto ?? `Item ${l.variacao}`)}</ItemLink> : c.chave === 'faixa' ? String(l.faixa ?? '—') : textoCelula(l[c.chave], c.tipo)}
                  </td>))}</tr>))}</tbody>
              {grupos.length > 0 && <tfoot><tr>{colunas.map((c, i) => <td key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'r money'}>{res.totais[c.chave] !== undefined ? textoCelula(res.totais[c.chave], c.tipo) : i === 0 ? <b>Total</b> : ''}</td>)}</tr></tfoot>}
            </table></div>
          )}
          <p className="hint">Total calculado sobre todos os dados do filtro, mesmo quando a lista é cortada. Margem = lucro ÷ valor líquido; ticket = valor líquido ÷ nº de vendas.</p>
        </section>
      )}
    </>
  )
}

export default function Relatorios() {
  const [sp, setSp] = useSearchParams()
  const modo = sp.get('modo') === 'produto' ? 'produto' : 'livre'
  return (
    <>
      <PageHead section="Relatórios" title="Relatórios">
        Relatório livre: escolha de onde vêm os dados, o período, como agrupar, o que somar e os filtros. Relatório do produto: a ficha completa de um ou mais itens (ou de uma amostra sorteada), com as partes que você quiser — preços, compras, vendas, quem vendeu, log e linha do tempo. Tudo na tela e em Excel ou PDF, com os mesmos valores do resto do sistema.
      </PageHead>
      <div style={{ marginBottom: 18 }}>
        <Tabs<'livre' | 'produto'> label="Tipo de relatório" value={modo} onChange={v => setSp(v === 'produto' ? new URLSearchParams({ modo: 'produto' }) : new URLSearchParams(), { replace: true })}
          options={[{ id: 'livre', label: 'Relatório livre' }, { id: 'produto', label: 'Relatório do produto' }]} />
      </div>
      {modo === 'produto' ? <RelatorioProduto /> : <RelatorioLivre />}
    </>
  )
}
