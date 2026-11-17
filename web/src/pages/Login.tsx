import { useState } from 'react'
import { login } from '../api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="login">
      <form onSubmit={async e => {
        e.preventDefault(); setErro(null); setEnviando(true)
        try { await login(email.trim(), senha) } catch (err) { setErro(err instanceof Error ? err.message : 'Falha no login.') } finally { setEnviando(false) }
      }}>
        <div className="brand"><span className="brand-dot" aria-hidden /> <span>YUP Intelligence<small>Gestão Yup Petstore</small></span></div>
        <h1>Entrar</h1>
        <label>E-mail<input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Senha<input className="input" type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} /></label>
        {erro && <div className="err" role="alert">{erro}</div>}
        <button className="btn" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
