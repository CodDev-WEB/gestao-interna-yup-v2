import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, useApi } from '../api'
import { brl, int } from '../format'
import { SETORES, SETOR_COR } from '../labels'
import { nivelPrefixo, nomeCapitulo, nomePosicao, nomePrefixo } from '../ncm'
import { Empty, ErrorState, Loading, PageHead } from '../ui'
import { SetoresTabs } from './Setores'

type Regra = { prefixo: string; setor: string }
type Linha = { setor: string; capitulo: string | null; posicao: string | null; ncm: string | null; ncm_descricao: string | null; produtos: number; valor_estoque: number | string }

/** Regra que vale para um NCM: a de prefixo mais longo. */
const regraDe = (ncm: string, regras: Regra[]) => regras.filter(r => ncm.startsWith(r.prefixo)).sort((a, b) => b.prefixo.length - a.prefixo.length)[0]

export default function SetoresRegras() {
  const { data: regras, error, reload } = useApi<Regra[]>('dash/ncm-regras')
  const { data: cats, reload: recarregarCats } = useApi<Linha[]>('dash/categorias')
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState({ prefixo: '', setor: SETORES[0] as string })

  const salvar = async (prefixo: string, setor: string | null) => {
    setSalvando(prefixo); setErro(null)
    try { await api('dash/ncm-regras', { method: 'POST', body: JSON.stringify({ prefixo, setor }) }); reload(); recarregarCats() }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvando(null) }
  }

  // Quantos produtos e quanto estoque cada regra decide hoje (só onde ela é a mais específica).
  const alcance = useMemo(() => {
    const m = new Map<string, { produtos: number; valor: number }>()
    for (const l of cats ?? []) {
      if (!l.ncm || !regras) continue
      const r = regraDe(l.ncm, regras); if (!r) continue
      const a = m.get(r.prefixo) ?? { produtos: 0, valor: 0 }
      a.produtos += Number(l.produtos); a.valor += Number(l.valor_estoque); m.set(r.prefixo, a)
    }
    return m
  }, [cats, regras])

  // Grupos (capítulos) com produtos e sem regra: sugestões para classificar.
  const semRegra = useMemo(() => {
    const m = new Map<string, { produtos: number; valor: number; desc: string | null }>()
    for (const l of cats ?? []) {
      if (!l.ncm || !regras || regraDe(l.ncm, regras)) continue
      const k = l.posicao!
      const a = m.get(k) ?? { produtos: 0, valor: 0, desc: l.ncm_descricao }
      a.produtos += Number(l.produtos); a.valor += Number(l.valor_estoque); m.set(k, a)
    }
    return [...m.entries()].sort((a, b) => b[1].valor - a[1].valor)
  }, [cats, regras])

  const prefixoOk = /^\d{2,8}$/.test(novo.prefixo)

  return (
    <>
      <SetoresTabs />
      <PageHead section="SETORES / REGRAS POR NCM" title="Regras por NCM">
        Diga em que setor entra cada grupo (2 dígitos), subgrupo (4 dígitos) ou NCM. Vale a regra mais específica: "2309" vence "23". NCM sem regra usa a seção do ERP; sem seção classificada, vai para Diversos.
      </PageHead>
      {erro && <div className="notice error" role="alert">{erro}</div>}

      <section className="panel" aria-labelledby="nova-h" style={{ marginBottom: 18 }}>
        <h2 id="nova-h">Nova regra</h2>
        <form className="rule-form" onSubmit={e => { e.preventDefault(); if (prefixoOk) { void salvar(novo.prefixo, novo.setor); setNovo({ ...novo, prefixo: '' }) } }}>
          <label>Começo do NCM
            <input className="input" inputMode="numeric" placeholder="ex.: 23, 3004 ou 23091000" value={novo.prefixo} onChange={e => setNovo({ ...novo, prefixo: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
          </label>
          <label>Setor
            <select className="select" value={novo.setor} onChange={e => setNovo({ ...novo, setor: e.target.value })}>{SETORES.map(s => <option key={s}>{s}</option>)}</select>
          </label>
          <button className="btn" type="submit" disabled={!prefixoOk || !!salvando}><Plus size={16} aria-hidden />Adicionar</button>
        </form>
        {novo.prefixo.length >= 2 && <p className="hint" style={{ margin: '10px 0 0' }}>{nivelPrefixo(novo.prefixo)}: <strong>{nomePrefixo(novo.prefixo)}</strong>{regras?.some(r => r.prefixo === novo.prefixo) && ' · já existe uma regra para este código; ela será trocada.'}</p>}
      </section>

      {error ? <ErrorState message={error} onRetry={reload} /> : !regras ? <Loading /> : regras.length === 0 ? <Empty>Nenhuma regra ainda. Todos os produtos usam a seção do ERP.</Empty> : (
        <div className="table-wrap cards-sm">
          <table>
            <caption className="sr-only">Regras de setor por NCM</caption>
            <thead><tr><th>Código</th><th>Nível</th><th className="r">Produtos</th><th className="r">Estoque</th><th>Setor</th><th></th></tr></thead>
            <tbody>
              {regras.map(r => (
                <tr key={r.prefixo}>
                  <td><span className="title"><code className="ncm-code">{r.prefixo}</code> {nomePrefixo(r.prefixo)}</span></td>
                  <td data-label="Nível">{nivelPrefixo(r.prefixo)}</td>
                  <td className="r" data-label="Produtos">{int(alcance.get(r.prefixo)?.produtos ?? 0)}</td>
                  <td className="r" data-label="Estoque">{brl(alcance.get(r.prefixo)?.valor ?? 0)}</td>
                  <td data-label="Setor">
                    <span className="tag" style={{ marginRight: 8 }}><i style={{ background: SETOR_COR[r.setor] }} aria-hidden /></span>
                    <select className="select" value={r.setor} disabled={salvando === r.prefixo} onChange={e => salvar(r.prefixo, e.target.value)} aria-label={`Setor do código ${r.prefixo}`}>
                      {SETORES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td data-label="">
                    <button className="btn secondary" disabled={salvando === r.prefixo} onClick={() => { if (window.confirm(`Remover a regra do código ${r.prefixo}?`)) void salvar(r.prefixo, null) }} aria-label={`Remover regra ${r.prefixo}`}><Trash2 size={15} aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {semRegra.length > 0 && (
        <section className="section" aria-labelledby="sem-h">
          <div className="section-head"><div><span className="eyebrow">Sem regra</span><h2 id="sem-h">Subgrupos que ainda usam a seção do ERP</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>Escolha um setor para criar a regra do subgrupo (4 dígitos) com um clique.</p></div></div>
          <div className="table-wrap cards-sm">
            <table>
              <thead><tr><th>Subgrupo</th><th className="r">Produtos</th><th className="r">Estoque</th><th>Criar regra</th></tr></thead>
              <tbody>
                {semRegra.slice(0, 40).map(([pos, a]) => (
                  <tr key={pos}>
                    <td><span className="title"><code className="ncm-code">{pos}</code> {nomePosicao(pos, a.desc)}</span><small>{nomeCapitulo(pos.slice(0, 2))}</small></td>
                    <td className="r" data-label="Produtos">{int(a.produtos)}</td>
                    <td className="r" data-label="Estoque">{brl(a.valor)}</td>
                    <td data-label="Criar regra">
                      <select className="select" defaultValue="" disabled={salvando === pos} onChange={e => e.target.value && salvar(pos, e.target.value)} aria-label={`Setor para o subgrupo ${pos}`}>
                        <option value="">Escolher setor…</option>
                        {SETORES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
