// Auditoria de valores: os mesmos totais somados no ERP e no sistema, comparados ao centavo.
// Roda sozinha todo dia às 6h (dados até ontem às 23:59) e pode ser refeita aqui.

import { useState } from 'react'
import { CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react'
import { api, useApi } from '../api'
import { data as fmtData, haQuanto, mes as fmtMes } from '../format'
import { Empty, ErrorState, Loading, PageHead, Tabs } from '../ui'

type Campo = 'docs' | 'itens' | 'qtd' | 'valor' | 'bruto' | 'desconto'
type T = Partial<Record<Campo, string>>
type Linha = { mes: string; chave: Record<string, string>; grupo: string; erp: T | null; sistema: T | null; diferenca: T; ok: boolean }
type Grupo = { grupo: string; erp: T; sistema: T; diferenca: T; ok: boolean; meses_divergentes: string[] }
type Res = {
  gerado_em: string; periodo_ate: string; segundos: number; requisicoes_erp: number; ok: boolean; divergencias: number
  grupos: Grupo[]; classes: Linha[]; vendedoras: Linha[]
  estoque: { erp: { linhas: string; qtd: string }; sistema: { linhas: string; qtd: string }; diferenca: { linhas: string; qtd: string }; ok: boolean }
  orfaos: { iddocumento: number; no_erp: Record<string, string> | null }[]
}
type Resp = { ultima: { started_at: string; status: string; details: Res } | null; historico: { started_at: string; finished_at: string; status: string; error: string | null }[] }

const GRUPOS: Record<string, string> = { vendas: 'Vendas', devolucoes: 'Devoluções', compras: 'Compras (entradas)', outros: 'Outros documentos' }
const CAMPOS: { id: Campo; label: string; casas: number; moeda?: boolean }[] = [
  { id: 'docs', label: 'Documentos', casas: 0 }, { id: 'itens', label: 'Itens', casas: 0 }, { id: 'qtd', label: 'Quantidade', casas: 3 },
  { id: 'valor', label: 'Valor líquido', casas: 2, moeda: true }, { id: 'bruto', label: 'Valor bruto', casas: 2, moeda: true }, { id: 'desconto', label: 'Descontos', casas: 2, moeda: true },
]
const STATUS: Record<string, string> = { E: 'efetivado', R: 'status R', X: 'status X', C: 'cancelado', P: 'pendente' }

/** Texto decimal exato (ex.: "1234.50") formatado sem passar por ponto flutuante. */
function fmt(v: string | undefined | null, casas: number, moeda?: boolean) {
  if (v === undefined || v === null) return '—'
  const neg = v.startsWith('-'), [i, f = ''] = v.replace('-', '').split('.')
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = casas ? ',' + f.padEnd(casas, '0').slice(0, casas) : ''
  const s = (moeda ? 'R$ ' : '') + int + (casas === 3 ? frac.replace(/,?0+$/, '') : frac)
  return (neg ? '−' : '') + s
}
const sinal = (v: string | undefined, casas: number, moeda?: boolean) => v === undefined ? '' : (v.startsWith('-') ? '' : '+') + fmt(v, casas, moeda)
const tipo = (k: Record<string, string>) => `${k.modelo ? `Modelo ${k.modelo}` : 'Sem modelo'} · ${k.tm === 'S' ? 'saída' : k.tm === 'E' ? 'entrada' : k.tm || '?'}${k.tf ? ` / ${k.tf === 'R' ? 'a receber' : k.tf === 'P' ? 'a pagar' : k.tf === 'N' ? 'sem financeiro' : k.tf}` : ''} · ${STATUS[k.status] ?? `status ${k.status || '?'}`}`

function CardGrupo({ g }: { g: Grupo }) {
  return (
    <section className="aud-card" aria-label={GRUPOS[g.grupo]}>
      <h3>{GRUPOS[g.grupo] ?? g.grupo}{g.ok ? <span className="aud-ok"><CheckCircle2 size={16} aria-hidden /> bate</span> : <span className="aud-bad"><TriangleAlert size={16} aria-hidden /> diferença</span>}</h3>
      <div className="table-wrap"><table>
        <caption className="sr-only">{GRUPOS[g.grupo]}: ERP e sistema</caption>
        <thead><tr><th /><th className="r">ERP</th><th className="r">Sistema</th></tr></thead>
        <tbody>{CAMPOS.map(c => (
          <tr key={c.id}>
            <th scope="row">{c.label}</th>
            <td className="r money">{fmt(g.erp[c.id], c.casas, c.moeda)}</td>
            <td className="r money">{fmt(g.sistema[c.id], c.casas, c.moeda)}{g.diferenca[c.id] && <small className="num-dif">{sinal(g.diferenca[c.id], c.casas, c.moeda)}</small>}</td>
          </tr>))}</tbody>
      </table></div>
      {!g.ok && g.meses_divergentes.length > 0 && <p className="hint">Diferença em: {g.meses_divergentes.map(m => fmtMes(m + '-01')).join(', ')}.</p>}
    </section>
  )
}

function TabelaLinhas({ linhas, nome }: { linhas: Linha[]; nome: (l: Linha) => string }) {
  if (!linhas.length) return <Empty>Nada diferente: ERP e sistema batem em todos os meses.</Empty>
  return (
    <div className="table-wrap cards-sm"><table>
      <caption className="sr-only">Diferenças</caption>
      <thead><tr><th>Mês</th><th>O quê</th><th>Campo</th><th className="r">ERP</th><th className="r">Sistema</th><th className="r">Diferença</th></tr></thead>
      <tbody>{linhas.flatMap(l => {
        const campos = CAMPOS.filter(c => l.diferenca[c.id] !== undefined)
        return campos.map((c, i) => (
          <tr key={l.mes + JSON.stringify(l.chave) + c.id}>
            <td data-label="Mês">{i === 0 ? fmtMes(l.mes + '-01') : ''}</td>
            <td data-label="O quê" className="wrap">{i === 0 ? <>{nome(l)}{!l.erp && <small>só existe no sistema</small>}{!l.sistema && <small>falta no sistema</small>}</> : ''}</td>
            <td data-label="Campo">{c.label}</td>
            <td className="r money" data-label="ERP">{fmt(l.erp?.[c.id] ?? '0', c.casas, c.moeda)}</td>
            <td className="r money" data-label="Sistema">{fmt(l.sistema?.[c.id] ?? '0', c.casas, c.moeda)}</td>
            <td className="r num-dif" data-label="Diferença">{sinal(l.diferenca[c.id], c.casas, c.moeda)}</td>
          </tr>))
      })}</tbody>
    </table></div>
  )
}

type Aba = 'diferencas' | 'meses' | 'vendedoras' | 'historico'

export default function Auditoria() {
  const { data: r, error, reload } = useApi<Resp>('dash/auditoria')
  const [rodando, setRodando] = useState(false)
  const [erroRun, setErroRun] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('diferencas')
  const rodar = async () => {
    setRodando(true); setErroRun(null)
    try { await api('auditoria/run', { method: 'POST', body: '{}' }); reload() }
    catch (e) { setErroRun(e instanceof Error ? e.message : String(e)) }
    finally { setRodando(false) }
  }
  const a = r?.ultima?.details
  const vendasMes = a ? a.classes.filter(l => l.grupo === 'vendas') : []
  const porMes = [...new Set(vendasMes.map(l => l.mes))].map(m => {
    const ls = vendasMes.filter(l => l.mes === m)
    const s = (lado: 'erp' | 'sistema', c: Campo) => ls.reduce((x, l) => x + BigInt(Math.round(Number(l[lado]?.[c] ?? 0) * (c === 'qtd' ? 1000 : c === 'valor' ? 100 : 1))), 0n)
    return { mes: m, ok: ls.every(l => l.ok), erpV: s('erp', 'valor'), sisV: s('sistema', 'valor'), erpD: s('erp', 'docs'), sisD: s('sistema', 'docs') }
  })
  const cent = (n: bigint) => { const neg = n < 0n, a2 = (neg ? -n : n).toString().padStart(3, '0'); return (neg ? '-' : '') + a2.slice(0, -2) + '.' + a2.slice(-2) }

  return (
    <>
      <PageHead section="Conferência" title="Auditoria de valores"
        actions={<button type="button" className="btn" onClick={rodar} disabled={rodando}><RefreshCw size={16} aria-hidden className={rodando ? 'spin' : undefined} />{rodando ? 'Conferindo no ERP… (~1 min)' : 'Conferir agora'}</button>}>
        Vendas, devoluções, compras, estoque e vendas por vendedora somados no ERP e no sistema, comparados ao centavo. Roda sozinha todo dia às 6h com os dados até o fim do dia anterior.
      </PageHead>
      {erroRun && <ErrorState message={erroRun} />}
      {error ? <ErrorState message={error} onRetry={reload} /> : !r ? <Loading rows={8} /> : !a ? (
        <Empty>Ainda não há auditoria. Clique em “Conferir agora” (leva cerca de 1 minuto).</Empty>
      ) : (
        <>
          <div className="aud-head">
            {a.ok
              ? <span className="pill good"><CheckCircle2 size={14} aria-hidden /> Tudo bate ao centavo</span>
              : <span className="pill bad"><TriangleAlert size={14} aria-hidden /> {a.divergencias} {a.divergencias === 1 ? 'linha diferente' : 'linhas diferentes'}{a.orfaos.length ? `, ${a.orfaos.length} documentos incompletos` : ''}{!a.estoque.ok ? ', estoque diferente' : ''}</span>}
            <span className="muted">Conferido {haQuanto(a.gerado_em)} · dados até {fmtData(new Date(new Date(a.periodo_ate + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10))} 23:59 · {a.requisicoes_erp} consultas ao ERP em {a.segundos} s</span>
          </div>

          <div className="aud-grupos">
            {a.grupos.map(g => <CardGrupo key={g.grupo} g={g} />)}
            <section className="aud-card" aria-label="Estoque">
              <h3>Estoque (saldo agora){a.estoque.ok ? <span className="aud-ok"><CheckCircle2 size={16} aria-hidden /> bate</span> : <span className="aud-bad"><TriangleAlert size={16} aria-hidden /> diferença</span>}</h3>
              <div className="table-wrap"><table>
                <caption className="sr-only">Estoque: ERP e sistema</caption>
                <thead><tr><th /><th className="r">ERP</th><th className="r">Sistema</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Registros de saldo</th><td className="r">{fmt(a.estoque.erp.linhas, 0)}</td><td className="r">{fmt(a.estoque.sistema.linhas, 0)}{a.estoque.diferenca.linhas !== '0' && <small className="num-dif">{sinal(a.estoque.diferenca.linhas, 0)}</small>}</td></tr>
                  <tr><th scope="row">Unidades em estoque</th><td className="r">{fmt(a.estoque.erp.qtd, 3)}</td><td className="r">{fmt(a.estoque.sistema.qtd, 3)}{!/^-?0\.000$/.test(a.estoque.diferenca.qtd) && <small className="num-dif">{sinal(a.estoque.diferenca.qtd, 3)}</small>}</td></tr>
                </tbody>
              </table></div>
              <p className="hint">O saldo muda a cada venda; diferença pequena pode ser só a sincronização (a cada poucos minutos).</p>
            </section>
          </div>

          {a.orfaos.length > 0 && (
            <section className="aud-card" style={{ marginBottom: 22 }}>
              <h3>Itens sem o documento no sistema<span className="aud-bad"><TriangleAlert size={16} aria-hidden /> {a.orfaos.length}</span></h3>
              <p className="hint">Esses itens chegaram ao sistema, mas o cabeçalho do documento não. Eles ficam fora de vendas e compras até o documento chegar.</p>
              <ul className="plain">{a.orfaos.map(o => (
                <li key={o.iddocumento}>Documento {o.iddocumento}: {o.no_erp
                  ? <>existe no ERP ({tipo({ modelo: o.no_erp.modelo ?? '', tm: o.no_erp.tm ?? '', tf: o.no_erp.tf ?? '', status: o.no_erp.status ?? '' })}, {fmtData(String(o.no_erp.datahora).slice(0, 10))}). A sincronização ainda não trouxe o cabeçalho; se continuar depois de um dia, reinicie a leitura de documentos em Sincronização.</>
                  : <>não existe mais no ERP (foi apagado). Os itens que sobraram no sistema não entram em nenhum total.</>}</li>))}</ul>
            </section>
          )}

          <Tabs<Aba> abas label="Detalhe" value={aba} onChange={setAba} options={[
            { id: 'diferencas', label: `Diferenças (${a.classes.filter(l => !l.ok).length})` },
            { id: 'meses', label: 'Vendas mês a mês' },
            { id: 'vendedoras', label: `Por vendedora (${a.vendedoras.filter(l => !l.ok).length})` },
            { id: 'historico', label: 'Histórico' },
          ]} />
          <div style={{ marginTop: 14 }}>
            {aba === 'diferencas' && <TabelaLinhas linhas={a.classes.filter(l => !l.ok)} nome={l => `${GRUPOS[l.grupo]}: ${tipo(l.chave)}`} />}
            {aba === 'vendedoras' && <TabelaLinhas linhas={a.vendedoras.filter(l => !l.ok)} nome={l => l.chave.vendedora === '0' ? 'Itens sem vendedora' : `Vendedora código ${l.chave.vendedora}`} />}
            {aba === 'meses' && (
              <div className="table-wrap cards-sm"><table>
                <caption className="sr-only">Vendas mês a mês</caption>
                <thead><tr><th>Mês</th><th className="r">Vendas no ERP</th><th className="r">Vendas no sistema</th><th className="r">Valor no ERP</th><th className="r">Valor no sistema</th><th className="r">Diferença</th></tr></thead>
                <tbody>{porMes.map(m => (
                  <tr key={m.mes}>
                    <td className="title" data-label="Mês">{fmtMes(m.mes + '-01')}</td>
                    <td className="r" data-label="Vendas no ERP">{fmt(m.erpD.toString(), 0)}</td>
                    <td className="r" data-label="Vendas no sistema">{fmt(m.sisD.toString(), 0)}</td>
                    <td className="r money" data-label="Valor no ERP">{fmt(cent(m.erpV), 2, true)}</td>
                    <td className="r money" data-label="Valor no sistema">{fmt(cent(m.sisV), 2, true)}</td>
                    <td className={`r ${m.ok ? 'aud-ok' : 'num-dif'}`} data-label="Diferença">{m.ok ? 'bate' : sinal(cent(m.sisV - m.erpV), 2, true)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {aba === 'historico' && (
              <div className="table-wrap cards-sm"><table>
                <caption className="sr-only">Histórico de auditorias</caption>
                <thead><tr><th>Quando</th><th>Resultado</th></tr></thead>
                <tbody>{r.historico.map(h => (
                  <tr key={h.started_at}><td data-label="Quando">{new Date(h.started_at).toLocaleString('pt-BR')}</td>
                    <td data-label="Resultado" className="wrap">{h.status === 'ok' ? <span className="aud-ok">tudo bate</span> : h.status === 'divergente' ? <span className="aud-bad">com diferenças</span> : <span className="aud-bad">falhou: {h.error}</span>}</td></tr>))}</tbody>
              </table></div>
            )}
          </div>
          <p className="hint" style={{ marginTop: 16 }}>Critérios: venda = saída a receber efetivada (pré-venda PV, NFC-e 65 e NF-e 55); devolução = modelo TM, entrada a pagar efetivada; compra = entrada a pagar efetivada (NF-e 55, 1A). “Outros” são orçamentos/pedidos sem financeiro e documentos não efetivados: conferidos aqui, mas fora dos totais de venda e compra.</p>
        </>
      )}
    </>
  )
}
