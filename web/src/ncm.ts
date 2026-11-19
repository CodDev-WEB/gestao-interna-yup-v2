// Nomes dos níveis do NCM usados como grupo (capítulo, 2 dígitos) e subgrupo (posição, 4 dígitos).
// Capítulos: nomes resumidos da Nomenclatura Comum do Mercosul. Posições: as mais comuns em pet shop;
// as demais usam a descrição oficial do NCM que vem do ERP.

export const CAPITULOS: Record<string, string> = {
  '01': 'Animais vivos', '02': 'Carnes', '03': 'Peixes e crustáceos', '04': 'Leite, ovos e mel', '05': 'Outros produtos de origem animal',
  '06': 'Plantas vivas e flores', '07': 'Hortícolas', '08': 'Frutas', '09': 'Café, chá e especiarias', '10': 'Cereais',
  '11': 'Produtos da moagem', '12': 'Sementes, grãos e forragens', '13': 'Gomas e resinas', '14': 'Matérias para entrançar', '15': 'Gorduras e óleos',
  '16': 'Preparações de carne e peixe', '17': 'Açúcares e confeitaria', '18': 'Cacau', '19': 'Preparações de cereais e biscoitos', '20': 'Preparações de hortícolas e frutas',
  '21': 'Preparações alimentícias diversas', '22': 'Bebidas', '23': 'Rações e alimentos para animais', '24': 'Fumo', '25': 'Sal, terras, pedras e areias',
  '26': 'Minérios', '27': 'Combustíveis minerais', '28': 'Químicos inorgânicos', '29': 'Químicos orgânicos', '30': 'Produtos farmacêuticos',
  '31': 'Adubos', '32': 'Tintas e corantes', '33': 'Perfumaria, higiene e cosméticos', '34': 'Sabões e produtos de limpeza', '35': 'Colas e enzimas',
  '36': 'Pólvoras e fósforos', '37': 'Produtos fotográficos', '38': 'Químicos diversos (inseticidas, desinfetantes)', '39': 'Plásticos e suas obras', '40': 'Borracha e suas obras',
  '41': 'Peles e couros', '42': 'Artigos de couro, seleiro e bolsas', '43': 'Peleteria', '44': 'Madeira e suas obras', '45': 'Cortiça',
  '46': 'Cestaria', '47': 'Pastas de celulose', '48': 'Papel e cartão', '49': 'Livros e impressos', '50': 'Seda',
  '51': 'Lã', '52': 'Algodão', '53': 'Outras fibras vegetais', '54': 'Filamentos sintéticos', '55': 'Fibras sintéticas',
  '56': 'Feltros, cordas e cordéis', '57': 'Tapetes', '58': 'Tecidos especiais', '59': 'Tecidos técnicos', '60': 'Tecidos de malha',
  '61': 'Vestuário de malha', '62': 'Vestuário', '63': 'Outros artefatos têxteis', '64': 'Calçados', '65': 'Chapéus',
  '66': 'Guarda-chuvas', '67': 'Penas e flores artificiais', '68': 'Obras de pedra e cimento', '69': 'Cerâmica', '70': 'Vidro',
  '71': 'Joias e bijuterias', '72': 'Ferro e aço', '73': 'Obras de ferro e aço', '74': 'Cobre', '75': 'Níquel', '76': 'Alumínio',
  '78': 'Chumbo', '79': 'Zinco', '80': 'Estanho', '81': 'Outros metais', '82': 'Ferramentas e cutelaria', '83': 'Obras diversas de metais',
  '84': 'Máquinas e aparelhos mecânicos', '85': 'Máquinas e aparelhos elétricos', '86': 'Veículos ferroviários', '87': 'Veículos', '88': 'Aeronaves',
  '89': 'Embarcações', '90': 'Instrumentos de óptica, medida e médicos', '91': 'Relógios', '92': 'Instrumentos musicais', '93': 'Armas',
  '94': 'Móveis, camas e iluminação', '95': 'Brinquedos, jogos e esportes', '96': 'Obras diversas (escovas, pentes)', '97': 'Objetos de arte',
}

export const POSICOES: Record<string, string> = {
  '0106': 'Outros animais vivos', '0301': 'Peixes vivos', '0504': 'Tripas e miúdos', '0511': 'Outros produtos de origem animal',
  '1005': 'Milho', '1008': 'Painço, alpiste e outros cereais', '1209': 'Sementes', '1214': 'Feno e forragens',
  '1905': 'Biscoitos e produtos de padaria', '2106': 'Preparações alimentícias diversas', '2308': 'Matérias vegetais para animais',
  '2309': 'Rações e petiscos para animais', '2508': 'Argilas (areias sanitárias)', '2530': 'Matérias minerais',
  '3002': 'Vacinas e soros', '3003': 'Medicamentos (não dosados)', '3004': 'Medicamentos', '3005': 'Curativos e gazes', '3006': 'Preparações farmacêuticas diversas',
  '3305': 'Xampus e preparações capilares', '3306': 'Higiene bucal', '3307': 'Perfumes, desodorantes e higiene', '3401': 'Sabões e sabonetes', '3402': 'Detergentes e limpeza',
  '3808': 'Inseticidas, antiparasitários e desinfetantes', '3824': 'Preparações químicas diversas', '3923': 'Embalagens plásticas',
  '3924': 'Utensílios de plástico (comedouros, bebedouros)', '3926': 'Outras obras de plástico', '4016': 'Obras de borracha',
  '4201': 'Coleiras, guias e artigos de seleiro', '4202': 'Bolsas e caixas de transporte', '4205': 'Outras obras de couro', '4421': 'Outras obras de madeira',
  '4818': 'Papéis higiênicos e tapetes', '4823': 'Outros papéis', '5609': 'Cordas e cordéis', '6307': 'Outros artefatos têxteis (roupas, camas)',
  '6304': 'Artigos têxteis de decoração', '7013': 'Objetos de vidro', '7323': 'Utensílios de ferro e aço', '7326': 'Obras de ferro e aço (gaiolas)',
  '8414': 'Bombas de ar (aquários)', '8421': 'Filtros', '8509': 'Aparelhos eletrodomésticos', '8510': 'Máquinas de tosa', '8516': 'Aquecedores',
  '8539': 'Lâmpadas', '9018': 'Instrumentos médicos e veterinários', '9403': 'Outros móveis', '9404': 'Colchões, almofadas e camas',
  '9503': 'Brinquedos', '9506': 'Artigos de esporte', '9603': 'Escovas', '9615': 'Pentes',
}

export const nomeCapitulo = (c: string | null) => (c ? CAPITULOS[c] ?? `Capítulo ${c}` : 'Sem NCM')
export const nomePosicao = (p: string | null, descricaoNcm?: string | null) =>
  p ? POSICOES[p] ?? (descricaoNcm ? capitalizar(descricaoNcm.split(/[-;,]/)[0].trim().slice(0, 60)) : `Posição ${p}`) : 'Sem NCM'
export const formatarNcm = (n: string | null) => (n && n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n ?? '—')
export const nivelPrefixo = (p: string) => (p.length <= 2 ? 'Grupo (capítulo)' : p.length <= 4 ? 'Subgrupo (posição)' : p.length < 8 ? 'Subposição' : 'NCM completo')
export function nomePrefixo(p: string) {
  if (p.length <= 2) return nomeCapitulo(p)
  if (p.length <= 4) return nomePosicao(p)
  return `${nomePosicao(p.slice(0, 4))} · ${formatarNcm(p)}`
}
function capitalizar(s: string) { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
