import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

export default function Layout() {
  const { username, isLoggedIn, login, register, logout } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [formUser, setFormUser] = useState('')
  const [formPass, setFormPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function openModal() {
    setError('')
    setFormUser('')
    setFormPass('')
    setModalOpen(true)
  }

  async function handle(action) {
    setError('')
    setBusy(true)
    try {
      if (action === 'login') await login(formUser.trim(), formPass)
      else await register(formUser.trim(), formPass)
      setModalOpen(false)
    } catch (e) {
      setError(e.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="brand">FlashCards</Link>
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} end>
            Мои наборы
          </NavLink>
          <NavLink to="/sets/new" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            Импорт JSON
          </NavLink>
        </nav>
        <div className="auth-area">
          {isLoggedIn ? (
            <>
              <span className="auth-user">{username}</span>
              <button className="btn btn-outline" onClick={() => logout()}>Выход</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={openModal}>Войти/Регистрация</button>
          )}
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => !busy && setModalOpen(false)}>
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
      )}
    </div>
  )
}
