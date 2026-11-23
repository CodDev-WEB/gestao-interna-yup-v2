// Exportação para Excel (.xlsx) e PDF. As bibliotecas só carregam quando alguém clica em baixar.
import logoUrl from './assets/logo-yupee.png'

// Valores em reais vão para o Excel como número com formato de moeda (somáveis), não como texto.

export type Tipo = 'texto' | 'moeda' | 'numero' | 'inteiro' | 'pct' | 'data'
export type Coluna = { chave: string; titulo: string; tipo: Tipo }
/** cartoes: indicadores (rótulo, valor, detalhe) desenhados como cartões no PDF. */
export type Secao = { nome: string; colunas: Coluna[]; linhas: Record<string, unknown>[]; totais?: Record<string, unknown> | null; cartoes?: boolean }
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

// ---------- PDF executivo ----------
// Cabeçalho com a logo, título e informações sem sobreposição (cada bloco mede a própria altura), indicadores em
// cartões, tabelas com respiro entre si e rodapé com "página X de Y". Repete um cabeçalho compacto nas demais páginas.

const COR = { tinta: [29, 29, 31] as const, cinza: [110, 110, 115] as const, linha: [222, 222, 228] as const, fundo: [246, 246, 248] as const, marca: [11, 127, 137] as const, cabecalho: [24, 37, 51] as const }
const MARGEM = 40
/** A fonte do PDF (Helvetica) não tem alguns símbolos: troca o sinal de menos e tira o que não seria desenhado. */
const limpo = (x: unknown) => String(x ?? '').replace(/[\u2212\u2012\u2013]/g, '-').replace(/[^\x00-\xff\u2014\u2026\u2022\u203a\u2018\u2019\u201c\u201d\u20ac]/g, '')

async function logoDataUrl(): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(logoUrl)).blob()
    const url = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = erro; r.readAsDataURL(blob) })
    const img = await new Promise<HTMLImageElement>((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url })
    return { url, w: img.naturalWidth, h: img.naturalHeight }
  } catch { return null }
}

