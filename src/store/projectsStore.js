import { create } from 'zustand'
import axios from 'axios'
import useAuthStore from './authStore'

const handleUnauthorized = (error) => {
  if (error.response?.status === 401) {
    useAuthStore.getState().logout()
  }
}

const useProjectsStore = create((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,

  // Получить все проекты
  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.get('/api/projects')
      if (response.data.success) {
        set({ projects: response.data.projects || [], isLoading: false })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при получении проектов'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Создать проект
  createProject: async (title, description) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post('/api/projects', { title, description })
      if (response.data.success) {
        const newProject = response.data.project
        set({ projects: [newProject, ...get().projects], isLoading: false })
        return { success: true, project: newProject }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при создании проекта'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Участвовать в проекте (отправить сообщение создателю)
  participateProject: async (projectId, note = '') => {
    try {
      const response = await axios.post(`/api/projects/${projectId}/participate`, { note })
      if (response.data.success) {
        set({
          projects: get().projects.map((p) =>
            p.id === projectId
              ? { ...p, participants: [...(p.participants || []), useAuthStore.getState().user?.id] }
              : p
          )
        })
        return { success: true, chatId: response.data.chatId }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при отправке заявки'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Отменить участие в проекте (выйти из участников)
  leaveProject: async (projectId) => {
    try {
      const response = await axios.post(`/api/projects/${projectId}/leave`)
      if (response.data.success) {
        set({
          projects: get().projects.map((p) =>
            p.id === projectId
              ? { ...p, participants: response.data.participants || [] }
              : p
          )
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при отмене участия'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Исключить участника из проекта (создатель)
  removeParticipant: async (projectId, userId) => {
    try {
      const response = await axios.delete(`/api/projects/${projectId}/participants/${userId}`)
      if (response.data.success) {
        set({
          projects: get().projects.map((p) =>
            p.id === projectId ? { ...p, participants: response.data.participants || [] } : p
          )
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при исключении участника'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Завершить проект (создатель)
  completeProject: async (projectId) => {
    try {
      const response = await axios.post(`/api/projects/${projectId}/complete`)
      if (response.data.success) {
        const updated = response.data.project
        set({
          projects: get().projects.map((p) => (p.id === projectId ? { ...p, ...updated } : p))
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при завершении проекта'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Удалить проект (создатель)
  deleteProject: async (projectId) => {
    try {
      const response = await axios.delete(`/api/projects/${projectId}`)
      if (response.data.success) {
        set({ projects: get().projects.filter((p) => p.id !== projectId) })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при удалении проекта'
      set({ error: message })
      return { success: false, message }
    }
  },

  clearError: () => set({ error: null })
}))

export default useProjectsStore
