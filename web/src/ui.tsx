import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RotateCw, Search } from 'lucide-react'
import logo from './assets/logo-yupee.png'
import { ExportarPagina } from './Exportar'
import { paginaAtual } from './nav'

/** Logo Yupee + nome do sistema (mesmo padrão do Gestão à Vista). */
export function Brand() {
  return <><img className="brand-logo" src={logo} alt="" /><div><strong>Yup <span>Intelligence</span></strong><small>Gestão interna</small></div></>
}

/** Cabeçalho de página: trilha, título, descrição e ações. */
/** Texto explicativo da página, sempre inteiro: nada de informação escondida em "ver mais". */
function Explicacao({ children }: { children: ReactNode }) {
  return <div className="page-desc"><p>{children}</p></div>
}

export function PageHead({ section, title, children, actions }: { section?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  const { pathname } = useLocation()
  const grupo = paginaAtual(pathname)?.grupo ?? null
  const eyebrow = grupo ?? (section && section.toUpperCase() !== title.toUpperCase() ? section : null)
  return (
    <header className="page-head">
      <div className="page-title">
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <Explicacao>{children}</Explicacao>}
      </div>
      <div className="page-actions">{actions}<ExportarPagina titulo={title} /></div>
    </header>
  )
}

export type Tone = 'gold' | 'green' | 'blue' | 'purple' | 'turquoise' | 'red'

/** Cartão de indicador com ícone, como os do Gestão à Vista. Vira botão quando recebe onClick. */
export function Metric({ icon, tone = 'turquoise', label, value, detail, valueClass, onClick, pressed }: {
  icon: ReactNode; tone?: Tone; label: string; value: ReactNode; detail?: ReactNode; valueClass?: string; onClick?: () => void; pressed?: boolean
}) {
  const body = <><div className={`metric-icon ${tone}`} aria-hidden>{icon}</div><span className="metric-label">{label}</span><strong className={`metric-value ${valueClass ?? ''}`}>{value}</strong>{detail !== undefined && <span className="metric-detail">{detail}</span>}</>
  return onClick
    ? <button type="button" className="metric" onClick={onClick} aria-pressed={pressed}>{body}</button>
    : <div className="metric">{body}</div>
}

/** Abas segmentadas (período, visão). */
export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <div className="tabs" role="group" aria-label={label}>{options.map(o => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="state" aria-busy="true" aria-label="Carregando">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ margin: '10px 0', width: `${90 - i * 12}%` }} />)}</div>
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state error" role="alert"><AlertCircle size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} aria-hidden />{message}{onRetry && <button className="btn secondary" onClick={onRetry}><RotateCw size={15} aria-hidden />Tentar de novo</button>}</div>
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>
}

/** Estado na URL (filtros compartilháveis e preservados ao voltar). */
export function useParam(name: string, def = ''): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  const value = sp.get(name) ?? def
  const set = (v: string) => setSp(prev => {
    const next = new URLSearchParams(prev)
    if (v && v !== def) next.set(name, v); else next.delete(name)
    if (name !== 'pagina') next.delete('pagina')
    return next
  }, { replace: true })
  return [value, set]
}

/** sm: false esconde a coluna nos cartões do celular (dado secundário). */
/** extra: coluna secundária; aparece por padrão e some quando a pessoa pede "Ocultar colunas". */
export type Col<T> = { key: string; label: string; right?: boolean; wrap?: boolean; sort?: boolean; sm?: false; extra?: boolean; className?: string; render: (r: T) => ReactNode }

/** Quantas linhas por página a pessoa pode escolher (a API aceita até 200). */
export const PAGE_SIZES = [50, 100, 200]

