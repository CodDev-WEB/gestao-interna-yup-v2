import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { currentUser, logout, onAuthChange } from './api'
import Login from './pages/Login'
import Resumo from './pages/Resumo'
import Produtos from './pages/Produtos'
import Validades from './pages/Validades'
import Fornecedores from './pages/Fornecedores'
import Clientes from './pages/Clientes'
import Setores from './pages/Setores'
import Sincronizacao from './pages/Sincronizacao'

const NAV = [
  { to: '/', label: 'Visão geral', end: true },
  { to: '/produtos', label: 'Produtos e estoque' },
  { to: '/validades', label: 'Validades' },
  { to: '/fornecedores', label: 'Fornecedores' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/setores', label: 'Setores' },
  { to: '/sincronizacao', label: 'Sincronização' },
]

function App() {
  const [user, setUser] = useState(currentUser())
  useEffect(() => onAuthChange(() => setUser(currentUser())), [])
  if (!user) return <Login />
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand"><span className="brand-dot" aria-hidden /> <span>YUP Intelligence<small>Gestão Yup Petstore</small></span></NavLink>
        <nav className="nav" aria-label="Seções">
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
        </nav>
        <div className="rail-foot">{user}<br /><button onClick={logout}>Sair</button></div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Resumo />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/validades" element={<Validades />} />
          <Route path="/fornecedores" element={<Fornecedores />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/setores" element={<Setores />} />
          <Route path="/sincronizacao" element={<Sincronizacao />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
