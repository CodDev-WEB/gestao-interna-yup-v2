// Botões "Excel" e "PDF" de cada aba: exportam os indicadores e as tabelas que estão na tela.
import { useRef, useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { baixarExcel, baixarPdf, lerPagina } from './exportar'

export function ExportarPagina({ titulo }: { titulo?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ocupado, setOcupado] = useState<'' | 'xlsx' | 'pdf'>('')
  const [aviso, setAviso] = useState('')
  const rodar = async (tipo: 'xlsx' | 'pdf') => {
    const main = ref.current?.closest('main') as HTMLElement | null
    if (!main) return
    const nome = titulo ?? (main.querySelector('h1')?.textContent ?? 'Relatório').trim()
    const secoes = lerPagina(main)
    if (!secoes.length) { setAviso('Nada para exportar nesta tela ainda.'); return }
    const filtros = Array.from(main.querySelectorAll('[aria-pressed="true"], [aria-selected="true"]')).map(e => (e.textContent ?? '').trim()).filter(Boolean)
    const doc = { titulo: nome, subtitulo: [filtros.length ? `Filtros: ${[...new Set(filtros)].join(', ')}` : '', 'Tabelas com páginas trazem a página que está na tela; para a lista completa, use Relatórios.'].filter(Boolean).join(' · '), secoes, arquivo: `${nome} ${new Date().toISOString().slice(0, 10)}` }
    setOcupado(tipo); setAviso('')
    try { await (tipo === 'xlsx' ? baixarExcel(doc) : baixarPdf(doc)) }
    catch (e) { setAviso('Não deu para gerar o arquivo: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setOcupado('') }
  }
  return (
    <div className="export-bar" ref={ref}>
      <button type="button" className="btn secondary small" onClick={() => rodar('xlsx')} disabled={!!ocupado} title="Baixar esta tela em Excel"><FileSpreadsheet size={15} aria-hidden />{ocupado === 'xlsx' ? 'Gerando…' : 'Excel'}</button>
      <button type="button" className="btn secondary small" onClick={() => rodar('pdf')} disabled={!!ocupado} title="Baixar esta tela em PDF"><FileText size={15} aria-hidden />{ocupado === 'pdf' ? 'Gerando…' : 'PDF'}</button>
      {aviso && <span className="export-aviso" role="status">{aviso}</span>}
    </div>
  )
}
