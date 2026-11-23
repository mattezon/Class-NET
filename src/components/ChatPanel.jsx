import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { io } from 'socket.io-client'
import useAuthStore from '../store/authStore'
import { getAuthorDisplayName } from '../utils/userName'
import { extractMentionTokens, isMentioned } from '../utils/mentions'
import { chatApi } from '../api/chat'
import useToastStore from '../store/toastStore'
import './ChatPanel.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const getMemberUsername = (member) => {
  if (!member) return 'Участник'
  if (member.showUsername === false) return member.email || 'Участник'
  return member.username || member.displayName || member.name || member.email?.split('@')[0] || member.id || 'Участник'
}

const getMentionHandle = (member) => {
  if (!member) return ''
  const handle = member.username || member.email?.split('@')[0] || ''
  return handle.replace(/\s+/g, '_')
}

const ChatPanel = () => {
  const { user, token } = useAuthStore()
  const toast = useToastStore((state) => state.push)
  const socketRef = useRef(null)
  const activeChatIdRef = useRef(null)
  const joinedRoomRef = useRef(null)
  const messagesRef = useRef(null)
  const modalRef = useRef(null)
  const returnFocusRef = useRef(null)
  const typingTimerRef = useRef(null)
  const typingSentRef = useRef(false)
  const composerInputRef = useRef(null)
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
  const [groupError, setGroupError] = useState('')
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [participantsQuery, setParticipantsQuery] = useState('')
  const [participantsResults, setParticipantsResults] = useState([])
  const [participantsError, setParticipantsError] = useState('')
  const [participantsBusy, setParticipantsBusy] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState({})
  const [typingByChat, setTypingByChat] = useState({})
  const [messagesMeta, setMessagesMeta] = useState({})
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [chatSearchResults, setChatSearchResults] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState(null)
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false)
  const [groupSettings, setGroupSettings] = useState({ title: '', color: '' })
  const [groupSettingsError, setGroupSettingsError] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const toggleGroupMember = (result) => {
    if (!result?.id || result.isCurrentUser) return
    setGroupMembers((prev) => {
      const exists = prev.some((member) => member.id === result.id)
      if (exists) return prev.filter((member) => member.id !== result.id)
      return [
        ...prev,
        {
          id: result.id,
          username: result.username || '',
          email: result.email || '',
          displayName: result.name || result.displayName || '',
          showUsername: result.showUsername ?? true,
          searchId: result.searchId || ''
        }
      ]
    })
  }

  useEffect(() => {
    if (!results.users?.length) return
    setGroupMembers((prev) =>
      prev.map((member) => {
        const fresh = results.users.find((user) => user.id === member.id)
        return fresh
          ? {
              ...member,
              username: fresh.username || member.username,
              email: fresh.email || member.email,
              displayName: fresh.name || member.displayName,
              showUsername: fresh.showUsername ?? member.showUsername
            }
          : member
      })
    )
  }, [results.users])

  const isGroupAdmin = (chat) => {
    if (!chat || chat.type !== 'group') return false
    const admins = chat.admins?.length ? chat.admins : [chat.createdBy]
    return admins.includes(user?.id)
  }

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) || null,
    [activeChatId, chats]
  )

  const mentionMatches = useMemo(() => {
    const match = draft.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u)
    if (!match || !activeChat?.participants?.length) return []
    const query = match[1].toLocaleLowerCase()
    return activeChat.participants
      .filter((member) => String(member.id || member._id) !== String(user?.id))
      .map((member) => ({ member, handle: getMentionHandle(member) }))
      .filter(({ member, handle }) => {
        if (!handle) return false
        return handle.toLocaleLowerCase().includes(query) || getMemberUsername(member).toLocaleLowerCase().includes(query)
      })
      .slice(0, 6)
  }, [draft, activeChat, user?.id])

  const insertMention = (member) => {
    const handle = getMentionHandle(member)
    if (!handle) return
    setDraft((prev) => prev.replace(/(^|\s)@[\p{L}\p{N}_.-]*$/u, (_, prefix) => `${prefix}@${handle} `))
    setMentionIndex(0)
    composerInputRef.current?.focus()
  }

  const activeMessages = useMemo(
    () => (activeChatId ? (messagesByChat[activeChatId] || []) : []),
    [activeChatId, messagesByChat]
  )

  // Автоскролл к последнему сообщению: после отрисовки списка и в следующем кадре
  useLayoutEffect(() => {
    const el = messagesRef.current
    if (!el) return

    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight
    }

    scrollToBottom()
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
  }, [activeChatId, activeMessages.length, activeMessages[activeMessages.length - 1]?.id])

  const formatPreview = (message) => {
    if (!message) return ''
    if (message.kind === 'system') return message.text || ''
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
      const response = await chatApi.getChats()
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

  const loadMessages = async (chatId, params = {}) => {
    if (!chatId) return

    setMessagesMeta((prev) => ({
      ...prev,
      [chatId]: { ...(prev[chatId] || {}), loading: true }
    }))

    try {
      const response = await chatApi.getMessages(chatId, params)
      if (response.data.success) {
        const nextMessages = response.data.messages || []
        setMessagesByChat((prev) => {
          const current = params.before ? (prev[chatId] || []) : []
          const existingIds = new Set(nextMessages.map((message) => message.id))
          const merged = params.before
            ? [...nextMessages, ...current.filter((message) => !existingIds.has(message.id))]
            : nextMessages
          return { ...prev, [chatId]: merged }
        })
        setMessagesMeta((prev) => ({
          ...prev,
          [chatId]: {
            hasMore: Boolean(response.data.hasMore),
            nextCursor: response.data.nextCursor || null,
            loading: false
          }
        }))
        if (!params.before && !params.around) {
          chatApi.markRead(chatId).catch((error) => console.warn('Не удалось отметить прочитанным', error))
        }
      }
    } catch (error) {
      console.warn('Не удалось загрузить сообщения', error)
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: params.before ? (prev[chatId] || []) : []
      }))
      setMessagesMeta((prev) => ({ ...prev, [chatId]: { hasMore: false, nextCursor: null, loading: false } }))
    }
  }

  const loadOlderMessages = async () => {
    const meta = messagesMeta[activeChatId]
    if (!activeChatId || !meta?.hasMore || !meta.nextCursor || meta.loading) return

    const container = messagesRef.current
    const previousHeight = container?.scrollHeight || 0
    await loadMessages(activeChatId, { before: meta.nextCursor, limit: 30 })
    requestAnimationFrame(() => {
      if (container) container.scrollTop = container.scrollHeight - previousHeight
    })
  }

  const searchUsersAndChats = async (value) => {
    const query = value.trim()
    if (!query) {
      setResults({ users: [], chats: [], combined: [] })
      return
    }

    try {
      const response = await chatApi.search(query)
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
      toggleGroupMember(result)
      return
    }

    if (result.type === 'user') {
      const response = await chatApi.createDirect(result.id)
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
    setGroupError('')

    try {
      const response = await chatApi.createGroup(
        groupTitle.trim(),
        groupMembers.map((member) => member.id)
      )

      if (response.data.success) {
        await refreshChats()
        setActiveChatId(response.data.chat.id)
        setGroupBuilderOpen(false)
        setGroupTitle('')
        setGroupMembers([])
        setSearch('')
        setResults({ users: [], chats: [], combined: [] })
        setGroupError('')
      } else {
        setGroupError(response.data.message || 'Не удалось создать группу')
      }
    } catch (error) {
      console.warn('Ошибка создания группы', error)
      setGroupError(error.response?.data?.message || 'Не удалось создать группу')
    }
  }

  const runParticipantsAction = async (request) => {
    setParticipantsBusy(true)
    setParticipantsError('')

    try {
      const response = await request()
      if (!response.data.success) {
        setParticipantsError(response.data.message || 'Не удалось изменить состав группы')
        return false
      }
      await refreshChats()
      setParticipantsQuery('')
      setParticipantsResults([])
      return true
    } catch (error) {
      console.warn('Ошибка управления участниками', error)
      setParticipantsError(error.response?.data?.message || 'Не удалось изменить состав группы')
      return false
    } finally {
      setParticipantsBusy(false)
    }
  }

  const addGroupParticipant = (userId) =>
    runParticipantsAction(() => chatApi.addParticipant(activeChatId, userId))

  const removeGroupParticipant = (userId) =>
    runParticipantsAction(() => chatApi.removeParticipant(activeChatId, userId))

  const toggleGroupAdmin = (userId) =>
    runParticipantsAction(() => chatApi.toggleAdmin(activeChatId, userId))

  const saveGroupSettings = async () => {
    if (!activeChatId || !groupSettings.title.trim()) return
    setGroupSettingsError('')
    try {
      const response = await chatApi.updateGroup(activeChatId, {
        title: groupSettings.title.trim(),
        color: groupSettings.color
      })
      if (!response.data.success) {
        setGroupSettingsError(response.data.message || 'Не удалось сохранить настройки')
        return
      }
      await refreshChats()
      setGroupSettingsOpen(false)
      toast('Настройки группы сохранены', 'success')
    } catch (error) {
      setGroupSettingsError(error.response?.data?.message || 'Не удалось сохранить настройки')
    }
  }

  const removeChatLocally = (chatId) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId))
    setMessagesByChat((prev) => {
      const next = { ...prev }
      delete next[chatId]
      return next
    })
  }

  const deleteChat = async (chat) => {
    if (!window.confirm(`Удалить чат «${getDirectChatTitle(chat)}» вместе со всеми сообщениями?`)) return

    try {
      const response = await chatApi.deleteChat(chat.id)
      if (response.data.success) {
        removeChatLocally(chat.id)
        if (activeChatIdRef.current === chat.id) {
          activeChatIdRef.current = null
          joinedRoomRef.current = null
          setActiveChatId(null)
          await refreshChats()
        }
      }
    } catch (error) {
      console.warn('Не удалось удалить чат', error)
    }
  }

  const leaveGroup = async (chatId = activeChatId) => {
    if (!chatId || !window.confirm('Покинуть группу?')) return
    try {
      const response = await chatApi.leaveGroup(chatId)
      if (!response.data.success) {
        toast(response.data.message || 'Не удалось покинуть группу', 'error')
        return
      }
      setParticipantsOpen(false)
      removeChatLocally(chatId)
      if (activeChatIdRef.current === chatId) setActiveChatId(null)
      await refreshChats()
    } catch (error) {
      toast(error.response?.data?.message || 'Не удалось покинуть группу', 'error')
    }
  }

  const deleteOrLeaveChat = (chat) => {
    if (chat?.type === 'group' && !isGroupAdmin(chat)) {
      leaveGroup(chat.id)
      return
    }
    deleteChat(chat)
  }

  const clearChatMessages = async () => {
    if (!activeChatId || !window.confirm('Удалить все сообщения в этом чате?')) return

    try {
      const response = await chatApi.clearMessages(activeChatId)
      if (response.data.success) {
        setMessagesByChat((prev) => ({ ...prev, [activeChatId]: [] }))
        setChats((prev) => prev.map((chat) => (
          chat.id === activeChatId ? { ...chat, lastMessage: null } : chat
        )))
      }
    } catch (error) {
      console.warn('Не удалось удалить сообщения', error)
    }
  }

  const deleteMessage = async (messageId) => {
    if (!activeChatId || !window.confirm('Удалить это сообщение?')) return

    try {
      const response = await chatApi.deleteMessage(activeChatId, messageId)
      if (response.data.success) {
        setMessagesByChat((prev) => ({
          ...prev,
          [activeChatId]: (prev[activeChatId] || []).filter((message) => message.id !== messageId)
        }))
      }
    } catch (error) {
      console.warn('Не удалось удалить сообщение', error)
    }
  }

  const sendMessage = async () => {
    if (!draft.trim() || !activeChatId) return

    const chatId = activeChatId
    const text = draft.trim()
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const previousReplyTo = replyTo
    const mentions = extractMentionTokens(text)
    const pendingMessage = {
      id: clientId,
      clientId,
      text,
      sender: user ? { id: user.id, username: user.username, displayName: user.displayName, email: user.email, showUsername: user.showUsername ?? true, color: user.color } : null,
      chatId,
      kind: 'text',
      mentions,
      replyTo: replyTo ? { id: replyTo.id, text: replyTo.text, sender: replyTo.sender } : null,
      createdAt: new Date().toISOString(),
      pending: true
    }

    appendMessageToChat(chatId, pendingMessage)
    setDraft('')
    setReplyTo(null)
    socketRef.current?.emit('typing-stop', chatId)

    try {
      const response = await chatApi.sendMessage(chatId, {
        text,
        clientId,
        replyToId: previousReplyTo?.id || undefined
      })
      if (!response.data.success) throw new Error(response.data.message || 'Не удалось отправить')

      const confirmed = { ...response.data.message, pending: false }
      setMessagesByChat((prev) => {
        const list = (prev[chatId] || []).map((message) => (
          message.id === clientId ? confirmed : message
        ))
        const seen = new Set()
        const deduped = list.filter((message) => {
          if (seen.has(message.id)) return false
          seen.add(message.id)
          return true
        })
        return { ...prev, [chatId]: deduped }
      })
    } catch (error) {
      console.warn('Ошибка отправки сообщения', error)
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map((message) => (
          message.id === clientId ? { ...message, pending: false, failed: true } : message
        ))
      }))
      setDraft((current) => current || text)
      if (previousReplyTo) setReplyTo(previousReplyTo)
      toast(error.response?.data?.message || 'Сообщение не отправлено', 'error')
    }
  }

  const retryMessage = async (message) => {
    if (!message?.failed || !activeChatId) return
    setMessagesByChat((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).filter((item) => item.id !== message.id)
    }))
    setDraft(message.text)
    if (message.replyTo?.id) {
      setReplyTo(message.replyTo)
    }
  }

  const notifyTyping = () => {
    if (!activeChatId || typingSentRef.current) return
    typingSentRef.current = true
    socketRef.current?.emit('typing-start', activeChatId)
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      socketRef.current?.emit('typing-stop', activeChatId)
      typingSentRef.current = false
    }, 1500)
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
        ...payload,
        sender: payload.sender || { id: payload.userId || 'server', username: 'server', showUsername: true },
        createdAt: payload.createdAt || new Date().toISOString()
      }

      setMessagesByChat((prev) => {
        const list = prev[payload.chatId] || []
        if (payload.clientId) {
          const pendingIndex = list.findIndex((message) => message.clientId === payload.clientId && message.pending)
          if (pendingIndex >= 0) {
            const next = [...list]
            next[pendingIndex] = incomingMessage
            const seen = new Set()
            return {
              ...prev,
              [payload.chatId]: next.filter((message) => {
                if (seen.has(message.id)) return false
                seen.add(message.id)
                return true
              })
            }
          }
        }
        if (list.some((message) => message.id === incomingMessage.id)) return prev
        return { ...prev, [payload.chatId]: [...list, incomingMessage] }
      })
      updateChatPreview(payload.chatId, incomingMessage)

      if (payload.chatId !== activeChatIdRef.current && payload.kind !== 'system') {
        setChats((prev) => prev.map((chat) => (
          chat.id === payload.chatId ? { ...chat, unreadCount: (chat.unreadCount || 0) + 1 } : chat
        )))
      }
    })

    socket.on('chat:read', ({ chatId, userId: readerId, readAt }) => {
      if (!chatId || !readerId) return
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map((message) => (
          message.sender?.id === readerId
            ? { ...message, readBy: [...new Set([...(message.readBy || []), readerId])], readAt }
            : message
        ))
      }))
    })

    socket.on('chat:typing', ({ chatId, userId: typingUserId, typing }) => {
      if (!chatId || typingUserId === user?.id) return
      setTypingByChat((prev) => ({ ...prev, [chatId]: typing }))
    })

    socket.on('presence:update', ({ userId: presenceUserId, online }) => {
      setOnlineUsers((prev) => ({ ...prev, [presenceUserId]: online }))
    })

    socket.on('chat:message-deleted', ({ chatId, messageId }) => {
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).filter((message) => message.id !== messageId)
      }))
      setChats((prev) => prev.map((chat) => (
        chat.id === chatId && chat.lastMessage?.id === messageId
          ? { ...chat, lastMessage: null }
          : chat
      )))
    })

    socket.on('chat:messages-cleared', ({ chatId }) => {
      setMessagesByChat((prev) => ({ ...prev, [chatId]: [] }))
      setChats((prev) => prev.map((chat) => (
        chat.id === chatId ? { ...chat, lastMessage: null } : chat
      )))
    })

    socket.on('chat:participants-updated', () => {
      refreshChats()
    })

    socket.on('chat:added', () => refreshChats())
    socket.on('chat:removed', ({ chatId }) => {
      removeChatLocally(chatId)
      if (activeChatIdRef.current === chatId) {
        setActiveChatId(null)
      }
      toast('Вас удалили из группы или чат стал недоступен', 'info')
    })
    socket.on('chat:updated', () => refreshChats())
    socket.on('chat:mention', ({ chatId, sender, text }) => {
      if (chatId === activeChatIdRef.current) return
      toast(`${getAuthorDisplayName(sender)} упомянул вас: ${String(text || '').slice(0, 40)}`, 'info')
    })

    socket.on('chat:deleted', ({ chatId }) => {
      removeChatLocally(chatId)
      if (activeChatIdRef.current === chatId) {
        activeChatIdRef.current = null
        joinedRoomRef.current = null
        setActiveChatId(null)
      }
    })

    return () => {
      socket.off('connect', onConnect)
      socket.disconnect()
      clearTimeout(typingTimerRef.current)
    }
  }, [user, token])

  useEffect(() => {
    setParticipantsOpen(false)
    setParticipantsQuery('')
    setParticipantsResults([])
    setParticipantsError('')
    setChatSearchOpen(false)
    setChatSearchQuery('')
    setChatSearchResults([])
    setReplyTo(null)
    setHighlightedMessageId(null)
    setGroupSettingsOpen(false)
  }, [activeChatId])

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
    setChats((prev) => prev.map((chat) => (
      chat.id === activeChatId ? { ...chat, unreadCount: 0 } : chat
    )))
  }, [activeChatId])

  useEffect(() => {
    if (!chatSearchOpen || !chatSearchQuery.trim()) {
      setChatSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const response = await chatApi.searchMessages(activeChatId, chatSearchQuery.trim())
        if (response.data.success) setChatSearchResults(response.data.messages || [])
      } catch (error) {
        console.warn('Ошибка поиска по сообщениям', error)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [chatSearchOpen, chatSearchQuery, activeChatId])

  useEffect(() => {
    if (!participantsOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => modalRef.current?.querySelector('button, input')?.focus())

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setParticipantsOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = modalRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [participantsOpen])

  useEffect(() => {
    // Debounce: запрос каждый раз, когда пользователь перестаёт печатать на полсекунды
    const timer = setTimeout(() => {
      searchUsersAndChats(search)
    }, 500)

    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const query = participantsQuery.trim()
    if (!participantsOpen || !query) {
      setParticipantsResults([])
      return
    }

    const existingIds = new Set((activeChat?.participants || []).map((participant) => participant.id))
    const timer = setTimeout(async () => {
      try {
        const response = await chatApi.search(query)
        if (response.data.success) {
          setParticipantsResults((response.data.users || []).filter((user) => !existingIds.has(user.id)))
        }
      } catch (error) {
        console.warn('Ошибка поиска участников', error)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [participantsOpen, participantsQuery, activeChat?.participants])

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
                          {groupMembers.some((member) => member.id === result.id) ? 'Убрано из группы' : 'Добавить в группу'}
                        </span>
                      )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="chat-panel__group-button"
          onClick={() => {
            setGroupBuilderOpen((prev) => !prev)
            setGroupError('')
          }}
        >
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
              groupMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="chat-panel__chip"
                  title={member.email || getMemberUsername(member)}
                  onClick={() => setGroupMembers((prev) => prev.filter((item) => item.id !== member.id))}
                >
                  @{getMemberUsername(member)}
                </button>
              ))
            )}
          </div>
          {groupError && <p className="chat-panel__group-error">{groupError}</p>}
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
              <div
                key={chat.id}
                className={`chat-panel__chat ${activeChatId === chat.id ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveChatId(chat.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setActiveChatId(chat.id)
                  }
                }}
              >
                <div className="chat-panel__chat-main">
                  <span className="chat-panel__chat-name">
                    {chat.type === 'group' && chat.color && <i className="chat-panel__chat-dot" style={{ background: chat.color }} />}
                    {getDirectChatTitle(chat)}
                  </span>
                  <small className="chat-panel__chat-preview">{getLastMessagePreview(chat)}</small>
                </div>
                {chat.unreadCount > 0 && <span className="chat-panel__unread-badge">{chat.unreadCount}</span>}
                <button
                  type="button"
                  className="chat-panel__chat-delete"
                  title={chat.type === 'group' && !isGroupAdmin(chat) ? 'Выйти из группы' : 'Удалить чат'}
                  aria-label={chat.type === 'group' && !isGroupAdmin(chat) ? 'Выйти из группы' : 'Удалить чат'}
                  onClick={(event) => {
                    event.stopPropagation()
                    deleteOrLeaveChat(chat)
                  }}
                >
                  {chat.type === 'group' && !isGroupAdmin(chat) ? '⎋' : '🗑'}
                </button>
              </div>
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
                  <div className="chat-panel__title-row">
                    <strong style={activeChat.color ? { color: activeChat.color } : undefined}>{chatTitle}</strong>
                    {activeChat.type === 'group' && (
                      <>
                        <button
                          type="button"
                          className="chat-panel__participants-toggle"
                          title={participantsOpen ? 'Скрыть участников' : 'Показать участников'}
                          aria-expanded={participantsOpen}
                          onClick={() => {
                            returnFocusRef.current = document.activeElement
                            setParticipantsOpen((prev) => !prev)
                          }}
                        >
                          👥 {activeChat.participants?.length || 0}
                        </button>
                      </>
                    )}
                  </div>
                  {typingByChat[activeChatId] && <small className="chat-panel__typing">Печатает...</small>}
                </div>
                <div className="chat-panel__header-actions">
                  <button
                    type="button"
                    className="chat-panel__clear-messages chat-panel__clear-messages--search"
                    title="Поиск по сообщениям"
                    onClick={() => setChatSearchOpen((prev) => !prev)}
                  >
                    🔍
                  </button>
                  {(activeChat.type !== 'group' || isGroupAdmin(activeChat)) && (
                    <button
                      type="button"
                      className="chat-panel__clear-messages"
                      title="Удалить все сообщения в чате"
                      onClick={clearChatMessages}
                    >
                      🗑 Сообщения
                    </button>
                  )}
                  <span
                    className={`chat-panel__status ${connected ? 'online' : 'offline'}`}
                    title={connected ? 'Соединение с сервером активно' : 'Нет соединения с сервером'}
                  >
                    {connected ? 'Подключено' : 'Нет соединения'}
                  </span>
                </div>
              </div>

              {chatSearchOpen && (
                <div className="chat-panel__chat-search">
                  <input
                    value={chatSearchQuery}
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                    placeholder="Поиск по сообщениям"
                  />
                  {chatSearchQuery.trim() && (
                    <div className="chat-panel__chat-search-results">
                      {chatSearchResults.length === 0 ? (
                        <p className="chat-panel__empty">Ничего не найдено.</p>
                      ) : (
                        chatSearchResults.map((message) => (
                          <button
                            key={message.id}
                            type="button"
                            className="chat-panel__result"
                            onClick={async () => {
                              setHighlightedMessageId(message.id)
                              await loadMessages(activeChatId, { around: message.id, limit: 40 })
                              setChatSearchOpen(false)
                              setChatSearchQuery('')
                              requestAnimationFrame(() => {
                                const el = messagesRef.current?.querySelector(`[data-message-id="${message.id}"]`)
                                el?.scrollIntoView({ block: 'center' })
                                setTimeout(() => setHighlightedMessageId(null), 2000)
                              })
                            }}
                          >
                            <strong>{message.sender ? getAuthorDisplayName(message.sender) : 'User'}</strong>
                            <small>{message.text}</small>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div
                ref={messagesRef}
                className="chat-panel__messages"
              >
                {messagesMeta[activeChatId]?.hasMore && (
                  <button type="button" className="chat-panel__load-more" onClick={loadOlderMessages} disabled={messagesMeta[activeChatId]?.loading}>
                    {messagesMeta[activeChatId]?.loading ? 'Загрузка...' : 'Загрузить ещё'}
                  </button>
                )}
                {activeMessages.length === 0 ? (
                  <p className="chat-panel__empty">Начните диалог</p>
                ) : (
                  activeMessages.map((message) => {
                    if (message.kind === 'system') {
                      return (
                        <div key={message.id} className="chat-panel__system-message" data-message-id={message.id}>
                          {message.text}
                        </div>
                      )
                    }
                    const isOwn = message.sender?.id === user?.id
                    const canDelete = isOwn || isGroupAdmin(activeChat)
                    const isReadByOthers = (message.readBy || []).some((id) => id !== user?.id)
                    const mentionSelf = isMentioned(message.text, user)
                    return (
                      <div
                        key={message.id}
                        data-message-id={message.id}
                        className={`chat-panel__message ${isOwn ? 'self' : ''} ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''} ${highlightedMessageId === message.id ? 'highlighted' : ''} ${mentionSelf ? 'mentioned' : ''}`}
                        style={{ borderColor: message.sender?.color || undefined }}
                      >
                        <div className="chat-panel__message-top">
                          <span>{message.sender ? getAuthorDisplayName(message.sender) : 'User'}</span>
                          <div className="chat-panel__message-actions">
                            <button type="button" className="chat-panel__message-delete" title="Ответить" onClick={() => setReplyTo(message)}>↩</button>
                            {canDelete && (
                              <button
                                type="button"
                                className="chat-panel__message-delete"
                                title="Удалить сообщение"
                                aria-label="Удалить сообщение"
                                onClick={() => deleteMessage(message.id)}
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </div>
                        {message.replyTo?.text && (
                          <div className="chat-panel__reply-quote">
                            <small>{message.replyTo.sender ? getAuthorDisplayName(message.replyTo.sender) : 'User'}</small>
                            <p>{message.replyTo.text}</p>
                          </div>
                        )}
                        <p>{message.text}</p>
                        <div className="chat-panel__message-meta">
                          {message.failed && <button type="button" className="chat-panel__retry" onClick={() => retryMessage(message)}>Повторить</button>}
                          {isOwn && <small>{message.failed ? 'ошибка' : message.pending ? '...' : isReadByOthers ? '✓✓' : '✓'}</small>}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="chat-panel__composer-wrap">
                {replyTo && (
                  <div className="chat-panel__reply-preview">
                    <div>
                      <small>Ответ: {replyTo.sender ? getAuthorDisplayName(replyTo.sender) : 'User'}</small>
                      <p>{replyTo.text}</p>
                    </div>
                    <button type="button" onClick={() => setReplyTo(null)}>×</button>
                  </div>
                )}
                <div className="chat-panel__composer">
                  {mentionMatches.length > 0 && (
                    <div className="chat-panel__mention-menu" role="listbox">
                      {mentionMatches.map(({ member, handle }, index) => (
                        <button
                          key={String(member.id || member._id || handle)}
                          type="button"
                          role="option"
                          aria-selected={index === mentionIndex}
                          className={`chat-panel__mention-option ${index === mentionIndex ? 'active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertMention(member)}
                        >
                          <strong>@{handle}</strong>
                          <small>{getMemberUsername(member)}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    ref={composerInputRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setMentionIndex(0)
                      if (event.target.value.trim()) notifyTyping()
                      else socketRef.current?.emit('typing-stop', activeChatId)
                    }}
                    placeholder="Написать сообщение..."
                    onKeyDown={(event) => {
                      if (mentionMatches.length > 0) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          setMentionIndex((prev) => (prev + 1) % mentionMatches.length)
                          return
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          setMentionIndex((prev) => (prev - 1 + mentionMatches.length) % mentionMatches.length)
                          return
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          insertMention(mentionMatches[mentionIndex]?.member || mentionMatches[0].member)
                          return
                        }
                      }
                      if (event.key === 'Enter') sendMessage()
                    }}
                  />
                  <button type="button" onClick={sendMessage} disabled={!draft.trim()}>
                    Отправить
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {participantsOpen && activeChat?.type === 'group' &&
        createPortal(
          <div
            className="chat-panel__participants-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setParticipantsOpen(false)
            }}
          >
            <div className="chat-panel__participants" ref={modalRef} role="dialog" aria-modal="true" aria-label="Участники группы">
              <div className="chat-panel__participants-head">
                <strong>Участники</strong>
                <button
                  type="button"
                  className="chat-panel__participants-close"
                  title="Закрыть список"
                  aria-label="Закрыть список участников"
                  onClick={() => setParticipantsOpen(false)}
                >
                  ×
                </button>
              </div>

              <div className="chat-panel__participants-list">
                {(activeChat.participants || []).map((participant) => {
                  const participantIsAdmin = (activeChat.admins || []).includes(participant.id)
                  const isLastAdmin = participantIsAdmin && (activeChat.admins || []).length === 1
                  const isOnline = onlineUsers[participant.id]
                  return (
                    <div key={participant.id} className="chat-panel__participant-row">
                      <span
                        className="chat-panel__participant"
                        title={participant.email || getMemberUsername(participant)}
                      >
                        <i className={`chat-panel__presence-dot ${isOnline ? 'online' : ''}`} />
                        {participant.id === user?.id ? 'Вы' : getMemberUsername(participant)}
                        {participantIsAdmin && <em className="chat-panel__admin-badge">админ</em>}
                      </span>
                      {isGroupAdmin(activeChat) && (
                        <div className="chat-panel__participant-actions">
                          <button
                            type="button"
                            className="chat-panel__participant-action"
                            disabled={participantsBusy || isLastAdmin}
                            title={isLastAdmin ? 'В группе должен остаться администратор' : undefined}
                            onClick={() => toggleGroupAdmin(participant.id)}
                          >
                            {participantIsAdmin ? 'Снять права' : 'Назначить'}
                          </button>
                          {participant.id !== user?.id && (
                            <button
                              type="button"
                              className="chat-panel__participant-action chat-panel__participant-action--danger"
                              disabled={participantsBusy}
                              onClick={() => removeGroupParticipant(participant.id)}
                            >
                              Убрать
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {isGroupAdmin(activeChat) && (
                <div className="chat-panel__participants-add">
                  <input
                    value={participantsQuery}
                    onChange={(event) => setParticipantsQuery(event.target.value)}
                    placeholder="Добавить участника"
                    disabled={participantsBusy}
                  />
                  {participantsQuery.trim() && (
                    <div className="chat-panel__participants-results">
                      {participantsResults.length === 0 ? (
                        <span className="chat-panel__empty">Никого не найдено</span>
                      ) : (
                        participantsResults.map((resultUser) => (
                          <button
                            key={resultUser.id}
                            type="button"
                            className="chat-panel__participant-result"
                            disabled={participantsBusy}
                            onClick={() => addGroupParticipant(resultUser.id)}
                          >
                            <span>{getMemberUsername(resultUser)}</span>
                            <span>+</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {isGroupAdmin(activeChat) && (
                <div className="chat-panel__group-settings">
                  <button
                    type="button"
                    className="chat-panel__participant-action"
                    onClick={() => {
                      setGroupSettings({ title: activeChat.title || '', color: activeChat.color || '' })
                      setGroupSettingsOpen((prev) => !prev)
                    }}
                  >
                    Настройки группы
                  </button>
                  {groupSettingsOpen && (
                    <div className="chat-panel__group-settings-form">
                      <input
                        value={groupSettings.title}
                        onChange={(event) => setGroupSettings((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder="Название группы"
                      />
                      <div className="chat-panel__color-row">
                        {['', '#4c7aff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'].map((color) => (
                          <button
                            key={color || 'none'}
                            type="button"
                            className={`chat-panel__color-swatch ${groupSettings.color === color ? 'active' : ''}`}
                            style={{ background: color || 'var(--surface-soft)' }}
                            onClick={() => setGroupSettings((prev) => ({ ...prev, color }))}
                            title={color || 'Без цвета'}
                          >
                            {color ? '' : '×'}
                          </button>
                        ))}
                      </div>
                      <button type="button" className="chat-panel__participant-action" onClick={saveGroupSettings}>Сохранить</button>
                      {groupSettingsError && <p className="chat-panel__group-error">{groupSettingsError}</p>}
                    </div>
                  )}
                </div>
              )}

              <div className="chat-panel__group-danger">
                <button
                  type="button"
                  className="chat-panel__participant-action chat-panel__participant-action--danger"
                  onClick={() => leaveGroup(activeChat.id)}
                >
                  Выйти из группы
                </button>
                {isGroupAdmin(activeChat) && (
                  <button
                    type="button"
                    className="chat-panel__participant-action chat-panel__participant-action--danger"
                    onClick={() => deleteChat(activeChat)}
                  >
                    Удалить группу
                  </button>
                )}
              </div>

              {participantsError && <p className="chat-panel__group-error">{participantsError}</p>}
            </div>
          </div>,
          document.body
        )}

    </section>
  )
}

export default ChatPanel
