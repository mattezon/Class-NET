const Chat = require('../models/Chat.cjs');
const Message = require('../models/Message.cjs');
const User = require('../models/User.cjs');
const mongoose = require('mongoose');
const { normalizeChatQuery, matchChatSearch } = require('../utils/chatSearch.cjs');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const serializeUser = (user) => ({
  id: user?._id?.toString?.() || user?.id || null,
  email: user?.email || '',
  username: user?.username || user?.email?.split('@')[0] || '',
  displayName: user?.displayName || user?.email?.split('@')[0] || '',
  showUsername: user?.showUsername ?? true,
  color: user?.color || null
});

const serializeLastMessage = (lastMessage) => {
  if (!lastMessage || !lastMessage._id) return null;

  return {
    id: lastMessage._id?.toString?.() || lastMessage.id || null,
    text: lastMessage.text || '',
    sender: serializeUser(lastMessage.sender),
    createdAt: lastMessage.createdAt || null
  };
};

const serializeChat = (chat, currentUserId) => {
  const participants = Array.isArray(chat?.participants) ? chat.participants : [];

  return {
    id: chat?._id?.toString?.() || chat?.id || null,
    type: chat?.type || 'direct',
    title: chat?.title || '',
    createdBy: chat?.createdBy ? chat.createdBy.toString() : null,
    participants: participants.map((user) => serializeUser(user)),
    participantIds: participants.map((user) => user?._id?.toString?.() || user?.id || user),
    lastMessage: serializeLastMessage(chat?.lastMessage),
    updatedAt: chat?.updatedAt,
    createdAt: chat?.createdAt
  };
};

const getUserName = (user) => {
  if (!user) return '';
  return user.username || user.displayName || user.email?.split('@')[0] || '';
};

