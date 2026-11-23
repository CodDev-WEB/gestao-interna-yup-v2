// Exportação para Excel (.xlsx) e PDF. As bibliotecas só carregam quando alguém clica em baixar.
// Valores em reais vão para o Excel como número com formato de moeda (somáveis), não como texto.

export type Tipo = 'texto' | 'moeda' | 'numero' | 'inteiro' | 'pct' | 'data'
export type Coluna = { chave: string; titulo: string; tipo: Tipo }
export type Secao = { nome: string; colunas: Coluna[]; linhas: Record<string, unknown>[]; totais?: Record<string, unknown> | null }
export type Documento = { titulo: string; subtitulo?: string; secoes: Secao[]; arquivo: string }

const FMT_EXCEL: Record<Tipo, string | undefined> = { texto: undefined, moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00', numero: '#,##0.###', inteiro: '#,##0', pct: '0.00"%"', data: 'dd/mm/yyyy' }

const nomeArquivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'relatorio'
const carimbo = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' })

function valorNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Texto para PDF/tela, no padrão brasileiro. */
export function textoCelula(v: unknown, tipo: Tipo): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = valorNumero(v)
  switch (tipo) {
    case 'moeda': return n === null ? String(v) : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    case 'inteiro': return n === null ? String(v) : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
    case 'numero': return n === null ? String(v) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    case 'pct': return n === null ? String(v) : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    case 'data': { const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s }
    default: return String(v)
  }
}

export async function baixarExcel(doc: Documento) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const usados = new Set<string>()
  for (const s of doc.secoes) {
    const aoa: unknown[][] = [[doc.titulo], [doc.subtitulo ?? ''], [`Gerado em ${carimbo()}`], [], s.colunas.map(c => c.titulo)]
    const conv = (v: unknown, c: Coluna) => {
      if (c.tipo === 'texto') return v ?? ''
      if (c.tipo === 'data') { const t = String(v ?? ''); return /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(t.slice(0, 10) + 'T12:00:00') : t }
      return valorNumero(v) ?? ''
    }
    for (const l of s.linhas) aoa.push(s.colunas.map(c => conv(l[c.chave], c)))
    if (s.totais) aoa.push(s.colunas.map((c, i) => i === 0 && c.tipo === 'texto' && (s.totais![c.chave] === undefined) ? 'Total' : conv(s.totais![c.chave], c)))
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
    const inicio = 5
    s.colunas.forEach((c, ci) => {
      const z = FMT_EXCEL[c.tipo]; if (!z) return
      for (let r = inicio; r < aoa.length; r++) { const ref = XLSX.utils.encode_cell({ r, c: ci }); if (ws[ref] && ws[ref].t !== 's') ws[ref].z = z }
    })
    ws['!cols'] = s.colunas.map(c => ({ wch: Math.min(60, Math.max(c.titulo.length + 2, c.tipo === 'texto' ? 28 : 14)) }))
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: inicio - 1, c: 0 }, e: { r: Math.max(inicio - 1, aoa.length - 1 - (s.totais ? 1 : 0)), c: Math.max(0, s.colunas.length - 1) } }) }
    let nome = (s.nome || 'Dados').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Dados'
    for (let i = 2; usados.has(nome); i++) nome = `${nome.slice(0, 28)} ${i}`
    usados.add(nome)
    XLSX.utils.book_append_sheet(wb, ws, nome)
  }
  XLSX.writeFile(wb, `${nomeArquivo(doc.arquivo)}.xlsx`)
}

export async function baixarPdf(doc: Documento) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const largas = doc.secoes.some(s => s.colunas.length > 6)
  const pdf = new jsPDF({ orientation: largas ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const w = pdf.internal.pageSize.getWidth()
  let y = 40
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text(doc.titulo, 40, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110)
  if (doc.subtitulo) { y += 16; pdf.text(pdf.splitTextToSize(doc.subtitulo, w - 80), 40, y) }
  y += 14; pdf.text(`YUP Intelligence · gerado em ${carimbo()}`, 40, y)
  pdf.setTextColor(0)
  y += 14
  for (const s of doc.secoes) {
    if (doc.secoes.length > 1) { y += 10; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(s.nome, 40, y); y += 6; pdf.setFont('helvetica', 'normal') }
    autoTable(pdf, {
      startY: y + 4,
      head: [s.colunas.map(c => c.titulo)],
      body: s.linhas.map(l => s.colunas.map(c => textoCelula(l[c.chave], c.tipo))),
      foot: s.totais ? [s.colunas.map((c, i) => s.totais![c.chave] !== undefined ? textoCelula(s.totais![c.chave], c.tipo) : i === 0 ? 'Total' : '')] : undefined,
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [11, 127, 137], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 247], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      columnStyles: Object.fromEntries(s.colunas.map((c, i) => [i, { halign: c.tipo === 'texto' || c.tipo === 'data' ? 'left' : 'right' }])),
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        const h = pdf.internal.pageSize.getHeight()
        pdf.setFontSize(8); pdf.setTextColor(140)
        pdf.text(`${doc.titulo} · página ${pdf.getNumberOfPages()}`, 40, h - 20)
        pdf.setTextColor(0)
      },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }
  pdf.save(`${nomeArquivo(doc.arquivo)}.pdf`)
}

// ---------- Exportar o que está na tela (botões de cada aba) ----------

/** Converte o texto mostrado ("R$ 1.234,56", "12,5%", "1.234") de volta em número e tipo. */
export function lerTexto(t: string): { v: unknown; tipo: Tipo } {
  const s = t.replace(/ /g, ' ').replace(/−/g, '-').trim()
  let m = /^(-?)\s*R\$\s*(-?)([\d.]+(?:,\d+)?)$/.exec(s)
  if (m) return { v: Number((m[1] || m[2] ? '-' : '') + m[3].replace(/\./g, '').replace(',', '.')), tipo: 'moeda' }
  m = /^(-?[\d.]+(?:,\d+)?)\s*%$/.exec(s)
  if (m) return { v: Number(m[1].replace(/\./g, '').replace(',', '.')), tipo: 'pct' }
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^-?\d+(,\d+)?$/.test(s)) return { v: Number(s.replace(/\./g, '').replace(',', '.')), tipo: s.includes(',') ? 'numero' : 'inteiro' }
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (m) return { v: `${m[3]}-${m[2]}-${m[1]}`, tipo: 'data' }
  return { v: s, tipo: 'texto' }
}

