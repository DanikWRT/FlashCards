import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import LoginModal from './LoginModal.jsx'

const HIDE_HEADER_KEY = 'fc_hide_header'

// K17: read the persisted "collapse the global header" preference.
function readHideHeader() {
  try {
    return localStorage.getItem(HIDE_HEADER_KEY) === '1'
  } catch (e) {
    return false
  }
}

export default function Layout() {
  const { username, isLoggedIn, logout } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // K17: header collapse state (persisted). When hidden, the whole page
  // centers on the full viewport and a slim floating restore button is shown.
  const [hideHeader, setHideHeader] = useState(readHideHeader)

  function toggleHeader() {
    setHideHeader((h) => {
      const next = !h
      try {
        localStorage.setItem(HIDE_HEADER_KEY, next ? '1' : '0')
      } catch (e) {}
      return next
    })
  }

  // K17: global 'H' keyboard shortcut toggles the header, matching the
  // existing global-hotkey pattern (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'h' || e.key === 'H' || e.key === 'р') {
        e.preventDefault()
        toggleHeader()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openModal() {
    setModalOpen(true)
  }

  return (
    <div className={'app' + (hideHeader ? ' header-collapsed' : '')}>
      {!hideHeader && (
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
          <div className="header-right">
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
            <button
              type="button"
              className="header-toggle"
              onClick={toggleHeader}
              title="Скрыть шапку (H)"
              aria-label="Скрыть шапку"
              data-testid="header-toggle"
            >
              ▴
            </button>
          </div>
        </header>
      )}

      {hideHeader && (
        <button
          type="button"
          className="header-show"
          onClick={toggleHeader}
          title="Показать шапку (H)"
          aria-label="Показать шапку"
          data-testid="header-show"
        >
          ▾ Шапка
        </button>
      )}

      <main className="main">
        <Outlet />
      </main>

      {modalOpen && <LoginModal open onClose={() => setModalOpen(false)} />}
    </div>
  )
}
