// Menu do sistema agrupado por assunto (usado no menu lateral, no celular e no título das páginas).
import { BadgeCheck, ScanBarcode, ChartColumn, History, CalendarClock, CalendarRange, ClipboardCheck, FileBarChart, IdCard, LayoutDashboard, Package, RefreshCw, Shapes, ShieldAlert, ShoppingCart, Truck, Users } from 'lucide-react'

export const SUBABAS_SETORES = [
  { to: '/setores', label: 'Comparativo', end: true },
  { to: '/setores/categorias', label: 'Categorias (NCM)' },
  { to: '/setores/regras', label: 'Regras por NCM' },
  { to: '/setores/secoes', label: 'Seções do ERP' },
]

type Filho = { to: string; label: string; end?: boolean }
export type ItemNav = { to: string; label: string; icon: typeof Shapes; end?: boolean; filhos?: Filho[] }
type Grupo = { titulo: string | null; itens: ItemNav[] }

/** Menu agrupado por assunto: o que se usa todo dia em cima, controle dos dados embaixo. */
export const GRUPOS: Grupo[] = [
  { titulo: null, itens: [{ to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true }] },
  { titulo: 'Vendas', itens: [
    { to: '/mes', label: 'Resumo do mês', icon: CalendarRange },
    { to: '/vendedoras', label: 'Vendedoras', icon: IdCard },
    { to: '/clientes', label: 'Clientes', icon: Users },
  ] },
  { titulo: 'Estoque', itens: [
    { to: '/produtos', label: 'Produtos e estoque', icon: Package },
    { to: '/validades', label: 'Validades', icon: CalendarClock },
    { to: '/compras', label: 'Compras', icon: ShoppingCart },
    { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
    { to: '/conciliacao', label: 'Conciliação', icon: ClipboardCheck },
    { to: '/log', label: 'Log de movimentações', icon: History },
    { to: '/setores', label: 'Setores', icon: Shapes, filhos: SUBABAS_SETORES },
  ] },
  { titulo: 'Análises', itens: [{ to: '/mix', label: 'Mix e demanda', icon: ChartColumn }, { to: '/relatorios', label: 'Relatórios', icon: FileBarChart }] },
  { titulo: 'Controle dos dados', itens: [
    { to: '/auditoria', label: 'Auditoria de valores', icon: BadgeCheck },
    { to: '/perdas', label: 'Prevenção de perdas', icon: ScanBarcode },
    { to: '/qualidade', label: 'Qualidade do dado', icon: ShieldAlert },
    { to: '/sincronizacao', label: 'Sincronização', icon: RefreshCw },
  ] },
]
export const dentroDe = (pathname: string, to: string) => to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
/** Grupo e item da página atual (para o título do topo no celular). */
export function paginaAtual(pathname: string) {
  for (const g of GRUPOS) for (const i of g.itens) if (dentroDe(pathname, i.to)) return { grupo: g.titulo, item: i }
  return null
}

