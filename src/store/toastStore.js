import { create } from 'zustand'

let nextToastId = 0

const useToastStore = create((set, get) => ({
  toasts: [],
  push: (message, type = 'info') => {
    const id = ++nextToastId
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }].slice(-4)
    }))
    setTimeout(() => get().remove(id), 4000)
    return id
  },
  remove: (id) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id)
  }))
}))

export default useToastStore
