import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { CalendarClock, CalendarRange, ChevronRight, LayoutDashboard, LogOut, Package, RefreshCw, Shapes, Truck, Users } from 'lucide-react'
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
import Setores from './pages/Setores'
import Sincronizacao from './pages/Sincronizacao'

const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/mes', label: 'Resumo do mês', icon: CalendarRange },
  { to: '/produtos', label: 'Produtos e estoque', icon: Package },
  { to: '/validades', label: 'Validades', icon: CalendarClock },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/setores', label: 'Setores', icon: Shapes },
  { to: '/sincronizacao', label: 'Sincronização', icon: RefreshCw },
]

function App() {
  const [user, setUser] = useState(currentUser())
  useEffect(() => onAuthChange(() => setUser(currentUser())), [])
  if (!user) return <Login />
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="YUP Intelligence, ir para a visão geral"><Brand /></NavLink>
        <div className="sidebar-label">GESTÃO DA LOJA</div>
        <nav aria-label="Seções">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}><Icon size={18} aria-hidden />{label}<ChevronRight size={14} className="chev" aria-hidden /></NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-user">{user}</span>
          <button onClick={logout} aria-label="Sair"><LogOut size={17} aria-hidden /><span className="sidebar-user-txt">Sair</span></button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Resumo />} />
          <Route path="/mes" element={<Mes />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/validades" element={<Validades />} />
          <Route path="/fornecedores" element={<Fornecedores />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/setores" element={<Setores />} />
          <Route path="/sincronizacao" element={<Sincronizacao />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ProdutoPainel />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
