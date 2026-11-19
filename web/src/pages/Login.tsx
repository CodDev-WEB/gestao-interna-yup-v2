import { useState } from 'react'
import { ChevronRight, Eye, EyeOff, ShieldCheck, TrendingUp } from 'lucide-react'
import { login } from '../api'
import { Brand } from '../ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [ver, setVer] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="login-page">
      <div className="login-side">
        <div className="brand"><Brand /></div>
        <div className="login-message">
          <span className="eyebrow">Inteligência de gestão</span>
          <h1>Boas decisões começam com <em>dados claros.</em></h1>
          <p>Estoque, validades, fornecedores e clientes da Yup em um só lugar, atualizados direto do ERP.</p>
          <div className="login-stat"><TrendingUp aria-hidden /><div><strong>Onde está o dinheiro da loja.</strong><small>E o que fazer com ele.</small></div></div>
        </div>
        <div className="login-foot">Dados do ERP atualizados a cada 5 minutos</div>
      </div>
      <div className="login-form-wrap">
        <form className="login-card" onSubmit={async e => {
          e.preventDefault(); setErro(null); setEnviando(true)
          try { await login(email.trim(), senha) } catch (err) { setErro(err instanceof Error ? err.message : 'Falha no login.') } finally { setEnviando(false) }
        }}>
          <div className="form-icon"><ShieldCheck aria-hidden /></div>
          <span className="eyebrow">Área restrita</span>
          <h2>Entrar</h2>
          <p>Use o e-mail e a senha de administrador da Yup.</p>
          <label>E-mail<input className="input" type="email" autoComplete="username" placeholder="seu@email.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Senha
            <span className="pass">
              <input className="input" type={ver ? 'text' : 'password'} autoComplete="current-password" placeholder="Sua senha" required value={senha} onChange={e => setSenha(e.target.value)} />
              <button type="button" onClick={() => setVer(v => !v)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'} aria-pressed={ver}>{ver ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}</button>
            </span>
          </label>
          {erro && <div className="error-box" role="alert">{erro}</div>}
          <button className="btn full" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}<ChevronRight size={17} aria-hidden /></button>
        </form>
      </div>
    </div>
  )
}
