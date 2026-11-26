import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, PanelLeftClose, PanelLeftOpen, Search, BadgeCheck, FileBarChart, Menu as MenuIcon, X, CalendarClock, CalendarRange, ChevronRight, ClipboardCheck, IdCard, LayoutDashboard, LogOut, Package, RefreshCw, Shapes, ShieldAlert, ShoppingCart, Truck, Users } from 'lucide-react'
import './styles.css'
import { currentUser, logout, onAuthChange, useApi } from './api'
import { haQuanto } from './format'
import { Brand } from './ui'
import ProdutoPainel from './ProdutoPainel'
import ClientePainel from './ClientePainel'
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
import Vendedoras from './pages/Vendedoras'
import Auditoria from './pages/Auditoria'
import Relatorios from './pages/Relatorios'
import LogMovimentacoes from './pages/LogMovimentacoes'
import Mix from './pages/Mix'

import { GRUPOS, dentroDe, paginaAtual, type ItemNav } from './nav'

/** Atalhos da barra de baixo no celular. */
const ATALHOS = [
  { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/mes', label: 'Vendas', icon: CalendarRange, prefixos: ['/mes', '/vendedoras', '/clientes'] },
  { to: '/produtos', label: 'Estoque', icon: Package, prefixos: ['/produtos', '/compras', '/fornecedores', '/conciliacao', '/setores', '/log'] },
  { to: '/validades', label: 'Validades', icon: CalendarClock },
]

/** Item do menu; com subabas, vira um grupo recolhível (abre sozinho quando a página atual é dele). */
function ItemMenu({ item, onNavegar }: { item: ItemNav; onNavegar?: () => void }) {
  const { pathname } = useLocation()
  const dentro = dentroDe(pathname, item.to)
  const [aberto, setAberto] = useState(dentro)
  useEffect(() => { if (dentro) setAberto(true) }, [dentro])
  const Icon = item.icon
  if (!item.filhos) return <NavLink to={item.to} end={item.end} onClick={onNavegar} title={item.label}><Icon size={18} aria-hidden /><span className="nav-label">{item.label}</span></NavLink>
  return (
    <div className={`nav-group${aberto ? ' open' : ''}`}>
      <button type="button" className={`nav-toggle${dentro ? ' active' : ''}`} aria-expanded={aberto} aria-controls={`sub-${item.to}`} onClick={() => setAberto(a => !a)} title={item.label}>
        <Icon size={18} aria-hidden /><span className="nav-label">{item.label}</span><ChevronRight size={14} className="chev" aria-hidden />
      </button>
      {/* Menu recolhido: o grupo vira um atalho direto para a 1ª subaba. */}
      <NavLink to={item.to} end className="nav-atalho" title={item.label} onClick={onNavegar}><Icon size={18} aria-hidden /><span className="nav-label">{item.label}</span></NavLink>
      {aberto && <div className="nav-sub" id={`sub-${item.to}`}>{item.filhos.map(f => <NavLink key={f.to} to={f.to} end={f.end} onClick={onNavegar}>{f.label}</NavLink>)}</div>}
    </div>
  )
}

function Menu({ onNavegar }: { onNavegar?: () => void }) {
  return (
    <nav aria-label="Seções" className="menu">
      {GRUPOS.map((g, i) => (
        <div key={i} className="menu-grupo" role="group" aria-label={g.titulo ?? 'Início'}>
          {g.titulo && <div className="menu-titulo">{g.titulo}</div>}
          {g.itens.map(item => <ItemMenu key={item.to} item={item} onNavegar={onNavegar} />)}
        </div>
      ))}
    </nav>
  )
}

/** Celular: barra fixa embaixo com os atalhos e o menu completo numa folha que sobe. */
function BarraCelular({ user }: { user: string }) {
  const { pathname } = useLocation()
  const [aberto, setAberto] = useState(false)
  useEffect(() => { setAberto(false) }, [pathname])
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [aberto])
  return (
    <>
      <nav className="tabbar" aria-label="Atalhos">
        {ATALHOS.map(a => {
          const ativo = a.prefixos ? a.prefixos.some(p => dentroDe(pathname, p)) : dentroDe(pathname, a.to)
          const Icon = a.icon
          return <NavLink key={a.to} to={a.to} end={a.end} className={ativo ? 'active' : undefined} aria-current={ativo ? 'page' : undefined}><Icon size={21} aria-hidden /><span>{a.label}</span></NavLink>
        })}
        <button type="button" className={aberto ? 'active' : undefined} onClick={() => setAberto(a => !a)} aria-expanded={aberto} aria-controls="menu-celular"><MenuIcon size={21} aria-hidden /><span>Menu</span></button>
      </nav>
      {aberto && (
        <div className="sheet-root">
          <div className="sheet-backdrop" onClick={() => setAberto(false)} aria-hidden />
          <div className="sheet" id="menu-celular" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="sheet-head"><Brand /><button type="button" className="drawer-close" onClick={() => setAberto(false)} aria-label="Fechar menu"><X size={20} aria-hidden /></button></div>
            <Menu onNavegar={() => setAberto(false)} />
            <div className="sheet-foot"><span className="sidebar-user">{user}</span><button type="button" className="btn secondary small" onClick={logout}><LogOut size={15} aria-hidden />Sair</button></div>
          </div>
        </div>
      )}
    </>
  )
}

