import { useState } from 'react'
import { Check, ClipboardCheck, ScanLine } from 'lucide-react'
import { api, useApi } from '../api'
import { brl, dec, int, pct } from '../format'
import { CLASSES, ClasseTag } from '../gestao'
import { ItemLink } from '../ProdutoPainel'
import { Empty, ErrorState, Loading, Metric, PageHead, SearchBox, Tabs, useParam } from '../ui'

type Pendente = { idmercadoriavariacao: number; descricao: string | null; codigobarras: string | null; secao: string | null; classe: string; ultima_contagem: string | null; intervalo_dias: number }
type Lista = { lista: Pendente[]; pendentes: Record<'A' | 'B' | 'C', number>; por_dia: Record<'A' | 'B' | 'C', number> }
type Acuracia = { mes: string; classe: string; contados: number; sem_divergencia: number; acuracia_pct: number | string; valor_divergente: number | string; saldo_divergencia: number | string }
type Contagem = { id: number; idmercadoriavariacao: number; descricao: string | null; qtd_contada: number | string; qtd_sistema: number | string | null; diferenca: number; custo_unitario: number | string | null; motivo: string | null; contado_por: string | null; contado_em: string }
type Conc = { acuracia: Acuracia[]; ultimas: Contagem[] }

const MOTIVOS = [
  { id: '', nome: 'Sem diferença ou motivo desconhecido' },
  { id: 'furto', nome: 'Furto' }, { id: 'avaria', nome: 'Avaria' }, { id: 'erro_entrada', nome: 'Erro na entrada' },
  { id: 'erro_venda', nome: 'Erro na venda (código trocado)' }, { id: 'vencimento', nome: 'Vencimento' }, { id: 'outro', nome: 'Outro' },
]
const META = { A: 98, B: 95, C: 95 } as Record<string, number>

