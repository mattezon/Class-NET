import { create } from 'zustand'
import axios from 'axios'
import { io } from 'socket.io-client'
import useAuthStore from './authStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const handleUnauthorized = (error) => {
  if (error.response?.status === 401) {
    useAuthStore.getState().logout()
  }
}

const usePollsStore = create((set, get) => ({
  polls: [],
  isLoading: false,
  error: null,

  // WebSocket
  socket: null,

  initSocket: () => {
    const { token } = useAuthStore.getState()
    if (!token) return

    const socket = io(API_BASE, {
      transports: ['websocket'],
      reconnection: true,
      auth: { token }
    })

    socket.on('poll:update', (updatedPoll) => {
      set((state) => ({
        polls: state.polls.map((p) => (p.id === updatedPoll.id ? updatedPoll : p))
      }))
    })

    socket.on('polls:deleted', ({ pollId }) => {
      set((state) => ({
        polls: state.polls.filter((p) => p.id !== pollId)
      }))
    })

    set({ socket })
  },

  disconnectSocket: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({ socket: null })
    }
  },

  fetchPolls: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.get('/api/polls')
      if (response.data.success) {
        set({ polls: response.data.polls || [], isLoading: false })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при получении опросов'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  createPoll: async (question, options, extra = {}) => {
    set({ isLoading: true, error: null })
    try {
      const body = { question, options }
      if (extra.allowsMultiple) body.allowsMultiple = true
      if (extra.endsAt) body.endsAt = extra.endsAt

      const response = await axios.post('/api/polls', body)
      if (response.data.success) {
        const newPoll = response.data.poll
        set({ polls: [newPoll, ...get().polls], isLoading: false })
        return { success: true, poll: newPoll }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при создании опроса'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  votePoll: async (pollId, option) => {
    try {
      const response = await axios.post(`/api/polls/${pollId}/vote`, { option })
      if (response.data.success) {
        const updated = response.data.poll
        set({
          polls: get().polls.map((p) => (p.id === pollId ? updated : p))
        })
        return { success: true, poll: updated }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при голосовании'
      set({ error: message })
      return { success: false, message }
    }
  },

  deletePoll: async (pollId) => {
    try {
      const response = await axios.delete(`/api/polls/${pollId}`)
      if (response.data.success) {
        set({
          polls: get().polls.filter((p) => p.id !== pollId)
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при удалении опроса'
      return { success: false, message }
    }
  },

  // Удалить свой ответ в опросе
  removeVote: async (pollId) => {
    try {
      const response = await axios.delete(`/api/polls/${pollId}/vote`)
      if (response.data.success) {
        const updated = response.data.poll
        set({
          polls: get().polls.map((p) => (p.id === pollId ? updated : p))
        })
        return { success: true, poll: updated }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при удалении ответа'
      set({ error: message })
      return { success: false, message }
    }
  },

  clearError: () => set({ error: null })
}))

export default usePollsStore
