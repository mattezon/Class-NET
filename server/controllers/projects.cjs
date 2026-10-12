const Project = require('../models/Project.cjs');
const User = require('../models/User.cjs');
const Chat = require('../models/Chat.cjs');
const Message = require('../models/Message.cjs');

const getUserName = (user) => {
  if (!user) return '';
  return user.username || user.displayName || (user.email ? user.email.split('@')[0] : '') || '';
};

const serializeUser = (user) => {
  if (!user) return null;
  return {
    id: user._id?.toString?.() || user.id,
    email: user.email || '',
    username: user.username || user.email?.split('@')[0] || '',
    displayName: user.displayName || user.username || '',
    showUsername: user.showUsername ?? true,
    color: user.color || null
  };
};

// Привести проект к виду, удобному для клиента
const serializeProject = (project, currentUserId = null) => {
  return {
    id: project._id?.toString?.() || project.id,
    title: project.title,
    description: project.description || '',
    creator: serializeUser(project.creator),
    // Если участники populate'нуты (объекты) — отдаём данные для списка,
    // иначе (только id) — строки для быстрой проверки «я участвую»
    participants: (project.participants || []).map((p) =>
      p && typeof p === 'object' && p._id ? serializeUser(p) : (p?.toString ? p.toString() : p)
    ),
    completed: project.completed === true,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
};

// Отправить сообщение в личный чат «участник ↔ создатель»
// (находит существующий чат или создаёт новый)
const sendDirectToCreator = async (project, participantId, senderPayload, text) => {
  const creatorId = project.creator._id.toString();

  let chat = await Chat.findOne({
    type: 'direct',
    participants: { $all: [participantId, creatorId], $size: 2 }
  });

  if (!chat) {
    chat = await Chat.create({
      type: 'direct',
      title: getUserName(project.creator),
      participants: [participantId, creatorId],
      createdBy: participantId
    });
  }

  const message = await Message.create({
    chat: chat._id,
    sender: participantId,
    text
  });

  chat.lastMessage = message._id;
  chat.updatedAt = new Date();
  await chat.save();

  const io = globalThis.__io;
  if (io) {
    io.to(chat._id.toString()).emit('chat:message', {
      id: message._id.toString(),
      text: message.text,
      sender: senderPayload,
      chatId: chat._id.toString(),
      createdAt: message.createdAt
    });
  }

  return chat._id.toString();
};

// @desc    Создать новый проект
// @route   POST /api/projects
// @access  Private
exports.createProject = async (req, res) => {
  try {
    const { title, description } = req.body;
    const userId = req.user?.id;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите название проекта'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

        const project = await Project.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      creator: user._id
    });

    await project.populate('creator', '_id email username displayName showUsername color');

    console.log(`✅ Создан проект «${project.title}» от ${user.email}`);

    return res.status(201).json({
      success: true,
      message: 'Проект успешно создан',
      project: serializeProject(project, userId)
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить все проекты
// @route   GET /api/projects
// @access  Public
exports.getProjects = async (req, res) => {
  try {
    const projects = await Project.find()
      .populate('creator', '_id email username displayName showUsername color')
      .populate('participants', '_id email username displayName showUsername color')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: projects.length,
      projects: projects.map((p) => serializeProject(p, req.user?.id))
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Откликнуться на проект («Участвовать») — создаётся/находится
//          личный чат с создателем и от имени участника отправляется сообщение.
// @route   POST /api/projects/:id/participate
// @access  Private
exports.participateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;
    const { note } = req.body || {};

    const project = await Project.findById(id).populate(
      'creator',
      '_id email username displayName showUsername color'
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Проект не найден'
      });
    }

    const creatorId = project.creator._id.toString();

    if (creatorId === currentUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Вы — создатель проекта'
      });
    }

    if (project.completed) {
      return res.status(400).json({
        success: false,
        message: 'Проект завершён — участие закрыто'
      });
    }

    // Находим или создаём личный чат между участником и создателем
    let chat = await Chat.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, creatorId], $size: 2 }
    });

    if (!chat) {
      chat = await Chat.create({
        type: 'direct',
        title: getUserName(project.creator),
        participants: [currentUserId, creatorId],
        createdBy: currentUserId
      });
    }

    const noteTrimmed = note ? String(note).trim() : '';
    const baseText = `Хочу участвовать в проекте «${project.title}»`;
    const text = noteTrimmed ? `${baseText}\n${noteTrimmed}` : baseText;

    const message = await Message.create({
      chat: chat._id,
      sender: currentUserId,
      text
    });

    chat.lastMessage = message._id;
    chat.updatedAt = new Date();
    await chat.save();

    // Запоминаем участника проекта
    if (!project.participants.includes(currentUserId)) {
      project.participants.push(currentUserId);
      await project.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(chat._id.toString()).emit('chat:message', {
        id: message._id.toString(),
        text: message.text,
        sender: {
          id: currentUserId,
          email: req.user.email,
          username: req.user.username || req.user.email?.split('@')[0],
          displayName: req.user.username || req.user.email?.split('@')[0],
          showUsername: true,
          color: req.user.color || null
        },
        chatId: chat._id.toString(),
        createdAt: message.createdAt
      });
    }

    console.log(`✉️  Участие в «${project.title}»: ${req.user.email} → ${project.creator.email}`);

    return res.status(201).json({
      success: true,
      message: 'Ваше участие отправлено создателю проекта',
      chatId: chat._id.toString(),
      text
    });
  } catch (error) {
    console.error('Participate project error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Отменить участие в проекте (убрать себя из участников
//          и уведомить создателя в личном чате)
// @route   POST /api/projects/:id/leave
// @access  Private
exports.cancelParticipation = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;

    const project = await Project.findById(id).populate(
      'creator',
      '_id email username displayName showUsername color'
    );
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Проект не найден'
      });
    }

    const creatorId = project.creator._id.toString();

    if (creatorId === currentUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Вы — создатель проекта и не можете покинуть его'
      });
    }

    const wasParticipant = project.participants.some(
      (p) => p.toString() === currentUserId.toString()
    );

    if (!wasParticipant) {
      return res.status(400).json({
        success: false,
        message: 'Вы не участвуете в этом проекте'
      });
    }

    project.participants = project.participants.filter(
      (p) => p.toString() !== currentUserId.toString()
    );
    await project.save();

    // Находим или создаём личный чат между участником и создателем
    let chat = await Chat.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, creatorId], $size: 2 }
    });

    if (!chat) {
      chat = await Chat.create({
        type: 'direct',
        title: getUserName(project.creator),
        participants: [currentUserId, creatorId],
        createdBy: currentUserId
      });
    }

    // Отправляем создателю сообщение о выходе
    const text = `Я отменяю участие в проекте «${project.title}»`;

    const message = await Message.create({
      chat: chat._id,
      sender: currentUserId,
      text
    });

    chat.lastMessage = message._id;
    chat.updatedAt = new Date();
    await chat.save();

    const io = req.app.get('io');
    if (io) {
      io.to(chat._id.toString()).emit('chat:message', {
        id: message._id.toString(),
        text: message.text,
        sender: {
          id: currentUserId,
          email: req.user.email,
          username: req.user.username || req.user.email?.split('@')[0],
          displayName: req.user.username || req.user.email?.split('@')[0],
          showUsername: true,
          color: req.user.color || null
        },
        chatId: chat._id.toString(),
        createdAt: message.createdAt
      });
    }

    console.log(`👋 Участие отменено: ${req.user.email} → «${project.title}» (создатель уведомлён)`);

    return res.status(200).json({
      success: true,
      message: 'Вы больше не участвуете в проекте',
      chatId: chat._id.toString(),
      participants: project.participants.map((p) => p.toString())
    });
  } catch (error) {
    console.error('Cancel participation error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Исключить участника из проекта (только создатель)
// @route   DELETE /api/projects/:id/participants/:userId
// @access  Private (создатель проекта)
exports.removeParticipant = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const currentUserId = req.user?.id;

    const project = await Project.findById(id).populate(
      'creator',
      '_id email username displayName showUsername color'
    );
    if (!project) {
      return res.status(404).json({ success: false, message: 'Проект не найден' });
    }

    if (project.creator._id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ success: false, message: 'Только создатель проекта может исключать участников' });
    }

    const wasParticipant = project.participants.some((p) => p.toString() === userId);
    if (!wasParticipant) {
      return res.status(404).json({ success: false, message: 'Этот пользователь не участвует в проекте' });
    }

    project.participants = project.participants.filter((p) => p.toString() !== userId);
    await project.save();

    // Уведомляем исключённого (если чат существует)
    const chat = await Chat.findOne({ type: 'direct', participants: { $all: [userId, currentUserId], $size: 2 } });
    if (chat) {
      const message = await Message.create({
        chat: chat._id,
        sender: currentUserId,
        text: `Вы исключены из проекта «${project.title}»`
      });
      chat.lastMessage = message._id;
      chat.updatedAt = new Date();
      await chat.save();
      const io = globalThis.__io;
      if (io) {
        io.to(chat._id.toString()).emit('chat:message', {
          id: message._id.toString(),
          text: message.text,
          sender: {
            id: currentUserId,
            email: req.user.email,
            username: req.user.username || req.user.email?.split('@')[0],
            displayName: req.user.username || req.user.email?.split('@')[0],
            showUsername: true,
            color: req.user.color || null
          },
          chatId: chat._id.toString(),
          createdAt: message.createdAt
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Участник исключён',
      participants: project.participants.map((p) => p.toString())
    });
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Завершить проект (уведомить всех участников в личных чатах)
// @route   POST /api/projects/:id/complete
// @access  Private (создатель проекта)
exports.completeProject = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;

    const project = await Project.findById(id).populate(
      'creator',
      '_id email username displayName showUsername color'
    );
    if (!project) {
      return res.status(404).json({ success: false, message: 'Проект не найден' });
    }

    if (project.creator._id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ success: false, message: 'Только создатель проекта может завершить проект' });
    }

    if (project.completed) {
      return res.status(400).json({ success: false, message: 'Проект уже завершён' });
    }

    project.completed = true;
    await project.save();

    // Уведомляем всех участников в личных чатах
    const participants = project.participants.map((p) => p.toString());
    const notified = [];
    for (const pid of participants) {
      try {
        const chatId = await sendDirectToCreator(
          project,
          pid,
          {
            id: currentUserId,
            email: req.user.email,
            username: req.user.username || req.user.email?.split('@')[0],
            displayName: req.user.username || req.user.email?.split('@')[0],
            showUsername: true,
            color: req.user.color || null
          },
          `Проект «${project.title}» завершён. Спасибо за участие в проекте.`
        );
        notified.push(chatId);
      } catch (e) {
        console.error('Notify participant error:', e);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Проект завершён',
      project: serializeProject(project, currentUserId),
      notifiedChats: notified
    });
  } catch (error) {
    console.error('Complete project error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Удалить проект (безвозвратно)
// @route   DELETE /api/projects/:id
// @access  Private (создатель проекта)
exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Проект не найден' });
    }

    if (project.creator.toString() !== currentUserId.toString()) {
      return res.status(403).json({ success: false, message: 'Только создатель проекта может удалить проект' });
    }

    await Project.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Проект удалён'
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

