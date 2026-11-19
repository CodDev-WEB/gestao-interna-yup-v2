type N = number | string | null | undefined
const num = (v: N) => (v === null || v === undefined || v === '' ? null : Number(v))

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl0Fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export const brl = (v: N) => { const n = num(v); return n === null ? '—' : brlFmt.format(n) }
export const brl0 = (v: N) => { const n = num(v); return n === null ? '—' : brl0Fmt.format(n) }
/** R$ 1,2 mi / R$ 350 mil para números grandes. */
export const brlCurto = (v: N) => {
  const n = num(v); if (n === null) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `R$\u00a0${decFmt.format(n / 1e6)}\u00a0mi`
  if (a >= 1e4) return `R$\u00a0${intFmt.format(n / 1e3)}\u00a0mil`
  return brl0Fmt.format(n)
}
export const int = (v: N) => { const n = num(v); return n === null ? '—' : intFmt.format(n) }
export const dec = (v: N) => { const n = num(v); return n === null ? '—' : decFmt.format(n) }
export const pct = (v: N, casas = 1) => { const n = num(v); return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}%` }

export const data = (v: string | null | undefined) => {
  if (!v) return '—'
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export const dataCurta = (v: string) => { const [, m, d] = v.split('-'); return `${d}/${m}` }
export const mes = (v: string) => new Date(v.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '')

export const haQuanto = (iso: string | null | undefined) => {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}

/** Variação percentual entre dois valores (null se não dá para comparar). */
export const variacao = (atual: number, anterior: number) => (anterior ? (atual / anterior - 1) * 100 : null)