/** Um item a contar: o saldo do sistema não aparece antes de salvar (contagem às cegas). */
function ItemContagem({ item, onSalvo }: { item: Pendente; onSalvo: () => void }) {
  const [qtd, setQtd] = useState('')
  const [motivo, setMotivo] = useState('')
  const [estado, setEstado] = useState<{ ok: true; diferenca: number } | { ok: false; erro: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const salvar = async () => {
    const n = Number(qtd.replace(',', '.'))
    if (qtd.trim() === '' || !Number.isFinite(n) || n < 0) { setEstado({ ok: false, erro: 'Digite a quantidade contada (0 ou mais).' }); return }
    setEnviando(true)
    try {
      const r = await api<{ diferenca: number }>('dash/contagem', { method: 'POST', body: JSON.stringify({ idmercadoriavariacao: item.idmercadoriavariacao, qtd_contada: n, motivo: motivo || null }) })
      setEstado({ ok: true, diferenca: r.diferenca })
    } catch (e) { setEstado({ ok: false, erro: e instanceof Error ? e.message : 'Não foi possível salvar.' }) }
    finally { setEnviando(false) }
  }
  const id = `qtd-${item.idmercadoriavariacao}`
  return (
    <li className="count-item">
      <div className="count-head">
        <ClasseTag classe={item.classe} />
        <div className="count-name"><ItemLink id={item.idmercadoriavariacao}>{item.descricao || `Variação ${item.idmercadoriavariacao}`}</ItemLink>
          <small>{item.codigobarras || 'sem código de barras'} · {item.secao || 'sem seção'} · {item.ultima_contagem ? `contado em ${new Date(item.ultima_contagem).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' })}` : 'nunca contado'}</small></div>
      </div>
      {estado?.ok ? (
        <p className={`count-result ${estado.diferenca === 0 ? 'status-good' : 'status-warn'}`} role="status">
          <Check size={16} aria-hidden /> Salvo. {estado.diferenca === 0 ? 'Bate com o sistema.' : `Diferença de ${dec(estado.diferenca)} para o sistema: ajuste no ERP depois de recontar.`}
          <button type="button" className="btn secondary" onClick={onSalvo}>Próximo</button>
        </p>
      ) : (
        <form className="count-form" onSubmit={e => { e.preventDefault(); salvar() }}>
          <label htmlFor={id}>Quantidade na prateleira</label>
          <input id={id} className="input" inputMode="decimal" autoComplete="off" value={qtd} onChange={e => setQtd(e.target.value)} placeholder="0" />
          <label htmlFor={`${id}-m`}>Motivo, se houver diferença</label>
          <select id={`${id}-m`} className="select" value={motivo} onChange={e => setMotivo(e.target.value)}>{MOTIVOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
          <button className="btn" type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar contagem'}</button>
          {estado && !estado.ok && <p className="error-box" role="alert">{estado.erro}</p>}
        </form>
      )}
    </li>
  )
}

function Contar() {
  const [classe, setClasse] = useParam('classe')
  const [busca, setBusca] = useParam('busca')
  const qs = new URLSearchParams()
  if (classe) qs.set('classe', classe); if (busca) qs.set('busca', busca)
  const { data: d, error, reload } = useApi<Lista>(`dash/contagem?${qs}`)
  return (
    <>
      {d && (
        <div className="metrics" style={{ marginBottom: 18 }}>
          {CLASSES.map(c => (
            <Metric key={c.id} icon={<ClipboardCheck size={18} />} tone={c.id === 'A' ? 'turquoise' : 'blue'} label={`${c.nome}: a contar`}
              value={int(d.pendentes[c.id])} detail={`cerca de ${int(d.por_dia[c.id])} por dia útil`}
              onClick={() => setClasse(classe === c.id ? '' : c.id)} pressed={classe === c.id} />
          ))}
          <Metric icon={<ScanLine size={18} />} tone="gold" label="Hoje" value={`${int(d.por_dia.A + d.por_dia.B + d.por_dia.C)} itens`} detail="A todo mês, B a cada trimestre, C uma vez por ano" />
        </div>
      )}
      <p className="hint">Conte sem olhar o saldo do sistema: a diferença aparece só depois de salvar. Diferença encontrada pede uma recontagem por outra pessoa antes do ajuste no ERP.</p>
      <div className="controls"><SearchBox value={busca} onChange={setBusca} placeholder="Buscar ou ler código do produto" /></div>
      {error ? <ErrorState message={error} onRetry={reload} /> : !d ? <Loading /> : d.lista.length === 0 ? <Empty>Nada para contar com esses filtros.</Empty> : (
        <ul className="count-list">{d.lista.map(i => <ItemContagem key={i.idmercadoriavariacao} item={i} onSalvo={reload} />)}</ul>
      )}
    </>
  )
}

function Resultado() {
  const { data: d, error, reload } = useApi<Conc>('dash/conciliacao')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!d) return <Loading />
  if (!d.acuracia.length) return <Empty>Nenhuma contagem registrada ainda. Comece pela aba Contar hoje.</Empty>
  return (
    <>
      <section className="panel" aria-labelledby="acur-h">
        <h2 id="acur-h">Acurácia do estoque</h2>
        <p>Itens contados sem diferença ÷ itens contados. Meta: 98% na classe A e 95% nas demais.</p>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Acurácia por mês e classe</caption>
            <thead><tr><th>Mês</th><th>Classe</th><th className="r">Contados</th><th className="r">Sem diferença</th><th className="r">Acurácia</th><th className="r">Diferença em R$</th><th className="r">Saldo (sobra − falta)</th></tr></thead>
            <tbody>{d.acuracia.map(a => (
              <tr key={`${a.mes}-${a.classe}`}>
                <td>{a.mes.slice(5)}/{a.mes.slice(0, 4)}</td><td><ClasseTag classe={a.classe} /></td><td className="r">{int(a.contados)}</td><td className="r">{int(a.sem_divergencia)}</td>
                <td className="r"><span className={Number(a.acuracia_pct) >= (META[a.classe] ?? 95) ? 'status-good' : 'status-bad'}>{pct(a.acuracia_pct)}</span></td>
                <td className="r">{brl(a.valor_divergente)}</td><td className="r">{brl(a.saldo_divergencia)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="panel section" aria-labelledby="ult-h">
        <h2 id="ult-h">Últimas contagens</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Últimas contagens</caption>
            <thead><tr><th>Produto</th><th className="r">Contado</th><th className="r">Sistema</th><th className="r">Diferença</th><th>Motivo</th><th>Quem e quando</th></tr></thead>
            <tbody>{d.ultimas.map(u => (
              <tr key={u.id}>
                <td className="wrap"><ItemLink id={u.idmercadoriavariacao}>{u.descricao || `Variação ${u.idmercadoriavariacao}`}</ItemLink></td>
                <td className="r">{dec(u.qtd_contada)}</td><td className="r">{dec(u.qtd_sistema)}</td>
                <td className="r"><span className={u.diferenca === 0 ? 'status-good' : 'status-bad'}>{u.diferenca > 0 ? '+' : ''}{dec(u.diferenca)}</span></td>
                <td>{MOTIVOS.find(m => m.id === (u.motivo ?? ''))?.nome ?? u.motivo}</td>
                <td>{u.contado_por ?? '—'}<small>{new Date(u.contado_em).toLocaleString('pt-BR', { timeZone: 'America/Belem', dateStyle: 'short', timeStyle: 'short' })}</small></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default function Conciliacao() {
  const [aba, setAba] = useParam('aba', 'contar')
  return (
    <>
      <PageHead section="CONCILIAÇÃO" title="Conciliação do estoque"
        actions={<Tabs label="Visão" value={aba} onChange={setAba} options={[{ id: 'contar', label: 'Contar hoje' }, { id: 'resultado', label: 'Acurácia' }]} />}>
        Contagem cíclica pela curva ABC: uma parte dos itens por dia, sem parar a loja. O ajuste continua sendo feito no ERP; aqui fica o registro da contagem e a acurácia.
      </PageHead>
      {aba === 'resultado' ? <Resultado /> : <Contar />}
    </>
  )
}
