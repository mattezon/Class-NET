import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { io } from 'socket.io-client'
import useAuthStore from '../store/authStore'
import { getAuthorDisplayName } from '../utils/userName'
import './ChatPanel.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const ChatPanel = () => {
  const { user, token } = useAuthStore()
  const socketRef = useRef(null)
  const activeChatIdRef = useRef(null)
  const joinedRoomRef = useRef(null)
  const messagesRef = useRef(null)
  const [chats, setChats] = useState([])
  const [messagesByChat, setMessagesByChat] = useState({})
  const [search, setSearch] = useState('')
  const [results, setResults] = useState({ users: [], chats: [], combined: [] })
  const [activeChatId, setActiveChatId] = useState(null)
  const [draft, setDraft] = useState('')
  const [connected, setConnected] = useState(false)
  const [groupBuilderOpen, setGroupBuilderOpen] = useState(false)
  const [groupTitle, setGroupTitle] = useState('')
  const [groupMembers, setGroupMembers] = useState([])

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) || null,
    [activeChatId, chats]
  )

  const activeMessages = useMemo(
    () => (activeChatId ? (messagesByChat[activeChatId] || []) : []),
    [activeChatId, messagesByChat]
  )

  // Автоскролл к последнему сообщению: при смене чата и при новом сообщении
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeChatId, activeMessages.length])

  const formatPreview = (message) => {
    if (!message) return ''
    const author = message.sender ? getAuthorDisplayName(message.sender) : 'User'
    const text = message.text && message.text.trim() ? message.text : 'Файл'
    return message.sender?.id === user?.id ? `Вы: ${text}` : `${author}: ${text}`
  }

  const getLastMessagePreview = (chat) => {
    // Сначала lastMessage с сервера (актуально для всех чатов, включая неоткрытые)
    if (chat.lastMessage?.id && chat.lastMessage.text) {
      return formatPreview(chat.lastMessage)
    }

    // Запасной вариант — последнее из загруженных сообщений
    const chatMessages = messagesByChat[chat.id] || []
    const lastMessage = chatMessages.length ? chatMessages[chatMessages.length - 1] : null
    if (!lastMessage) return 'Пока нет сообщений'
    return formatPreview(lastMessage)
  }

  const getDirectChatTitle = (chat) => {
    if (!chat) return 'Чат'
    if (chat.type !== 'direct') return chat.title || 'Групповой чат'

    const other = (chat.participants || []).find((participant) => participant?.id !== user?.id)
    if (other) return other.displayName || other.username || other.email?.split('@')[0] || 'Чат'
    return chat.title || 'Чат'
  }

  const isChatUsable = (chat) => {
    if (!chat) return false
    if (chat.type !== 'direct') return true
    if (chat.title) return true
    const other = (chat.participants || []).find((p) => p?.id && p.id !== user?.id)
    return Boolean(other && (other.displayName || other.username || other.email))
  }

  const refreshChats = async () => {
    try {
      const response = await axios.get('/api/chats')
      if (response.data.success) {
        const nextChats = (response.data.chats || []).filter(isChatUsable)
        setChats(nextChats)

        if (activeChatIdRef.current && !nextChats.some((chat) => chat.id === activeChatIdRef.current)) {
          setActiveChatId(nextChats[0]?.id || null)
        } else if (!activeChatIdRef.current && nextChats.length) {
          setActiveChatId(nextChats[0].id)
        }
      }
    } catch (error) {
      console.warn('Не удалось загрузить чаты', error)
    }
  }

  const appendMessageToChat = (chatId, message) => {
    setMessagesByChat((prev) => {
      const current = prev[chatId] || []
      const exists = current.some((item) => item.id === message.id)
      if (exists) return prev

      return {
        ...prev,
        [chatId]: [...current, message]
      }
    })
  }

  const updateChatPreview = (chatId, message) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat
        return {
          ...chat,
          lastMessage: {
            id: message.id,
            text: message.text,
            sender: message.sender || null,
            createdAt: message.createdAt || null
          }
        }
      })
    )
  }

  const loadMessages = async (chatId) => {
    if (!chatId) return

    try {
      const response = await axios.get(`/api/chats/${chatId}/messages`)
      if (response.data.success) {
        const nextMessages = response.data.messages || []
        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: nextMessages
        }))
      }
    } catch (error) {
      console.warn('Не удалось загрузить сообщения', error)
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: []
      }))
    }
  }

  const searchUsersAndChats = async (value) => {
    const query = value.trim()
    if (!query) {
      setResults({ users: [], chats: [], combined: [] })
      return
    }

    try {
      const response = await axios.get('/api/chats/search', { params: { q: query } })
      if (response.data.success) {
        setResults(response.data)
      }
    } catch (error) {
      console.warn('Ошибка поиска чатов', error)
    }
  }

  const openChatByResult = async (result) => {
    if (!result) return

    if (groupBuilderOpen && result.type === 'user') {
      setGroupMembers((prev) => {
        const exists = prev.some((memberId) => memberId === result.id)
        return exists ? prev.filter((memberId) => memberId !== result.id) : [...prev, result.id]
      })
      return
    }

    if (result.type === 'user') {
      const response = await axios.post('/api/chats/direct', { userId: result.id })
      if (response.data.success) {
        await refreshChats()
        setActiveChatId(response.data.chat.id)
        setSearch('')
        setResults({ users: [], chats: [], combined: [] })
      }
      return
    }

    if (result.type === 'chat' || result.id) {
      setActiveChatId(result.id)
      setSearch('')
      setResults({ users: [], chats: [], combined: [] })
    }
  }

  const createGroupChat = async () => {
    if (!groupTitle.trim() || groupMembers.length === 0) return

    try {
      const response = await axios.post('/api/chats/group', {
        title: groupTitle.trim(),
        participantIds: groupMembers
      })

      if (response.data.success) {
        await refreshChats()
        setActiveChatId(response.data.chat.id)
        setGroupBuilderOpen(false)
        setGroupTitle('')
        setGroupMembers([])
        setSearch('')
        setResults({ users: [], chats: [], combined: [] })
      }
    } catch (error) {
      console.warn('Ошибка создания группы', error)
    }
  }

  const sendMessage = async () => {
    if (!draft.trim() || !activeChatId) return

    const text = draft.trim()
    setDraft('')

    try {
      const response = await axios.post(`/api/chats/${activeChatId}/messages`, {
        text
      })

      if (response.data.success) {
        // Сообщение придет через socket событие 'chat:message'
        // Не добавляем его локально
      }
    } catch (error) {
      console.warn('Ошибка отправки сообщения', error)
    }
  }

  useEffect(() => {
    if (!user) return

    refreshChats()

    const socket = io(API_BASE, {
      transports: ['websocket'],
      reconnection: true,
      auth: { token }
    })

    socketRef.current = socket

    const onConnect = () => {
      setConnected(true)
      // После (пере)подключения повторно входим в активную комнату
      if (activeChatIdRef.current) {
        socket.emit('join-room', activeChatIdRef.current)
      }
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', () => setConnected(false))

    socket.on('chat:message', (payload) => {
      if (!payload || !payload.chatId) return

      const incomingMessage = {
        id: payload.id,
        text: payload.text,
        sender: payload.sender || { id: payload.userId || 'server', username: 'server', showUsername: true },
        createdAt: payload.createdAt || new Date().toISOString()
      }

      appendMessageToChat(payload.chatId, incomingMessage)
      updateChatPreview(payload.chatId, incomingMessage)
    })

    return () => {
      socket.off('connect', onConnect)
      socket.disconnect()
    }
  }, [user, token])

  useEffect(() => {
    if (!activeChatId) {
      activeChatIdRef.current = null
      return
    }

    // Покидаем предыдущую комнату
    if (joinedRoomRef.current && joinedRoomRef.current !== activeChatId) {
      socketRef.current?.emit('leave-room', joinedRoomRef.current)
    }

    activeChatIdRef.current = activeChatId
    joinedRoomRef.current = activeChatId
    socketRef.current?.emit('join-room', activeChatId)
    loadMessages(activeChatId)
  }, [activeChatId])

  useEffect(() => {
    // Debounce: запрос каждый раз, когда пользователь перестаёт печатать на полсекунды
    const timer = setTimeout(() => {
      searchUsersAndChats(search)
    }, 500)

    return () => clearTimeout(timer)
  }, [search])

  const chatTitle = activeChat ? getDirectChatTitle(activeChat) : 'Выберите чат'

  return (
    <section className="chat-panel messenger-shell">
      <div className="chat-panel__toolbar-row">
        <div className="chat-panel__toolbar-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск: @username, #id или название чата"
          />

          {search && (
            <div className="chat-panel__search-results">
              {results.combined.length === 0 ? (
                <p className="chat-panel__empty">Ничего не найдено.</p>
              ) : (
                results.combined.map((result) => (
                  <button
                    key={result.type === 'user' ? `user-${result.id}` : `chat-${result.id}`}
                    type="button"
                    className="chat-panel__result"
                    onClick={() => openChatByResult(result)}
                  >
                    <strong>{result.name || result.username || result.email || 'Чат'}</strong>
                    <small>
                      {result.type === 'user'
                        ? `@${result.username || result.email?.split('@')[0]} · ${result.searchId || '#id'}`
                        : `чат · ${result.type}`}
                    </small>
                    {groupBuilderOpen && result.type === 'user' && (
                      <span className="chat-panel__select-hint">
                        {groupMembers.includes(result.id) ? 'Убрано из группы' : 'Добавить в группу'}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button type="button" className="chat-panel__group-button" onClick={() => setGroupBuilderOpen((prev) => !prev)}>
          {groupBuilderOpen ? 'Закрыть' : 'Новая группа'}
        </button>
      </div>

      {groupBuilderOpen && (
        <div className="chat-panel__group-builder">
          <input
            value={groupTitle}
            onChange={(event) => setGroupTitle(event.target.value)}
            placeholder="Название группы"
          />
          <div className="chat-panel__selected-members">
            {groupMembers.length === 0 ? (
              <span className="chat-panel__empty">Выберите участников</span>
            ) : (
              results.users
                .filter((resultUser) => groupMembers.includes(resultUser.id))
                .map((resultUser) => (
                  <button
                    key={resultUser.id}
                    type="button"
                    className="chat-panel__chip"
                    onClick={() => setGroupMembers((prev) => prev.filter((memberId) => memberId !== resultUser.id))}
                  >
                    @{resultUser.username || resultUser.email?.split('@')[0]}
                  </button>
                ))
            )}
          </div>
          <button type="button" className="chat-panel__create-group" onClick={createGroupChat} disabled={!groupTitle.trim() || groupMembers.length === 0}>
            Создать группу
          </button>
        </div>
      )}

      <div className="chat-panel__body">
        <aside className="chat-panel__sidebar">
          {chats.length === 0 ? (
            <p className="chat-panel__empty">Пока нет чатов</p>
          ) : (
            chats.map((chat) => (
              <button
                type="button"
                key={chat.id}
                className={`chat-panel__chat ${activeChatId === chat.id ? 'active' : ''}`}
                onClick={() => setActiveChatId(chat.id)}
              >
                <div className="chat-panel__chat-main">
                  <span className="chat-panel__chat-name">{getDirectChatTitle(chat)}</span>
                  <small className="chat-panel__chat-preview">{getLastMessagePreview(chat)}</small>
                </div>
                <span className="chat-panel__chat-badge">{chat.type === 'group' ? 'G' : 'D'}</span>
              </button>
            ))
          )}
        </aside>

        <div className="chat-panel__window">
          {!activeChat ? (
            <div className="chat-panel__empty-state">
              <h3>Сообщения</h3>
              <p>Выберите чат, чтобы начать переписку</p>
            </div>
          ) : (
            <>
              <div className="chat-panel__window-header">
                <div>
                  <strong>{chatTitle}</strong>
                </div>
                <span
                  className={`chat-panel__status ${connected ? 'online' : 'offline'}`}
                  title={connected ? 'Соединение с сервером активно' : 'Нет соединения с сервером'}
                >
                  {connected ? 'Подключено' : 'Нет соединения'}
                </span>
              </div>

              <div
                ref={messagesRef}
                className="chat-panel__messages"
              >
                {activeMessages.length === 0 ? (
                  <p className="chat-panel__empty">Начните диалог</p>
                ) : (
                  activeMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`chat-panel__message ${message.sender?.id === user?.id ? 'self' : ''}`}
                      style={{ borderColor: message.sender?.color || undefined }}
                    >
                      <span>{message.sender ? getAuthorDisplayName(message.sender) : 'User'}</span>
                      <p>{message.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="chat-panel__composer">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Написать сообщение..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') sendMessage()
                  }}
                />
                <button type="button" onClick={sendMessage} disabled={!draft.trim()}>
                  Отправить
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </section>
  )
}

export default ChatPanel