/** Tabela com ordenação e paginação do servidor. No celular, cada linha vira um cartão. */
export function DataTable<T>({ cols, rows, total, page, pageSize, onPage, onPageSize, sort, dir, onSort, rowKey, caption, busy }: {
  cols: Col<T>[]; rows: T[]; total: number; page: number; pageSize: number; onPage: (p: number) => void
  /** Troca quantas linhas vêm por página (50/100/200). */
  onPageSize?: (n: number) => void
  sort?: string; dir?: string; onSort?: (key: string) => void; rowKey: (r: T) => string; caption: string
  /** true enquanto uma nova página/filtro carrega: a tabela atual fica esmaecida. */
  busy?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  // Sistema de análise: todas as colunas aparecem por padrão; a pessoa pode reduzir.
  const [mais, setMais] = useState(() => { try { return localStorage.getItem('yup.colunas-reduzidas') !== '1' } catch { return true } })
  const extras = cols.filter(c => c.extra).length
  const alternarMais = () => setMais(m => { try { localStorage.setItem('yup.colunas-reduzidas', m ? '1' : '0') } catch { /* sem storage */ } return !m })
  const de = total === 0 ? 0 : (page - 1) * pageSize + 1, ate = Math.min(total, page * pageSize)
  cols = mais ? cols : cols.filter(c => !c.extra)
  const sortable = cols.filter(c => c.sort)
  const Arrow = dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <>
      {onSort && sortable.length > 0 && (
        <label className="sort-sm">Ordenar por
          <select className="select" value={sort} onChange={e => onSort(e.target.value)}>
            {sortable.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button type="button" className="btn secondary" onClick={() => sort && onSort(sort)} aria-label={dir === 'asc' ? 'Crescente; inverter' : 'Decrescente; inverter'}><Arrow size={16} aria-hidden /></button>
        </label>
      )}
      <div className="pager pager-top">
        <span className="pager-count">{total === 0 ? '0 itens' : <>Linhas <b>{de.toLocaleString('pt-BR')}–{ate.toLocaleString('pt-BR')}</b> de <b>{total.toLocaleString('pt-BR')}</b></>}</span>
        <span>
          {extras > 0 && <button type="button" className="chip" aria-pressed={!mais} onClick={alternarMais}>{mais ? `Ocultar ${extras} ${extras === 1 ? 'coluna' : 'colunas'}` : `Mostrar todas as colunas (+${extras})`}</button>}
          {onPageSize && (
            <label className="pager-size">Por página
              <select className="select" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <button className="btn secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><ChevronLeft size={16} aria-hidden /></button>
          <span className="pager-pos">{page} de {pages}</span>
          <button className="btn secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"><ChevronRight size={16} aria-hidden /></button>
        </span>
      </div>
      <div className="table-wrap table-grid cards-sm" aria-busy={busy || undefined} tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{cols.map(c => (
              <th key={c.key} className={c.right ? 'r' : ''} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sort && onSort ? <button onClick={() => onSort(c.key)}>{c.label}{sort === c.key && <Arrow size={13} aria-hidden />}</button> : c.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map(r => <tr key={rowKey(r)}>{cols.map(c => <td key={c.key} data-label={c.label} className={[c.right ? 'r' : '', c.wrap ? 'wrap' : '', c.sm === false || c.extra ? 'hide-sm' : '', c.className ?? ''].join(' ').trim() || undefined}>{c.render(r)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="pager pager-bottom">
        <span>{total.toLocaleString('pt-BR')} {total === 1 ? 'item' : 'itens'}</span>
        <span>
          <button className="btn secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><ChevronLeft size={16} aria-hidden />Anterior</button>
          {page} de {pages}
          <button className="btn secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">Próxima<ChevronRight size={16} aria-hidden /></button>
        </span>
      </div>
    </>
  )
}

/** Ordenação + paginação guardadas na URL. */
export function useTableState(defSort: string, defDir: 'asc' | 'desc' = 'desc') {
  const [sort, setSort] = useParam('ordem', defSort)
  const [dir, setDir] = useParam('dir', defDir)
  const [pagina, setPagina] = useParam('pagina', '1')
  const [linhas, setLinhas] = useParam('linhas', '50')
  const page = Math.max(1, Number(pagina) || 1)
  const pageSize = PAGE_SIZES.includes(Number(linhas)) ? Number(linhas) : 50
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc') } }
  return { sort, dir, page, pageSize, onSort, onPage: (p: number) => setPagina(String(p)), onPageSize: (n: number) => setLinhas(String(n)) }
}

/** Busca que filtra sozinha enquanto a pessoa digita (Enter aplica na hora). */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value)
  const last = useRef(value)
  useEffect(() => { setV(value); last.current = value }, [value])
  useEffect(() => {
    const t = setTimeout(() => { const q = v.trim(); if (q !== last.current) { last.current = q; onChange(q) } }, 400)
    return () => clearTimeout(t)
  }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form role="search" className="search" onSubmit={e => { e.preventDefault(); const q = v.trim(); last.current = q; onChange(q) }}>
      <Search size={17} aria-hidden />
      <input className="input" type="search" value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  )
}
