// K19: shared “Вход / Регистрация” modal, reused by the header (Layout),
// SetPage and MySets so a guest who hits a login-gated feature can log in
// without leaving the page (“та же модалка, что в шапке”).
import { useState } from 'react'
import { useAuth } from '../auth.jsx'

export default function LoginModal({ open, onClose }) {
  const { login, register } = useAuth()
  const [formUser, setFormUser] = useState('')
  const [formPass, setFormPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  function reset() {
    setError('')
    setFormUser('')
    setFormPass('')
  }

  async function handle(action) {
    setError('')
    setBusy(true)
    try {
      if (action === 'login') await login(formUser.trim(), formPass)
      else await register(formUser.trim(), formPass)
      reset()
      onClose()
    } catch (e) {
      setError(e.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()} data-testid="login-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Вход / Регистрация</h2>
        <label className="modal-label">Логин</label>
        <input
          className="modal-input"
          value={formUser}
          onChange={(e) => setFormUser(e.target.value)}
          placeholder="username"
          autoFocus
        />
        <label className="modal-label">Пароль</label>
        <input
          className="modal-input"
          type="password"
          value={formPass}
          onChange={(e) => setFormPass(e.target.value)}
          placeholder="••••••••"
          onKeyDown={(e) => e.key === 'Enter' && handle('login')}
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => handle('login')}>
            Войти
          </button>
          <button className="btn btn-outline" disabled={busy} onClick={() => handle('register')}>
            Создать аккаунт
          </button>
        </div>
      </div>
    </div>
  )
}