export async function baixarPdf(doc: Documento) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logoDataUrl()])
  const largas = doc.secoes.some(s => !s.cartoes && s.colunas.length > 6)
  const pdf = new jsPDF({ orientation: largas ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight()
  const util = W - 2 * MARGEM
  const gerado = carimbo()
  const cor = (c: readonly number[]) => [c[0], c[1], c[2]] as [number, number, number]

  // Cabeçalho completo (1ª página): logo, marca e data; título; subtítulo quebrado em linhas; filete.
  let y = 34
  const alturaLogo = 30
  if (logo) pdf.addImage(logo.url, 'PNG', MARGEM, y, alturaLogo * logo.w / logo.h, alturaLogo)
  const xMarca = MARGEM + (logo ? alturaLogo * logo.w / logo.h + 10 : 0)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...cor(COR.tinta)); pdf.text('Yup', xMarca, y + 13)
  pdf.setTextColor(...cor(COR.marca)); pdf.text('Intelligence', xMarca + pdf.getTextWidth('Yup '), y + 13)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...cor(COR.cinza)); pdf.text('Gestão interna', xMarca, y + 26)
  pdf.text(`Gerado em ${gerado}`, W - MARGEM, y + 13, { align: 'right' })
  y += alturaLogo + 26
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(...cor(COR.tinta))
  const linhasTitulo = pdf.splitTextToSize(limpo(doc.titulo), util) as string[]
  pdf.text(linhasTitulo, MARGEM, y); y += linhasTitulo.length * 23
  if (doc.subtitulo) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...cor(COR.cinza))
    const linhas = pdf.splitTextToSize(limpo(doc.subtitulo), util) as string[]
    pdf.text(linhas, MARGEM, y - 6); y += linhas.length * 12.5
  }
  pdf.setDrawColor(...cor(COR.marca)); pdf.setLineWidth(1.4); pdf.line(MARGEM, y, MARGEM + 60, y)
  pdf.setDrawColor(...cor(COR.linha)); pdf.setLineWidth(0.6); pdf.line(MARGEM + 60, y, W - MARGEM, y)
  y += 22

  const topoPaginas = 64 // espaço do cabeçalho compacto nas páginas seguintes
  const rodape = 46
  const novaPaginaSePreciso = (altura: number) => { if (y + altura > H - rodape) { pdf.addPage(); y = topoPaginas } }

  const tituloSecao = (nome: string) => {
    novaPaginaSePreciso(60)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12.5); pdf.setTextColor(...cor(COR.tinta)); pdf.text(limpo(nome), MARGEM, y)
    y += 12
  }

  for (const s of doc.secoes) {
    if (s.cartoes) {
      // Indicadores em cartões (até 4 por linha), altura medida pelo maior texto da linha.
      tituloSecao(s.nome)
      const porLinha = Math.min(4, s.linhas.length), gap = 10
      const largura = (util - gap * (porLinha - 1)) / porLinha
      for (let i = 0; i < s.linhas.length; i += porLinha) {
        const linha = s.linhas.slice(i, i + porLinha)
        const medidas = linha.map(c => {
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15)
          const valor = pdf.splitTextToSize(limpo(c.valor ?? '—'), largura - 24) as string[]
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
          const detalhe = c.detalhe ? pdf.splitTextToSize(limpo(c.detalhe), largura - 24) as string[] : []
          pdf.setFontSize(8.5)
          const rotulo = pdf.splitTextToSize(limpo(c.indicador), largura - 24) as string[]
          return { rotulo, valor, detalhe, altura: 16 + rotulo.length * 11 + 4 + valor.length * 18 + (detalhe.length ? 4 + detalhe.length * 10 : 0) + 12 }
        })
        const alt = Math.max(...medidas.map(m => m.altura))
        novaPaginaSePreciso(alt + gap)
        linha.forEach((_, j) => {
          const x = MARGEM + j * (largura + gap), m = medidas[j]
          pdf.setFillColor(...cor(COR.fundo)); pdf.setDrawColor(...cor(COR.linha)); pdf.setLineWidth(0.6)
          pdf.roundedRect(x, y, largura, alt, 6, 6, 'FD')
          let yy = y + 18
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...cor(COR.cinza)); pdf.text(m.rotulo, x + 12, yy); yy += m.rotulo.length * 11 + 6
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...cor(COR.tinta)); pdf.text(m.valor, x + 12, yy + 4); yy += m.valor.length * 18
          if (m.detalhe.length) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...cor(COR.cinza)); pdf.text(m.detalhe, x + 12, yy + 2) }
        })
        y += alt + gap
      }
      y += 14
      continue
    }

    tituloSecao(s.nome)
    const numericas = (c: Coluna) => c.tipo !== 'texto' && c.tipo !== 'data'
    autoTable(pdf, {
      startY: y,
      head: [s.colunas.map(c => limpo(c.titulo))],
      body: s.linhas.map(l => s.colunas.map(c => limpo(textoCelula(l[c.chave], c.tipo)))),
      foot: s.totais ? [s.colunas.map((c, i) => s.totais![c.chave] !== undefined ? limpo(textoCelula(s.totais![c.chave], c.tipo)) : i === 0 ? 'Total' : '')] : undefined,
      showFoot: 'lastPage',
      theme: 'plain',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 7.8, cellPadding: { top: 4.5, bottom: 4.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle', textColor: cor(COR.tinta), lineColor: cor(COR.linha) },
      headStyles: { fillColor: cor(COR.cabecalho), textColor: 255, fontStyle: 'bold', fontSize: 7.8, valign: 'bottom' },
      footStyles: { fillColor: cor(COR.fundo), textColor: cor(COR.tinta), fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      bodyStyles: { lineWidth: { bottom: 0.4 } },
      columnStyles: Object.fromEntries(s.colunas.map((c, i) => [i, numericas(c) ? { halign: 'right', cellWidth: 'wrap' } : c.tipo === 'data' ? { cellWidth: 'wrap' } : {}])),
      didParseCell: d => { if (d.section === 'head' && numericas(s.colunas[d.column.index])) d.cell.styles.halign = 'right' },
      margin: { left: MARGEM, right: MARGEM, top: topoPaginas, bottom: rodape },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28
  }

  // Cabeçalho compacto (da 2ª página em diante) e rodapé em todas, com o total de páginas.
  const total = pdf.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p)
    if (p > 1) {
      if (logo) pdf.addImage(logo.url, 'PNG', MARGEM, 22, 20 * logo.w / logo.h, 20)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...cor(COR.tinta))
      pdf.text(limpo(doc.titulo), MARGEM + (logo ? 20 * logo.w / logo.h + 8 : 0), 36, { maxWidth: util - 160 })
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...cor(COR.cinza)); pdf.text(`Gerado em ${gerado}`, W - MARGEM, 36, { align: 'right' })
      pdf.setDrawColor(...cor(COR.linha)); pdf.setLineWidth(0.6); pdf.line(MARGEM, 48, W - MARGEM, 48)
    }
    pdf.setDrawColor(...cor(COR.linha)); pdf.setLineWidth(0.6); pdf.line(MARGEM, H - 30, W - MARGEM, H - 30)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...cor(COR.cinza))
    pdf.text('Yup Intelligence · Gestão interna · valores conforme o ERP', MARGEM, H - 18)
    pdf.text(`Página ${p} de ${total}`, W - MARGEM, H - 18, { align: 'right' })
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
  // Texto principal, o detalhe (<small>) separados por " · " e o código do produto (etiqueta .cod), à parte.
  const copia = el.cloneNode(true) as HTMLElement
  const codigo = (copia.querySelector('.cod')?.textContent ?? '').trim()
  copia.querySelectorAll('.cod, small').forEach(x => x.remove())
  const principal = (copia.textContent ?? '').replace(/\s+/g, ' ').trim()
  const partes: string[] = principal ? [principal] : []
  el.querySelectorAll('small').forEach(s => { const x = (s.textContent ?? '').trim(); if (x) partes.push(x) })
  return { principal, completo: partes.join(' · '), codigo }
}