exports.getChats = async (req, res) => {
  try {
    const userId = req.user?.id;

    const chats = await Chat.find({ participants: userId })
      .populate('participants', '_id email username displayName showUsername color')
      .populate({ path: 'lastMessage', populate: { path: 'sender', select: '_id email username displayName showUsername color' } })
      .sort({ updatedAt: -1 });

    // Mongoose «выкидывает» мёртвые ссылки из participants после populate,
    // поэтому берём настоящий состав участников отдельным «сырым» запросом.
    const leanChats = await Chat.find({ _id: { $in: chats.map((c) => c._id) } })
      .select('participants')
      .lean();
    const rawParticipantMap = new Map(
      leanChats.map((d) => [d._id.toString(), d.participants.map((p) => p.toString())])
    );

    // Собираем id всех участников, чтобы понять, какие пользователи ещё существуют
    const rawParticipantIds = Array.from(rawParticipantMap.values()).flat();

    const existingSet = new Set(
      (await User.find({ _id: { $in: rawParticipantIds } }).select('_id')).map((u) => u._id.toString())
    );

    const toDeleteIds = [];
    const cleanedChats = [];

    for (const chat of chats) {
      const participantIds = rawParticipantMap.get(chat._id.toString()) || [];

      // Участники, которых больше нет (не считая текущего пользователя)
      const missing = participantIds.filter((id) => id && id !== String(userId) && !existingSet.has(id));

      if (missing.length === 0) {
        cleanedChats.push(chat);
        continue;
      }

      if (chat.type === 'group') {
        // после populate участники уже «вычищены» от мёртвых ссылок,
        // достаточно проверить, что осталось минимум 2 живых участника
        chat.participants = (chat.participants || []).filter((participant) => {
          const id =
            participant instanceof mongoose.Types.ObjectId
              ? participant.toString()
              : participant?._id?.toString?.();
          return id && existingSet.has(id);
        });

        if (chat.participants.length < 2) {
          toDeleteIds.push(chat._id);
        } else {
          await chat.save();
          cleanedChats.push(chat);
        }
      } else {
        // Direct-чат без живого собеседника — удаляем
        toDeleteIds.push(chat._id);
      }
    }

    if (toDeleteIds.length) {
      await Message.deleteMany({ chat: { $in: toDeleteIds } });
      await Chat.deleteMany({ _id: { $in: toDeleteIds } });
    }

    return res.json({
      success: true,
      chats: cleanedChats.map((chat) => serializeChat(chat, userId)),
      removedChatIds: toDeleteIds.map((id) => id.toString())
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.searchUsersAndChats = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const currentUserId = req.user?.id;
    const normalized = normalizeChatQuery(q);

    const safeQuery = normalized.value.trim();
    const userFilter = safeQuery
      ? { $or: [
          { email: { $regex: escapeRegex(safeQuery), $options: 'i' } },
          { username: { $regex: escapeRegex(safeQuery), $options: 'i' } },
          { displayName: { $regex: escapeRegex(safeQuery), $options: 'i' } }
        ] }
      : {};

    const users = await User.find({ _id: { $ne: currentUserId }, ...userFilter })
      .limit(10)
      .select('_id email username displayName showUsername color');

    const existingChats = await Chat.find({ participants: currentUserId })
      .populate('participants', '_id email username displayName showUsername color');

    const matchedChats = safeQuery ? matchChatSearch(q, existingChats, currentUserId).matches : [];

    const directMatches = users.map((user) => ({
      type: 'user',
      id: user._id.toString(),
      name: getUserName(user),
      username: user.username || user.email?.split('@')[0],
      email: user.email,
      isCurrentUser: false,
      searchKey: `@${(user.username || user.email?.split('@')[0] || user._id.toString()).toLowerCase()}`,
      searchId: `#${user._id.toString()}`
    }));

    const chatMatches = matchedChats.map((chat) => serializeChat(chat, currentUserId));

    return res.json({
      success: true,
      query: q,
      normalized,
      users: directMatches,
      chats: chatMatches,
      combined: [
        ...directMatches,
        ...chatMatches.map((chat) => ({
          type: 'chat',
          ...chat,
          name: chat.title || 'Чат',
          searchKey: `@${chat.title || ''}`.toLowerCase()
        }))
      ]
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDirectChat = async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user?.id;

    if (!userId || !currentUserId) {
      return res.status(400).json({ success: false, message: 'Не указан пользователь' });
    }

    if (userId === currentUserId) {
      return res.status(400).json({ success: false, message: 'Нельзя создать чат с самим собой' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const existing = await Chat.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, userId], $size: 2 }
    }).populate('participants', '_id email username displayName showUsername color');

    if (existing) {
      return res.status(200).json({ success: true, chat: serializeChat(existing, currentUserId), created: false });
    }

    const chat = await Chat.create({
      type: 'direct',
      title: getUserName(targetUser),
      participants: [currentUserId, userId],
      createdBy: currentUserId
    });

    const populated = await Chat.findById(chat._id).populate('participants', '_id email username displayName showUsername color');
    return res.status(201).json({ success: true, chat: serializeChat(populated, currentUserId), created: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createGroupChat = async (req, res) => {
  try {
    const { title, participantIds = [] } = req.body;
    const currentUserId = req.user?.id;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Укажите название группы' });
    }

    const uniqueIds = Array.from(new Set([currentUserId, ...participantIds.filter(Boolean)]));

    const chat = await Chat.create({
      type: 'group',
      title: title.trim(),
      participants: uniqueIds,
      createdBy: currentUserId
    });

    const populated = await Chat.findById(chat._id).populate('participants', '_id email username displayName showUsername color');
    return res.status(201).json({ success: true, chat: serializeChat(populated, currentUserId), created: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    const messages = await Message.find({ chat: chatId })
      .populate('sender', '_id email username displayName showUsername color')
      .sort({ createdAt: 1 });

    return res.json({
      success: true,
      chat: serializeChat(chat, userId),
      messages: messages.map((message) => ({
        id: message._id.toString(),
        text: message.text,
        sender: serializeUser(message.sender),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    const message = await Message.findOne({ _id: messageId, chat: chatId });
    if (!message) {
      return res.status(404).json({ success: false, message: 'Сообщение не найдено' });
    }

    const isSender = String(message.sender) === String(userId);
    const isChatCreator = chat.createdBy && String(chat.createdBy) === String(userId);
    if (!isSender && !isChatCreator) {
      return res.status(403).json({ success: false, message: 'Нельзя удалить чужое сообщение' });
    }

    await Message.deleteOne({ _id: messageId });

    const last = await Message.find({ chat: chatId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .lean();
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: last.length ? last[0]._id : null,
      updatedAt: new Date()
    });

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat:message-deleted', { chatId, messageId: String(messageId) });
    }

    return res.json({ success: true, messageId: String(messageId) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.clearChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    await Message.deleteMany({ chat: chatId });
    await Chat.findByIdAndUpdate(chatId, { lastMessage: null, updatedAt: new Date() });

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat:messages-cleared', { chatId });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    await Message.deleteMany({ chat: chatId });
    await Chat.deleteOne({ _id: chatId });

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat:deleted', { chatId });
    }

    return res.json({ success: true, chatId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { text } = req.body;
    const userId = req.user?.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Введите текст сообщения' });
    }

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    const message = await Message.create({
      chat: chatId,
      sender: userId,
      text: text.trim()
    });

    chat.lastMessage = message._id;

    if (!chat.title) {
      if (chat.type === 'direct') {
        const otherParticipantId = (chat.participants || [])
          .map((participant) => String(participant))
          .find((id) => id !== String(userId));
        const otherUser = otherParticipantId
          ? await User.findById(otherParticipantId).select('_id email username displayName showUsername color')
          : null;
        chat.title = getUserName(otherUser) || 'Новый чат';
      } else {
        chat.title = 'Новый чат';
      }
    }

    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Message.findById(message._id).populate('sender', '_id email username displayName showUsername color');
    const payload = {
      id: populated._id.toString(),
      text: populated.text,
      sender: serializeUser(populated.sender),
      chatId: chatId,
      createdAt: populated.createdAt
    };

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat:message', payload);
    }

    return res.status(201).json({
      success: true,
      message: payload
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
