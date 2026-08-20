import { create } from 'zustand'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
axios.defaults.baseURL = API_BASE_URL
axios.defaults.withCredentials = true

const getStoredToken = () => {
  try {
    return localStorage.getItem('jwtToken')
  } catch {
    return null
  }
}

const getStoredUser = () => {
  try {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

const tokenFromStorage = getStoredToken()
const userFromStorage = getStoredUser()

if (tokenFromStorage) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${tokenFromStorage}`
}

const useAuthStore = create((set, get) => ({
  user: userFromStorage,
  token: tokenFromStorage,
  isAuthenticated: Boolean(tokenFromStorage),
  isLoading: false,
  error: null,

  setAuth: (user, token) => {
    try {
      localStorage.setItem('jwtToken', token)
      localStorage.setItem('user', JSON.stringify(user))
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } catch (error) {
      console.warn('Не удалось сохранить токен в localStorage', error)
    }

    set({
      user,
      token,
      isAuthenticated: true,
      isLoading: false,
      error: null
    })
  },

  // Регистрация
  register: async (email, password, passwordConfirm, isTeacher = false, teacherTempPassword = null) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post('/api/auth/register', {
        email,
        password,
        passwordConfirm,
        isTeacher,
        ...(isTeacher && teacherTempPassword ? { teacherTempPassword } : {})
      })

      if (response.data.success) {
        get().setAuth(response.data.user, response.data.token)
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при регистрации'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Смена пароля (для учителей)
  changePassword: async (newPassword, confirmPassword) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.put('/api/auth/change-password', {
        newPassword,
        confirmPassword
      })

      if (response.data.success) {
        set({ isLoading: false })
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при смене пароля'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Вход
  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post('/api/auth/login', {
        email,
        password
      })

      if (response.data.success) {
        get().setAuth(response.data.user, response.data.token)
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при входе'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  refreshToken: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post('/api/auth/refresh')

      if (response.data.success) {
        get().setAuth(response.data.user, response.data.token)
        return { success: true }
      }
    } catch (error) {
      if (!get().token) {
        await get().logout()
      }
      return { success: false }
    } finally {
      set({ isLoading: false })
    }
  },

  // Выход
  logout: async () => {
    try {
      await axios.post('/api/auth/logout')
    } catch (error) {
      // ignore
    }

    try {
      localStorage.removeItem('jwtToken')
      localStorage.removeItem('user')
      delete axios.defaults.headers.common['Authorization']
    } catch (error) {
      console.warn('Не удалось удалить токен из localStorage', error)
    }

    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null
    })
  },

  // Обновить профиль (юзернейм + как отображать имя + цвет)
  updateProfile: async ({ username, showUsername, color } = {}) => {
    set({ error: null })

    const payload = {}
    if (username !== undefined && username !== null && String(username).trim()) {
      payload.username = String(username).trim()
    }
    if (typeof showUsername === 'boolean') {
      payload.showUsername = showUsername
    }
    if (color !== undefined && color !== null && String(color).trim()) {
      payload.color = String(color).trim()
    }

    try {
      const response = await axios.put('/api/auth/profile', payload)

      if (response.data.success) {
        const updatedUser = response.data.user
        try {
          localStorage.setItem('user', JSON.stringify(updatedUser))
        } catch (error) {
          console.warn('Не удалось сохранить пользователя в localStorage', error)
        }

        set({
          user: updatedUser,
          error: null
        })
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при обновлении профиля'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Очистить ошибку
  clearError: () => {
    set({ error: null })
  }
}))

export default useAuthStore

// ---------------------------------------------------------------------------
// Автоматическое обновление access-токена при ответе 401 (jwt expired и т.п.)
// ---------------------------------------------------------------------------
let refreshPromise = null

const refreshSession = async () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh')
      .then((response) => {
        if (response.data?.success) {
          // Обновляем store + localStorage + Authorization header
          useAuthStore.getState().setAuth(response.data.user, response.data.token)
          return response.data.token
        }
        throw new Error('Не удалось обновить access-токен')
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {}
    const status = error.response?.status
    const url = typeof config.url === 'string' ? config.url : ''
    const isAuthRequest = url.includes('/api/auth/')

    // Не трогаем запросы /api/auth/* (иначе зацикливание на логине/refresh),
    // повторяем только один раз на запрос.
    if (
      status === 401 &&
      !config._retried &&
      !isAuthRequest &&
      useAuthStore.getState().token
    ) {
      config._retried = true

      try {
        const token = await refreshSession()
        config.headers = {
          ...(config.headers || {}),
          Authorization: `Bearer ${token}`
        }
        return axios(config)
      } catch (refreshError) {
        await useAuthStore.getState().logout()
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)