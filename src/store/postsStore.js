import { create } from 'zustand'
import axios from 'axios'
import useAuthStore from './authStore'

const handleUnauthorized = (error) => {
  if (error.response?.status === 401) {
    useAuthStore.getState().logout()
  }
}

const usePostsStore = create((set, get) => ({
  posts: [],
  commentsByPost: {},
  userReactions: {},
  isLoading: false,
  error: null,

  // Получить все посты
  fetchPosts: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.get('/api/posts')

      if (response.data.success) {
        set({
          posts: response.data.posts || [],
          isLoading: false
        })
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при получении постов'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Создать новый пост
  createPost: async (text, image = null) => {
    set({ isLoading: true, error: null })
    try {
      const response = await axios.post('/api/posts', {
        text,
        image
      })

      if (response.data.success) {
        const newPost = response.data.post
        set({
          posts: [newPost, ...get().posts],
          isLoading: false
        })
        return { success: true, post: newPost }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при создании поста'
      set({ error: message, isLoading: false })
      return { success: false, message }
    }
  },

  // Удалить пост
  deletePost: async (postId) => {
    try {
      const response = await axios.delete(`/api/posts/${postId}`)

      if (response.data.success) {
        set({
          posts: get().posts.filter(post => post._id !== postId)
        })
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при удалении поста'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Получить комментарии поста
  fetchComments: async (postId) => {
    try {
      const response = await axios.get(`/api/posts/${postId}/comments`)
      if (response.data.success) {
        set({
          commentsByPost: {
            ...get().commentsByPost,
            [postId]: response.data.comments
          }
        })
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.message || 'Ошибка при получении комментариев'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Получить реакцию пользователя на пост
  getUserReaction: async (postId) => {
    try {
      const response = await axios.get(`/api/posts/${postId}/user-reaction`)
      if (response.data.success) {
        set({
          userReactions: {
            ...get().userReactions,
            [postId]: response.data.userReaction
          }
        })
        return response.data.userReaction
      }
    } catch (error) {
      return null
    }
  },

  // Добавить комментарий
  createComment: async (postId, text) => {
    try {
      const response = await axios.post(`/api/posts/${postId}/comments`, { text })

      if (response.data.success) {
        set({
          posts: get().posts.map(post =>
            post._id === postId ? { ...post, comments: post.comments + 1 } : post
          ),
          commentsByPost: {
            ...get().commentsByPost,
            [postId]: [
              ...(get().commentsByPost[postId] || []),
              response.data.comment
            ]
          }
        })
        return { success: true, comment: response.data.comment }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при добавлении комментария'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Удалить комментарий
  deleteComment: async (postId, commentId) => {
    try {
      const response = await axios.delete(`/api/posts/${postId}/comments/${commentId}`)

      if (response.data.success) {
        set({
          posts: get().posts.map(post =>
            post._id === postId ? { ...post, comments: Math.max(0, post.comments - 1) } : post
          ),
          commentsByPost: {
            ...get().commentsByPost,
            [postId]: (get().commentsByPost[postId] || []).filter(comment => comment._id !== commentId)
          }
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при удалении комментария'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Добавить реакцию
  reactToPost: async (postId, type) => {
    try {
      const response = await axios.post(`/api/posts/${postId}/react`, { type })

      if (response.data.success) {
        set({
          posts: get().posts.map(post =>
            post._id === postId ? response.data.post : post
          ),
          userReactions: {
            ...get().userReactions,
            [postId]: response.data.userReaction
          }
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при добавлении реакции'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Лайкнуть пост
  likePost: async (postId) => {
    try {
      const response = await axios.post(`/api/posts/${postId}/like`)

      if (response.data.success) {
        set({
          posts: get().posts.map(post => 
            post._id === postId 
              ? response.data.post
              : post
          )
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при лайке'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Обновить пост
  updatePost: async (postId, text, image = null) => {
    try {
      const response = await axios.put(`/api/posts/${postId}`, { text, image })

      if (response.data.success) {
        set({
          posts: get().posts.map(post =>
            post._id === postId ? response.data.post : post
          )
        })
        return { success: true }
      }
    } catch (error) {
      handleUnauthorized(error)
      const message = error.response?.data?.message || 'Ошибка при обновлении поста'
      set({ error: message })
      return { success: false, message }
    }
  },

  // Очистить ошибку
  clearError: () => {
    set({ error: null })
  }
}))

export default usePostsStore