/** Computador: barra fixa no topo com o menu, a marca, a busca de produto, a última leitura do ERP e a conta. */
function BarraTopo({ user, menuMin, alternarMenu }: { user: string; menuMin: boolean; alternarMenu: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data } = useApi<{ last_run: { started_at: string; status: string } | null }>('supabase/test')
  const run = data?.last_run
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={alternarMenu} aria-label={menuMin ? 'Abrir o menu' : 'Recolher o menu'} aria-pressed={menuMin} title={menuMin ? 'Abrir o menu' : 'Recolher o menu'}>
        {menuMin ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
      </button>
      <NavLink to="/" className="brand" aria-label="YUP Intelligence, ir para a visão geral"><Brand /></NavLink>
      <form role="search" className="topbar-busca" onSubmit={e => { e.preventDefault(); const t = q.trim(); navigate(t ? `/produtos?busca=${encodeURIComponent(t)}` : '/produtos'); setQ('') }}>
        <Search size={16} aria-hidden />
        <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar produto: nome, código ou código de barras" aria-label="Buscar produto" />
      </form>
      <div className="topbar-dir">
        {run && (
          <NavLink to="/sincronizacao" className={`topbar-sync ${run.status === 'error' ? 'bad' : 'good'}`} title="Última leitura do ERP">
            <i aria-hidden />ERP {run.status === 'error' ? 'com erro' : 'lido'} {haQuanto(run.started_at)}
          </NavLink>
        )}
        <span className="topbar-user" title={user}>{user}</span>
        <button type="button" className="icon-btn" onClick={logout} aria-label="Sair" title="Sair"><LogOut size={17} aria-hidden /></button>
      </div>
    </header>
  )
}

/** Volta ao topo quando a página fica longa. */
function VoltarTopo() {
  const [ver, setVer] = useState(false)
  useEffect(() => {
    const f = () => setVer(window.scrollY > 900)
    window.addEventListener('scroll', f, { passive: true }); f()
    return () => window.removeEventListener('scroll', f)
  }, [])
  if (!ver) return null
  return <button type="button" className="topo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Voltar ao topo"><ArrowUp size={18} aria-hidden /></button>
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
    window.scrollTo(0, 0) // página nova sempre abre no topo
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])
  const atual = paginaAtual(pathname)
  // Menu lateral recolhível (só ícones); a escolha fica guardada neste navegador.
  const [menuMin, setMenuMin] = useState(() => { try { return localStorage.getItem('yup.menu-min') === '1' } catch { return false } })
  const alternarMenu = () => setMenuMin(m => { try { localStorage.setItem('yup.menu-min', m ? '0' : '1') } catch { /* sem storage */ } return !m })
  if (!user) return <Login />
  return (
    <div className={`shell${menuMin ? ' menu-min' : ''}`}>
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <BarraTopo user={user} menuMin={menuMin} alternarMenu={alternarMenu} />
      <aside className="sidebar">
        <Menu />
      </aside>
      <header className="topbar-celular">
        <NavLink to="/" className="brand" aria-label="YUP Intelligence, ir para a visão geral"><Brand /></NavLink>
        {atual && <span className="topbar-pagina">{atual.grupo ? `${atual.grupo} · ` : ''}{atual.item.label}</span>}
      </header>
      <main className="content" id="conteudo" ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Resumo />} />
          <Route path="/mes" element={<Mes />} />
          <Route path="/compras" element={<Compras />} />
          <Route path="/conciliacao" element={<Conciliacao />} />
          <Route path="/qualidade" element={<Qualidade />} />
          <Route path="/vendedoras" element={<Vendedoras />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/log" element={<LogMovimentacoes />} />
          <Route path="/mix" element={<Mix />} />
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
      <BarraCelular user={user} />
      <VoltarTopo />
      {/* Ordem importa: a ficha do item abre por cima da do cliente (e da vendedora). */}
      <ClientePainel />
      <ProdutoPainel />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
