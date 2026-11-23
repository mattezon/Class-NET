const Chat = require('../models/Chat.cjs');
const Message = require('../models/Message.cjs');
const User = require('../models/User.cjs');
const mongoose = require('mongoose');
const { normalizeChatQuery, matchChatSearch } = require('../utils/chatSearch.cjs');
const { matchMentions } = require('../utils/chatMentions.cjs');
const {
  getAdminIds,
  isGroupAdmin,
  canDeleteMessage,
  canClearChat,
  canDeleteChat,
  canLeaveGroup
} = require('../utils/chatPermissions.cjs');

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
    kind: lastMessage.kind || 'text',
    createdAt: lastMessage.createdAt || null
  };
};

const serializeChat = (chat, currentUserId) => {
  const participants = Array.isArray(chat?.participants) ? chat.participants : [];

  return {
    id: chat?._id?.toString?.() || chat?.id || null,
    type: chat?.type || 'direct',
    title: chat?.title || '',
    color: chat?.color || '',
    createdBy: chat?.createdBy ? chat.createdBy.toString() : null,
    admins: getAdminIds(chat),
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

const serializeMessage = (message, chatId) => {
  const reply = message?.replyTo;
  const replyPayload = reply && (reply.text || reply._id || reply.id)
    ? {
        id: reply._id?.toString?.() || reply.id || null,
        text: reply.text || '',
        sender: serializeUser(reply.sender),
        createdAt: reply.createdAt || null
      }
    : null;

  return {
    id: message?._id?.toString?.() || message?.id || null,
    text: message?.text || '',
    sender: serializeUser(message?.sender),
    chatId: chatId || message?.chat?.toString?.() || null,
    kind: message?.kind || 'text',
    replyTo: replyPayload,
    mentions: (message?.mentions || []).map((id) => id?.toString?.() || String(id)),
    readBy: (message?.readBy || []).map((id) => id?.toString?.() || String(id)),
    createdAt: message?.createdAt || null,
    updatedAt: message?.updatedAt || null
  };
};

const emitToUser = (io, userId, event, payload) => {
  if (io && userId) io.in(`user:${userId}`).emit(event, payload);
};

const createSystemMessage = async ({ chat, actorId, text, io }) => {
  try {
    const message = await Message.create({
      chat: chat._id,
      sender: actorId,
      text,
      kind: 'system'
    });

    chat.lastMessage = message._id;
    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Message.findById(message._id)
      .populate('sender', '_id email username displayName showUsername color');
    const payload = serializeMessage(populated, chat._id.toString());
    io?.to(chat._id.toString()).emit('chat:message', payload);
    return payload;
  } catch (error) {
    console.warn('Не удалось создать системное сообщение:', error.message);
    return null;
  }
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

    const unreadMap = new Map();
    if (cleanedChats.length) {
      const unreadRows = await Message.aggregate([
        {
          $match: {
            chat: { $in: cleanedChats.map((chat) => chat._id) },
            kind: { $ne: 'system' },
            sender: { $ne: new mongoose.Types.ObjectId(userId) },
            readBy: { $ne: new mongoose.Types.ObjectId(userId) }
          }
        },
        { $group: { _id: '$chat', count: { $sum: 1 } } }
      ]);
      unreadRows.forEach((row) => unreadMap.set(row._id.toString(), row.count));
    }

    return res.json({
      success: true,
      chats: cleanedChats.map((chat) => ({
        ...serializeChat(chat, userId),
        unreadCount: unreadMap.get(chat._id.toString()) || 0
      })),
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
      displayName: user.displayName || user.email?.split('@')[0] || '',
      email: user.email,
      showUsername: user.showUsername ?? true,
      color: user.color || null,
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
    const { title, participantIds } = req.body;
    const requestedParticipantIds = Array.isArray(participantIds) ? participantIds : [];
    const currentUserId = req.user?.id;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Укажите название группы' });
    }

    const requestedIds = Array.from(
      new Set(
        requestedParticipantIds
          .filter(Boolean)
          .map((id) => String(id))
          .filter((id) => id !== String(currentUserId) && mongoose.Types.ObjectId.isValid(id))
      )
    );

    if (requestedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Выберите хотя бы одного участника' });
    }

    const existingUsers = await User.find({ _id: { $in: requestedIds } }).select('_id');
    const existingIds = new Set(existingUsers.map((user) => user._id.toString()));
    const validIds = requestedIds.filter((id) => existingIds.has(id));

    if (validIds.length === 0) {
      return res.status(404).json({ success: false, message: 'Выбранные пользователи не найдены' });
    }

    const uniqueIds = Array.from(new Set([currentUserId, ...validIds]));

    const chat = await Chat.create({
      type: 'group',
      title: title.trim(),
      participants: uniqueIds,
      createdBy: currentUserId,
      admins: [currentUserId]
    });

    const populated = await Chat.findById(chat._id).populate('participants', '_id email username displayName showUsername color');
    await createSystemMessage({
      chat,
      actorId: currentUserId,
      text: `Группа «${title.trim()}» создана`,
      io: req.app.get('io')
    });
    return res.status(201).json({ success: true, chat: serializeChat(populated, currentUserId), created: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const emitParticipantsUpdated = (req, chatId, chat) => {
  const io = req.app.get('io');
  if (!io) return;

  const payload = {
    chatId,
    chat: serializeChat(chat, req.user?.id)
  };
  io.to(chatId).emit('chat:participants-updated', payload);
  (chat.participants || []).forEach((participant) => {
    const id = participant?._id?.toString?.() || participant?.id || participant?.toString?.();
    emitToUser(io, id, 'chat:participants-updated', payload);
  });
};

exports.addGroupParticipant = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;
    const currentUserId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }
    if (!isGroupAdmin(chat, currentUserId)) {
      return res.status(403).json({ success: false, message: 'Только администратор группы может добавлять участников' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Некорректный пользователь' });
    }

    const targetId = String(userId);
    if (chat.participants.some((id) => String(id) === targetId)) {
      return res.status(400).json({ success: false, message: 'Пользователь уже состоит в группе' });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    chat.participants.push(targetUser._id);
    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Chat.findById(chat._id)
      .populate('participants', '_id email username displayName showUsername color')
      .populate('admins', '_id email username displayName showUsername color');
    emitParticipantsUpdated(req, chatId, populated);
    emitToUser(req.app.get('io'), targetId, 'chat:added', {
      chatId: chat._id.toString(),
      chat: serializeChat(populated, targetId)
    });
    await createSystemMessage({
      chat,
      actorId: currentUserId,
      text: `${getUserName(req.user) || 'Администратор'} добавил ${getUserName(targetUser) || targetId} в группу`,
      io: req.app.get('io')
    });

    return res.json({ success: true, chat: serializeChat(populated, currentUserId) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.removeGroupParticipant = async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const currentUserId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }
    if (!isGroupAdmin(chat, currentUserId)) {
      return res.status(403).json({ success: false, message: 'Только администратор группы может исключать участников' });
    }

    const targetId = String(userId);
    if (!chat.participants.some((id) => String(id) === targetId)) {
      return res.status(404).json({ success: false, message: 'Участник не найден' });
    }
    const targetUser = await User.findById(targetId).select('_id email username displayName showUsername color');

    const adminIds = getAdminIds(chat);
    if (adminIds.includes(targetId) && adminIds.length === 1) {
      return res.status(400).json({ success: false, message: 'Нельзя исключить последнего администратора' });
    }

    chat.participants = chat.participants.filter((id) => String(id) !== targetId);
    chat.admins = adminIds.filter((id) => id !== targetId).map((id) => new mongoose.Types.ObjectId(id));
    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Chat.findById(chat._id)
      .populate('participants', '_id email username displayName showUsername color')
      .populate('admins', '_id email username displayName showUsername color');
    emitParticipantsUpdated(req, chatId, populated);
    emitToUser(req.app.get('io'), targetId, 'chat:removed', { chatId: chat._id.toString() });
    req.app.get('io')?.in(`user:${targetId}`).socketsLeave(chat._id.toString());
    await createSystemMessage({
      chat,
      actorId: currentUserId,
      text: `${getUserName(req.user) || 'Администратор'} исключил ${getUserName(targetUser) || targetId} из группы`,
      io: req.app.get('io')
    });

    return res.json({ success: true, chat: serializeChat(populated, currentUserId) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleGroupAdmin = async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const currentUserId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }
    if (!isGroupAdmin(chat, currentUserId)) {
      return res.status(403).json({ success: false, message: 'Только администратор группы может назначать администраторов' });
    }

    const targetId = String(userId);
    if (!chat.participants.some((id) => String(id) === targetId)) {
      return res.status(404).json({ success: false, message: 'Участник не найден' });
    }
    const targetUser = await User.findById(targetId).select('_id email username displayName showUsername color');

    const adminIds = getAdminIds(chat);
    const alreadyAdmin = adminIds.includes(targetId);
    if (alreadyAdmin && adminIds.length === 1) {
      return res.status(400).json({ success: false, message: 'В группе должен остаться хотя бы один администратор' });
    }

    chat.admins = (alreadyAdmin
      ? adminIds.filter((id) => id !== targetId)
      : [...adminIds, targetId]
    ).map((id) => new mongoose.Types.ObjectId(id));
    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Chat.findById(chat._id)
      .populate('participants', '_id email username displayName showUsername color')
      .populate('admins', '_id email username displayName showUsername color');
    emitParticipantsUpdated(req, chatId, populated);
    await createSystemMessage({
      chat,
      actorId: currentUserId,
      text: `${getUserName(req.user) || 'Администратор'} ${alreadyAdmin ? 'снял права администратора с' : 'назначил администратором'} ${getUserName(targetUser) || targetId}`,
      io: req.app.get('io')
    });

    return res.json({ success: true, chat: serializeChat(populated, currentUserId) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateGroupChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { title, color } = req.body;
    const currentUserId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }
    if (!isGroupAdmin(chat, currentUserId)) {
      return res.status(403).json({ success: false, message: 'Только администратор группы может изменить настройки' });
    }

    const nextTitle = title === undefined ? chat.title : String(title).trim();
    if (!nextTitle || nextTitle.length > 80) {
      return res.status(400).json({ success: false, message: 'Название группы должно быть от 1 до 80 символов' });
    }

    const nextColor = color === undefined ? chat.color || '' : String(color).trim();
    if (nextColor && !/^#[0-9a-fA-F]{6}$/.test(nextColor)) {
      return res.status(400).json({ success: false, message: 'Некорректный цвет группы' });
    }

    const previousTitle = chat.title;
    chat.title = nextTitle;
    chat.color = nextColor;
    chat.updatedAt = new Date();
    await chat.save();

    const populated = await Chat.findById(chat._id)
      .populate('participants', '_id email username displayName showUsername color')
      .populate('admins', '_id email username displayName showUsername color');
    const payload = { chatId, chat: serializeChat(populated, currentUserId) };
    const io = req.app.get('io');
    io?.to(chatId).emit('chat:updated', payload);
    (populated.participants || []).forEach((participant) => {
      emitToUser(io, participant?._id?.toString?.(), 'chat:updated', payload);
    });

    if (previousTitle !== nextTitle) {
      await createSystemMessage({
        chat,
        actorId: currentUserId,
        text: `${getUserName(req.user) || 'Администратор'} переименовал группу в «${nextTitle}»`,
        io
      });
    }

    return res.json({ success: true, chat: serializeChat(populated, currentUserId) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.leaveGroupChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const currentUserId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
    if (!chat || chat.type !== 'group') {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }
    if (!canLeaveGroup(chat, currentUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Последний администратор не может покинуть группу — назначьте другого администратора'
      });
    }

    chat.participants = chat.participants.filter((id) => String(id) !== String(currentUserId));
    chat.admins = getAdminIds(chat)
      .filter((id) => id !== String(currentUserId))
      .map((id) => new mongoose.Types.ObjectId(id));
    chat.updatedAt = new Date();
    await chat.save();

    const io = req.app.get('io');
    io?.in(`user:${currentUserId}`).socketsLeave(chat._id.toString());
    emitToUser(io, currentUserId, 'chat:removed', { chatId: chat._id.toString() });
    await createSystemMessage({
      chat,
      actorId: currentUserId,
      text: `${getUserName(req.user) || 'Участник'} покинул группу`,
      io
    });

    return res.json({ success: true, chatId: chat._id.toString() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.markChatRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId }).select('_id');
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    const result = await Message.updateMany(
      { chat: chatId, readBy: { $ne: new mongoose.Types.ObjectId(userId) } },
      { $addToSet: { readBy: new mongoose.Types.ObjectId(userId) } }
    );
    const io = req.app.get('io');
    io?.to(chatId).emit('chat:read', {
      chatId,
      userId,
      readAt: new Date().toISOString(),
      count: result.modifiedCount
    });

    return res.json({ success: true, updated: result.modifiedCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.searchChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { q = '' } = req.query;
    const userId = req.user?.id;
    const query = String(q).trim();

    const chat = await Chat.findOne({ _id: chatId, participants: userId }).select('_id');
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }
    if (!query) {
      return res.json({ success: true, messages: [] });
    }

    const messages = await Message.find({
      chat: chatId,
      kind: { $ne: 'system' },
      text: { $regex: escapeRegex(query), $options: 'i' }
    })
      .populate('sender', '_id email username displayName showUsername color')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: '_id email username displayName showUsername color' } })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({ success: true, messages: messages.map((message) => serializeMessage(message, chatId)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { before, around, limit } = req.query;
    const userId = req.user?.id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const withPopulate = (query) => query
      .populate('sender', '_id email username displayName showUsername color')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: '_id email username displayName showUsername color' } });

    let messages = [];
    let hasMore = false;
    let hasMoreAfter = false;
    let nextCursor = null;

    if (around && mongoose.Types.ObjectId.isValid(around)) {
      const target = await Message.findOne({ _id: around, chat: chatId });
      if (target) {
        const beforeCount = Math.floor(pageSize / 2);
        const afterCount = pageSize - beforeCount;
        const older = await withPopulate(Message.find({ chat: chatId, _id: { $lt: target._id } })
          .sort({ _id: -1 }).limit(beforeCount));
        const newer = await withPopulate(Message.find({ chat: chatId, _id: { $gte: target._id } })
          .sort({ _id: 1 }).limit(afterCount));
        messages = [...older.reverse(), ...newer];
        hasMore = older.length === beforeCount;
        hasMoreAfter = newer.length === afterCount;
        nextCursor = messages[0]?._id?.toString?.() || null;
      }
    }

    if (!messages.length) {
      const filters = { chat: chatId };
      if (before && mongoose.Types.ObjectId.isValid(before)) {
        filters._id = { $lt: new mongoose.Types.ObjectId(before) };
      }
      const page = await withPopulate(Message.find(filters).sort({ _id: -1 }).limit(pageSize + 1));
      hasMore = page.length > pageSize;
      messages = page.slice(0, pageSize).reverse();
      nextCursor = messages[0]?._id?.toString?.() || null;
    }

    return res.json({
      success: true,
      chat: serializeChat(chat, userId),
      messages: messages.map((message) => serializeMessage(message, chatId)),
      hasMore,
      hasMoreAfter,
      nextCursor
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

    if (!canDeleteMessage(chat, userId, message)) {
      return res.status(403).json({ success: false, message: 'Нельзя удалить это сообщение' });
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
    if (!canClearChat(chat, userId)) {
      return res.status(403).json({ success: false, message: 'Только администратор группы может очистить историю' });
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
    if (!canDeleteChat(chat, userId)) {
      return res.status(403).json({ success: false, message: 'Удалить группу может только администратор' });
    }

    await Message.deleteMany({ chat: chatId });
    await Chat.deleteOne({ _id: chatId });

    const io = req.app.get('io');
    if (io) {
      const payload = { chatId };
      io.to(chatId).emit('chat:deleted', payload);
      (chat.participants || []).forEach((participant) => {
        emitToUser(io, participant?.toString?.(), 'chat:deleted', payload);
      });
    }

    return res.json({ success: true, chatId });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { text, replyToId, clientId } = req.body;
    const userId = req.user?.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Введите текст сообщения' });
    }

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Чат не найден' });
    }

    let replyTo = null;
    if (replyToId) {
      if (!mongoose.Types.ObjectId.isValid(replyToId)) {
        return res.status(400).json({ success: false, message: 'Некорректное сообщение для ответа' });
      }
      replyTo = await Message.findOne({ _id: replyToId, chat: chatId });
      if (!replyTo) {
        return res.status(404).json({ success: false, message: 'Сообщение для ответа не найдено' });
      }
    }

    const cleanText = text.trim();
    const participantUsers = await User.find({ _id: { $in: chat.participants } })
      .select('_id email username displayName showUsername color');
    const mentionedUsers = matchMentions(cleanText, participantUsers)
      .filter((participant) => String(participant._id) !== String(userId));

    const message = await Message.create({
      chat: chatId,
      sender: userId,
      text: cleanText,
      replyTo: replyTo?._id || null,
      mentions: mentionedUsers.map((participant) => participant._id)
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

    const populated = await Message.findById(message._id)
      .populate('sender', '_id email username displayName showUsername color')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: '_id email username displayName showUsername color' } });
    const payload = {
      ...serializeMessage(populated, chatId),
      clientId: clientId || null
    };

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat:message', payload);
      mentionedUsers.forEach((participant) => {
        emitToUser(io, participant._id.toString(), 'chat:mention', {
          chatId,
          messageId: payload.id,
          sender: payload.sender,
          text: payload.text
        });
      });
    }

    return res.status(201).json({
      success: true,
      message: payload
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
