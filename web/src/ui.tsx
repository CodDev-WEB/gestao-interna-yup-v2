import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="state" aria-busy="true" aria-label="Carregando">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ margin: '10px 0', width: `${90 - i * 12}%` }} />)}</div>
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state error" role="alert">{message}{onRetry && <> <button className="btn btn-ghost" style={{ marginLeft: 10 }} onClick={onRetry}>Tentar de novo</button></>}</div>
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

export type Col<T> = { key: string; label: string; right?: boolean; wrap?: boolean; sort?: boolean; render: (r: T) => ReactNode }

/** Tabela com ordenação pela coluna e paginação (dados vindos do servidor). */
export function DataTable<T>({ cols, rows, total, page, pageSize, onPage, sort, dir, onSort, rowKey, caption }: {
  cols: Col<T>[]; rows: T[]; total: number; page: number; pageSize: number; onPage: (p: number) => void
  sort?: string; dir?: string; onSort?: (key: string) => void; rowKey: (r: T) => string; caption: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <>
      <div className="table-wrap">
        <table>
          <caption style={{ position: 'absolute', left: -9999 }}>{caption}</caption>
          <thead>
            <tr>{cols.map(c => (
              <th key={c.key} className={c.right ? 'r' : ''} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sort && onSort ? <button onClick={() => onSort(c.key)}>{c.label}{sort === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</button> : c.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map(r => <tr key={rowKey(r)}>{cols.map(c => <td key={c.key} className={[c.right ? 'r' : '', c.wrap ? 'wrap' : ''].join(' ')}>{c.render(r)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>{total.toLocaleString('pt-BR')} {total === 1 ? 'item' : 'itens'}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
          Página {page} de {pages}
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</button>
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
  const page = Math.max(1, Number(pagina) || 1)
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc') } }
  return { sort, dir, page, onSort, onPage: (p: number) => setPagina(String(p)) }
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value)
  return (
    <form role="search" onSubmit={e => { e.preventDefault(); onChange(v.trim()) }} style={{ display: 'flex', gap: 8 }}>
      <input className="input" type="search" value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button className="btn btn-ghost" type="submit">Buscar</button>
    </form>
  )
}
