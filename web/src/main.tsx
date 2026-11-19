import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CalendarClock, CalendarRange, ChevronRight, CircleHelp, LayoutDashboard, LogOut, Package, RefreshCw, Search, Shapes, Truck, Users } from 'lucide-react'
import './styles.css'
import './executive.css'
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

const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/mes', label: 'Resumo do mês', icon: CalendarRange },
  { to: '/produtos', label: 'Produtos e estoque', icon: Package },
  { to: '/validades', label: 'Validades', icon: CalendarClock },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/setores', label: 'Setores', icon: Shapes, filhos: SUBABAS_SETORES },
]

type ItemNav = { to: string; label: string; icon: typeof Shapes; end?: boolean; filhos?: { to: string; label: string; end?: boolean }[] }

function ItemMenu({ item }: { item: ItemNav }) {
  const { pathname } = useLocation()
  const dentro = pathname === item.to || pathname.startsWith(item.to + '/')
  const [aberto, setAberto] = useState(dentro)
  useEffect(() => { if (dentro) setAberto(true) }, [dentro])
  const Icon = item.icon
  if (!item.filhos) return <NavLink to={item.to} end={item.end}><Icon size={17} aria-hidden /><span>{item.label}</span><ChevronRight size={13} className="chev" aria-hidden /></NavLink>
  return (
    <div className={`nav-group${aberto ? ' open' : ''}`}>
      <button type="button" className={`nav-toggle${dentro ? ' active' : ''}`} aria-expanded={aberto} aria-controls={`sub-${item.to}`} onClick={() => setAberto(a => !a)}>
        <Icon size={17} aria-hidden /><span>{item.label}</span><ChevronRight size={13} className="chev" aria-hidden />
      </button>
      {aberto && <div className="nav-sub" id={`sub-${item.to}`}>{item.filhos.map(f => <NavLink key={f.to} to={f.to} end={f.end}>{f.label}</NavLink>)}</div>}
    </div>
  )
}

function GlobalSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return <form className="global-search" role="search" onSubmit={e => { e.preventDefault(); if (q.trim()) navigate(`/produtos?busca=${encodeURIComponent(q.trim())}`) }}>
    <Search size={16} aria-hidden /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar produtos..." aria-label="Buscar produtos" /><kbd>↵</kbd>
  </form>
}

function App() {
  const [user, setUser] = useState(currentUser())
  useEffect(() => onAuthChange(() => setUser(currentUser())), [])
  if (!user) return <Login />
  const initials = user.split('@')[0].split(/[._-]/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="YUP Intelligence, ir para a visão geral"><Brand /></NavLink>
        <div className="sidebar-label">GESTÃO</div>
        <nav aria-label="Seções">{(NAV as ItemNav[]).map(item => <ItemMenu key={item.to} item={item} />)}</nav>
        <div className="sidebar-bottom">
          <NavLink to="/sincronizacao" className="sync-card"><RefreshCw size={16} aria-hidden /><span><b>Sincronização</b><small>Monitorar dados do ERP</small></span><i /></NavLink>
          <div className="sidebar-profile"><span className="avatar">{initials}</span><span><b>{user.split('@')[0]}</b><small>Administrador</small></span><button onClick={logout} aria-label="Sair"><LogOut size={16} aria-hidden /></button></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <GlobalSearch />
          <div className="topbar-actions"><button aria-label="Ajuda"><CircleHelp size={18} /></button><button className="bell" aria-label="Notificações"><Bell size={18} /><i /></button></div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Resumo />} />
            <Route path="/mes" element={<Mes />} />
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
      </div>
      <ProdutoPainel />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
