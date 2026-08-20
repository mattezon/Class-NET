import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './store/authStore'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import ChangePasswordForm from './components/ChangePasswordForm'
import ProtectedRoute from './components/ProtectedRoute'
import MainPage from './pages/MainPage'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  const { isAuthenticated, isLoading, refreshToken, token, user } = useAuthStore()
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')

  useEffect(() => {
    if (!token) {
      refreshToken()
    }
  }, [refreshToken, token])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Персональный акцентный цвет (обводки, кнопки и т.п.) текущего пользователя
  useEffect(() => {
    if (user?.color) {
      document.documentElement.style.setProperty('--user-accent', user.color)
    } else {
      document.documentElement.style.setProperty('--user-accent', 'var(--primary)')
    }
  }, [user?.color])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
        <div className="app-loading__text">Загрузка...</div>
      </div>
    )
  }

  return (
    <HashRouter>
      <div className="app">
        <Routes>
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to="/" replace /> : <LoginForm />}
          />
          <Route
            path="/register"
            element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterForm />}
          />
          <Route
            path="/change-password"
            element={
              user?.needsPasswordChange ? (
                <ChangePasswordForm />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                {user?.needsPasswordChange ? (
                  <Navigate to="/change-password" replace />
                ) : (
                  <MainPage theme={theme} toggleTheme={toggleTheme} />
                )}
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App