function textoDe(el: Element) {
  // Texto principal e o detalhe (<small>) separados por " · ".
  const partes: string[] = []
  const principal = Array.from(el.childNodes).filter(n => !(n instanceof HTMLElement && n.tagName === 'SMALL')).map(n => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
  if (principal) partes.push(principal)
  el.querySelectorAll('small').forEach(s => { const x = (s.textContent ?? '').trim(); if (x) partes.push(x) })
  return { principal, completo: partes.join(' · ') }
}

/** Lê os indicadores e as tabelas visíveis da página atual. */
export function lerPagina(root: HTMLElement): Secao[] {
  const secoes: Secao[] = []
  const metricas = Array.from(root.querySelectorAll('.metric')).map(m => ({
    indicador: (m.querySelector('.metric-label, .label, dt, span')?.textContent ?? '').trim(),
    valor: (m.querySelector('.metric-value, .value, dd, strong, b')?.textContent ?? '').trim(),
    detalhe: (m.querySelector('.metric-detail, .detail, small, p')?.textContent ?? '').trim(),
  })).filter(x => x.indicador || x.valor)
  if (metricas.length) secoes.push({ nome: 'Resumo', colunas: [{ chave: 'indicador', titulo: 'Indicador', tipo: 'texto' }, { chave: 'valor', titulo: 'Valor', tipo: 'texto' }, { chave: 'detalhe', titulo: 'Detalhe', tipo: 'texto' }], linhas: metricas })
  root.querySelectorAll('table').forEach((t, ti) => {
    if (t.closest('[aria-hidden="true"]')) return
    const nome = (t.querySelector('caption')?.textContent ?? '').trim() || `Tabela ${ti + 1}`
    const head = Array.from(t.querySelectorAll('thead tr:last-child th'))
    const titulos = head.map((h, i) => (h.textContent ?? '').trim() || (i === 0 ? 'Item' : `Coluna ${i + 1}`))
    const linhasEl = Array.from(t.querySelectorAll('tbody tr'))
    if (!linhasEl.length) return
    const brutas = linhasEl.map(tr => Array.from(tr.children).map(td => textoDe(td)))
    const n = Math.max(titulos.length, ...brutas.map(b => b.length))
    // Tipo da coluna: número só se todas as células preenchidas forem número do mesmo tipo.
    const tipos: Tipo[] = Array.from({ length: n }, (_, ci) => {
      const ts = brutas.map(b => b[ci]?.principal ?? '').filter(x => x && x !== '—').map(x => lerTexto(x).tipo)
      return ts.length && ts.every(x => x === ts[0]) ? ts[0] : ts.length && ts.every(x => x === 'inteiro' || x === 'numero') ? 'numero' : 'texto'
    })
    const colunas: Coluna[] = Array.from({ length: n }, (_, ci) => ({ chave: `c${ci}`, titulo: titulos[ci] ?? `Coluna ${ci + 1}`, tipo: tipos[ci] }))
    // Coluna de texto com detalhe ganha uma coluna "Detalhe" ao lado.
    const comDetalhe = colunas.map((c, ci) => c.tipo === 'texto' && brutas.some(b => b[ci] && b[ci].completo !== b[ci].principal))
    const colsFinal: Coluna[] = []
    colunas.forEach((c, ci) => { colsFinal.push(c); if (comDetalhe[ci]) colsFinal.push({ chave: `d${ci}`, titulo: `${c.titulo} (detalhe)`, tipo: 'texto' }) })
    const linhas = brutas.map(b => {
      const o: Record<string, unknown> = {}
      colunas.forEach((c, ci) => {
        const cel = b[ci]; if (!cel) return
        o[c.chave] = c.tipo === 'texto' ? cel.principal : cel.principal === '—' ? null : lerTexto(cel.principal).v
        if (comDetalhe[ci]) o[`d${ci}`] = cel.completo.slice(cel.principal.length).replace(/^ · /, '')
      })
      return o
    })
    const foot = t.querySelector('tfoot tr')
    let totais: Record<string, unknown> | null = null
    if (foot) {
      totais = {}
      Array.from(foot.children).forEach((td, ci) => { const x = textoDe(td).principal; const c = colunas[ci]; if (c && x) totais![c.chave] = c.tipo === 'texto' ? x : lerTexto(x).v })
    }
    secoes.push({ nome, colunas: colsFinal, linhas, totais })
  })
  return secoes
}