/** Lê os indicadores e as tabelas visíveis da página atual. */
export function lerPagina(root: HTMLElement): Secao[] {
  const secoes: Secao[] = []
  const metricas = Array.from(root.querySelectorAll('.metric')).map(m => ({
    indicador: (m.querySelector('.metric-label, .label, dt, span')?.textContent ?? '').trim(),
    valor: (m.querySelector('.metric-value, .value, dd, strong, b')?.textContent ?? '').trim(),
    detalhe: (m.querySelector('.metric-detail, .detail, small, p')?.textContent ?? '').trim(),
  })).filter(x => x.indicador || x.valor)
  if (metricas.length) secoes.push({ nome: 'Resumo', colunas: [{ chave: 'indicador', titulo: 'Indicador', tipo: 'texto' }, { chave: 'valor', titulo: 'Valor', tipo: 'texto' }, { chave: 'detalhe', titulo: 'Detalhe', tipo: 'texto' }], linhas: metricas, cartoes: true })
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
    // Coluna com etiqueta de código do produto ganha a coluna "Código" antes dela.
    const comCodigo = colunas.map((_, ci) => brutas.some(b => b[ci]?.codigo))
    colunas.forEach((c, ci) => { if (comCodigo[ci]) colsFinal.push({ chave: `k${ci}`, titulo: 'Código', tipo: 'texto' }); colsFinal.push(c); if (comDetalhe[ci]) colsFinal.push({ chave: `d${ci}`, titulo: `${c.titulo} (detalhe)`, tipo: 'texto' }) })
    const linhas = brutas.map(b => {
      const o: Record<string, unknown> = {}
      colunas.forEach((c, ci) => {
        const cel = b[ci]; if (!cel) return
        o[c.chave] = c.tipo === 'texto' ? cel.principal : cel.principal === '—' ? null : lerTexto(cel.principal).v
        if (comDetalhe[ci]) o[`d${ci}`] = cel.completo.slice(cel.principal.length).replace(/^ · /, '')
        if (comCodigo[ci]) o[`k${ci}`] = cel.codigo
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
  // Listas (sugestões, estoque por situação da Visão geral etc.): uma tabela por lista.
  root.querySelectorAll('ul.inset').forEach((ul, ui) => {
    if (ul.closest('[aria-hidden="true"]')) return
    const linhas = Array.from(ul.querySelectorAll(':scope > li')).map(li => {
      const main = li.querySelector('.row-main'), val = li.querySelector('.row-val')
      if (!main) return null
      const valCopia = val?.cloneNode(true) as HTMLElement | undefined
      valCopia?.querySelectorAll('small').forEach(x => x.remove())
      return {
        item: (main.querySelector('strong')?.textContent ?? main.textContent ?? '').trim(),
        descricao: Array.from(main.children).filter(x => x.tagName !== 'STRONG').map(x => x.textContent ?? '').join(' ').trim(),
        valor: (valCopia?.textContent ?? '').trim(),
        detalhe: (val?.querySelector('small')?.textContent ?? '').trim(),
      }
    }).filter(Boolean) as Record<string, unknown>[]
    if (!linhas.length) return
    const titulo = (ul.closest('section')?.querySelector('h2, h3')?.textContent ?? '').trim() || `Lista ${ui + 1}`
    secoes.push({ nome: titulo, colunas: [{ chave: 'item', titulo: 'Item', tipo: 'texto' }, { chave: 'descricao', titulo: 'Descrição', tipo: 'texto' }, { chave: 'valor', titulo: 'Valor', tipo: 'texto' }, { chave: 'detalhe', titulo: 'Detalhe', tipo: 'texto' }], linhas })
  })
  return secoes
}
