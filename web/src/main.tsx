import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CalendarClock, CalendarRange, ChevronRight, ClipboardCheck, LayoutDashboard, LogOut, Package, RefreshCw, Shapes, ShieldAlert, ShoppingCart, Truck, Users } from 'lucide-react'
import './styles.css'
import { currentUser, logout, onAuthChange } from './api'
import { Brand } from './ui'
import ProdutoPainel from './ProdutoPainel'
import Login from './pages/Login'
import Resumo from './pages/Resumo'
import Mes from './pages/Mes'
import Produtos from './pages/Produtos'
import Validades from './pages/Validades'
import Fornecedores from './pages/Fornecedores'
import Clientes from './pages/Clientes'
import Setores, { SetoresSecoes, SUBABAS_SETORES } from './pages/Setores'
import SetoresCategorias from './pages/SetoresCategorias'
import SetoresRegras from './pages/SetoresRegras'
import Sincronizacao from './pages/Sincronizacao'
import Compras from './pages/Compras'
import Conciliacao from './pages/Conciliacao'
import Qualidade from './pages/Qualidade'

const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/mes', label: 'Resumo do mês', icon: CalendarRange },
  { to: '/compras', label: 'Compras', icon: ShoppingCart },
  { to: '/produtos', label: 'Produtos e estoque', icon: Package },
  { to: '/validades', label: 'Validades', icon: CalendarClock },
  { to: '/conciliacao', label: 'Conciliação', icon: ClipboardCheck },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/setores', label: 'Setores', icon: Shapes, filhos: SUBABAS_SETORES },
  { to: '/qualidade', label: 'Qualidade do dado', icon: ShieldAlert },
  { to: '/sincronizacao', label: 'Sincronização', icon: RefreshCw },
]

type ItemNav = { to: string; label: string; icon: typeof Shapes; end?: boolean; filhos?: { to: string; label: string; end?: boolean }[] }

/** Item do menu; com subabas, vira um grupo recolhível (abre sozinho quando a página atual é dele). */
function ItemMenu({ item }: { item: ItemNav }) {
  const { pathname } = useLocation()
  const dentro = pathname === item.to || pathname.startsWith(item.to + '/')
  const [aberto, setAberto] = useState(dentro)
  useEffect(() => { if (dentro) setAberto(true) }, [dentro])
  const Icon = item.icon
  if (!item.filhos) return <NavLink to={item.to} end={item.end}><Icon size={18} aria-hidden />{item.label}<ChevronRight size={14} className="chev" aria-hidden /></NavLink>
  return (
    <div className={`nav-group${aberto ? ' open' : ''}`}>
      <button type="button" className={`nav-toggle${dentro ? ' active' : ''}`} aria-expanded={aberto} aria-controls={`sub-${item.to}`} onClick={() => setAberto(a => !a)}>
        <Icon size={18} aria-hidden />{item.label}<ChevronRight size={14} className="chev" aria-hidden />
      </button>
      {aberto && <div className="nav-sub" id={`sub-${item.to}`}>{item.filhos.map(f => <NavLink key={f.to} to={f.to} end={f.end}>{f.label}</NavLink>)}</div>}
    </div>
  )
}

function App() {
  const [user, setUser] = useState(currentUser())
  useEffect(() => onAuthChange(() => setUser(currentUser())), [])
  // Ao trocar de página, o foco vai para o conteúdo (leitor de tela anuncia a nova tela).
  // Só o caminho conta: filtros na URL não movem o foco.
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const primeira = useRef(true)
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])
  if (!user) return <Login />
  return (
    <div className="shell">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="YUP Intelligence, ir para a visão geral"><Brand /></NavLink>
        <div className="sidebar-label">Gestão da loja</div>
        <nav aria-label="Seções">
          {(NAV as ItemNav[]).map(item => <ItemMenu key={item.to} item={item} />)}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-user">{user}</span>
          <button onClick={logout} aria-label="Sair"><LogOut size={17} aria-hidden /><span className="sidebar-user-txt">Sair</span></button>
        </div>
      </aside>
      <main className="content" id="conteudo" ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Resumo />} />
          <Route path="/mes" element={<Mes />} />
          <Route path="/compras" element={<Compras />} />
          <Route path="/conciliacao" element={<Conciliacao />} />
          <Route path="/qualidade" element={<Qualidade />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/validades" element={<Validades />} />
          <Route path="/fornecedores" element={<Fornecedores />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/setores" element={<Setores />} />
          <Route path="/setores/categorias" element={<SetoresCategorias />} />
          <Route path="/setores/regras" element={<SetoresRegras />} />
          <Route path="/setores/secoes" element={<SetoresSecoes />} />
          <Route path="/sincronizacao" element={<Sincronizacao />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ProdutoPainel />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
