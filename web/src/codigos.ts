// Código interno do ERP (idmercadoria) por variação: carregado uma vez por sessão e mostrado na frente do nome,
// para achar o produto no ERP.

import { useEffect, useState } from 'react'
import { api } from './api'

const CHAVE = 'yup-codigos-v1'
let mapa: Map<number, number> | null = null
let carregando: Promise<Map<number, number>> | null = null
const ouvintes = new Set<() => void>()

function deLista(l: number[]) { const m = new Map<number, number>(); for (let i = 0; i + 1 < l.length; i += 2) m.set(l[i], l[i + 1]); return m }

function carregar() {
  if (mapa) return Promise.resolve(mapa)
  if (!carregando) {
    try { const s = sessionStorage.getItem(CHAVE); if (s) { mapa = deLista(JSON.parse(s)); return Promise.resolve(mapa) } } catch { /* sem storage */ }
    carregando = api<number[]>('dash/codigos').then(l => {
      try { sessionStorage.setItem(CHAVE, JSON.stringify(l)) } catch { /* cheio ou bloqueado */ }
      mapa = deLista(l); ouvintes.forEach(f => f()); return mapa
    }).catch(e => { carregando = null; throw e })
  }
  return carregando
}

/** Código interno do ERP da variação (null enquanto carrega ou se não houver). */
export function useCodigo(variacao: number | string): number | null {
  const [, setT] = useState(0)
  useEffect(() => {
    if (mapa) return
    const f = () => setT(t => t + 1)
    ouvintes.add(f); carregar().catch(() => undefined)
    return () => { ouvintes.delete(f) }
  }, [])
  return mapa?.get(Number(variacao)) ?? null
}
