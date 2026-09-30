import { Link, NavLink, Outlet } from 'react-router-dom'

export default function Layout() {
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
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
