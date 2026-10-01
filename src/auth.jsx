// ---------- K13 simple auth (username + password, no email) ----------
// Global user state: token in localStorage under fc_token, username resolved
// from GET /api/me so it survives reloads. Exposes login/register/logout to
// the rest of the app via React context.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { setProgressUser } from './store.js'

const TOKEN_KEY = 'fc_token'

export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null)
  const [username, setUsername] = useState(null)
  const [ready, setReady] = useState(false)

  // Auto-load the username from the stored token at startup.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const stored = localStorage.getItem(TOKEN_KEY)
      if (!stored) {
        setReady(true)
        return
      }
      try {
        const res = await fetch('/api/me', {
          headers: { Authorization: 'Bearer ' + stored },
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setUsername(data.username)
        } else {
          // Stale/invalid token -> drop it.
          localStorage.removeItem(TOKEN_KEY)
          if (!cancelled) setToken(null)
        }
      } catch (e) {
        // Server unreachable: keep token but no username yet.
        console.warn('Failed to restore session', e)
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function login(usernameInput, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password }),
    })
    if (!res.ok) throw new Error('Неправильный логин или пароль')
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
    setToken(data.token)
    setUsername(data.username)
    return data
  }

  async function register(usernameInput, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password }),
    })
    if (!res.ok) {
      throw new Error(res.status === 409 ? 'Имя уже занято' : 'Не удалось создать аккаунт')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
    setToken(data.token)
    setUsername(data.username)
    return data
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      })
    } catch (e) {
      console.warn('Logout request failed (ignored)', e)
    }
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUsername(null)
  }

  // Bind the per-user progress keys in store.js to the current user.
  useEffect(() => {
    setProgressUser(username)
  }, [username])

  const value = useMemo(
    () => ({ token, username, ready, login, register, logout, isLoggedIn: !!username }),
    [token, username, ready]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
