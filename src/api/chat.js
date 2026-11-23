import axios from 'axios'

export const chatApi = {
  getChats: () => axios.get('/api/chats'),
  search: (query) => axios.get('/api/chats/search', { params: { q: query } }),
  createDirect: (userId) => axios.post('/api/chats/direct', { userId }),
  createGroup: (title, participantIds) => axios.post('/api/chats/group', { title, participantIds }),
  updateGroup: (chatId, payload) => axios.patch(`/api/chats/${chatId}`, payload),
  leaveGroup: (chatId) => axios.post(`/api/chats/${chatId}/leave`),
  markRead: (chatId) => axios.post(`/api/chats/${chatId}/read`),
  getMessages: (chatId, params) => axios.get(`/api/chats/${chatId}/messages`, { params }),
  searchMessages: (chatId, query) => axios.get(`/api/chats/${chatId}/messages/search`, { params: { q: query } }),
  sendMessage: (chatId, payload) => axios.post(`/api/chats/${chatId}/messages`, payload),
  deleteMessage: (chatId, messageId) => axios.delete(`/api/chats/${chatId}/messages/${messageId}`),
  clearMessages: (chatId) => axios.delete(`/api/chats/${chatId}/messages`),
  deleteChat: (chatId) => axios.delete(`/api/chats/${chatId}`),
  addParticipant: (chatId, userId) => axios.post(`/api/chats/${chatId}/participants`, { userId }),
  removeParticipant: (chatId, userId) => axios.delete(`/api/chats/${chatId}/participants/${userId}`),
  toggleAdmin: (chatId, userId) => axios.put(`/api/chats/${chatId}/participants/${userId}/admin`)
}
