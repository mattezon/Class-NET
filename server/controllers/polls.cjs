const Poll = require('../models/Poll.cjs');
const User = require('../models/User.cjs');

const getUserName = (user) => {
  if (!user) return '';
  return user.username || user.displayName || (user.email ? user.email.split('@')[0] : '') || '';
};

// Привести опрос к виду для клиента
const serializePoll = (poll, currentUserId = null) => {
  const total = (poll.options || []).reduce((sum, o) => sum + (o.votes || 0), 0);

  const now = new Date();
  const endsAt = poll.endsAt ? new Date(poll.endsAt) : null;
  const hasEnded = !!endsAt && endsAt <= now;

  let userVote = null;
  let voted = false;
  
  if (currentUserId) {
    const userIdStr = String(currentUserId);
    
    // userChoices — всегда объект { userId: index или [indices] }
    // Исключаем внутренние поля Mongoose ($...)
    const choicesObj = {};
    if (poll.userChoices) {
      const raw = typeof poll.userChoices === 'object' ? poll.userChoices : {};
      for (const k of Object.keys(raw)) {
        if (!k.startsWith('$')) {
          choicesObj[k] = raw[k];
        }
      }
    }
    
    const v = choicesObj[userIdStr];
    
    if (poll.allowsMultiple) {
      userVote = v ? (Array.isArray(v) ? v : [v]) : null;
    } else {
      userVote = v !== undefined && v !== null ? Number(v) : null;
    }
    
    if (userVote !== null && userVote !== undefined) {
      voted = true;
    }
    
    // Также проверяем voters (массив ObjectId)
    if (!voted && poll.voters && poll.voters.length > 0) {
      voted = poll.voters.some(v => String(v) === userIdStr);
    }
  }

  return {
    id: String(poll._id),
    question: poll.question,
    options: (poll.options || []).map((o, i) => ({
      index: i,
      text: o.text,
      votes: o.votes || 0,
      percent: total > 0 ? Math.round(((o.votes || 0) / total) * 100) : 0
    })),
    allowsMultiple: poll.allowsMultiple === true,
    endsAt: endsAt ? endsAt.toISOString() : null,
    hasEnded,
    votersCount: (poll.voters || []).length,
    total,
    voted,
    userVote,
    creator: poll.creator
      ? {
          id: poll.creator._id?.toString?.() || poll.creator.id,
          email: poll.creator.email || '',
          username: poll.creator.username || poll.creator.email?.split('@')[0] || '',
          displayName: poll.creator.displayName || poll.creator.username || '',
          showUsername: poll.creator.showUsername ?? true,
          color: poll.creator.color || null
        }
      : null,
        createdAt: poll.createdAt,
    updatedAt: poll.updatedAt
  };
};

// @desc    Создать опрос
// @route   POST /api/polls
// @access  Private
exports.createPoll = async (req, res) => {
  try {
    const { question, options, allowsMultiple, endsAt } = req.body;
    const userId = req.user?.id;

    if (!question || !String(question).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите вопрос опроса'
      });
    }

    if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Опрос должен содержать от 2 до 10 вариантов'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const normalizedOptions = options
      .map((o) => ({ text: String(o).trim() || 'Опция', votes: 0 }))
      .slice(0, 10);

    const data = {
      question: String(question).trim(),
      options: normalizedOptions,
      creator: user._id,
      userChoices: {}
    };

    if (allowsMultiple) data.allowsMultiple = true;
    if (endsAt) {
      const ends = new Date(endsAt);
      if (!isNaN(ends)) data.endsAt = ends;
    }

    const poll = await Poll.create(data);
    await poll.populate('creator', '_id email username displayName showUsername color');

    console.log(`📊 Создан опрос «${poll.question}» от ${user.email}`);

    return res.status(201).json({
      success: true,
      message: 'Опрос создан',
      poll: serializePoll(poll, userId)
    });
  } catch (error) {
    console.error('Create poll error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Список всех опросов
// @route   GET /api/polls
// @access  Public
exports.getPolls = async (req, res) => {
  try {
    const polls = await Poll.find()
      .populate('creator', '_id email username displayName showUsername color')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: polls.length,
      polls: polls.map((p) => serializePoll(p, req.user?.id))
    });
  } catch (error) {
    console.error('Get polls error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить опрос по ID
// @route   GET /api/polls/:id
// @access  Public
exports.getPoll = async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).populate(
      'creator',
      '_id email username displayName showUsername color'
    );

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Опрос не найден'
      });
    }

    return res.status(200).json({
      success: true,
      poll: serializePoll(poll, req.user?.id)
    });
  } catch (error) {
    console.error('Get poll error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Удалить опрос
// @route   DELETE /api/polls/:id
// @access  Private
exports.deletePoll = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const poll = await Poll.findById(id);
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Опрос не найден'
      });
    }

    // Удалять может создатель, модератор или учитель
    const isModerator = req.user?.moderator === true;
    const isTeacher = req.user?.role === 'teacher';
    if (String(poll.creator) !== String(userId) && !isModerator && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: 'Только создатель может удалить опрос'
      });
    }

    await Poll.findByIdAndDelete(id);
    console.log(`🗑️ Удалён опрос «${poll.question}» пользователем ${req.user.email}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('polls:deleted', { pollId: id });
    }

    return res.status(200).json({
      success: true,
      message: 'Опрос удалён'
    });
  } catch (error) {
    console.error('Delete poll error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Проголосовать / сменить голос / снять голос
// @route   POST /api/polls/:id/vote
// @access  Private
exports.votePoll = async (req, res) => {
  try {
    const { id } = req.params;
    const { option } = req.body;
    const userId = req.user?.id;

    const poll = await Poll.findById(id);
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Опрос не найден'
      });
    }

    const opt = Number(option);
    if (Number.isNaN(opt) || opt < 0 || opt >= poll.options.length) {
      return res.status(400).json({
        success: false,
        message: 'Недопустимый вариант ответа'
      });
    }

    // Голосование завершено
    if (poll.endsAt && new Date(poll.endsAt) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Голосование завершено'
      });
    }

    const key = userId.toString();
    // userChoices — всегда объект { userId: index или [indices] }
    // Исключаем внутренние поля Mongoose ($...)
    const choicesObj = {};
    if (poll.userChoices) {
      const raw = typeof poll.userChoices === 'object' ? poll.userChoices : {};
      for (const k of Object.keys(raw)) {
        if (!k.startsWith('$')) {
          choicesObj[k] = raw[k];
        }
      }
    }
    
    const prev = choicesObj[key];
    const hasVoted = poll.voters.some(v => String(v) === key);

    if (poll.allowsMultiple) {
      // Множественный выбор: массив индексов выбранных вариантов
      let choices = choicesObj[key];
      if (!choices) choices = [];
      else if (!Array.isArray(choices)) choices = [choices];

      const idx = choices.indexOf(opt);
      if (idx !== -1) {
        // Убираем выбор этого варианта
        choices.splice(idx, 1);
        poll.options[opt].votes = Math.max(0, poll.options[opt].votes - 1);
      } else {
        // Добавляем выбор этого варианта
        choices.push(opt);
        poll.options[opt].votes += 1;
      }

      if (choices.length === 0) {
        delete choicesObj[key];
      } else {
        choicesObj[key] = choices;
      }
    } else {
      // Одиночный выбор
      if (prev === opt) {
        // Снимаем голос
        poll.options[prev].votes = Math.max(0, poll.options[prev].votes - 1);
        delete choicesObj[key];
        if (hasVoted) {
          poll.voters = poll.voters.filter(v => String(v) !== key);
        }
      } else {
        // Меняем или ставим голос
        if (prev !== undefined && prev !== null) {
          poll.options[prev].votes = Math.max(0, poll.options[prev].votes - 1);
        }
        poll.options[opt].votes += 1;
        if (!hasVoted) {
          poll.voters.push(userId);
        }
        choicesObj[key] = opt;
      }
    }

    // Сохраняем как Map и обновляем поля
    const cleanChoices = {};
    for (const k of Object.keys(choicesObj)) {
      if (!k.startsWith('$')) {
        cleanChoices[k] = choicesObj[k];
      }
    }
    const userChoicesMap = new Map(Object.entries(cleanChoices));
    
    const updatedPoll = await Poll.findOneAndUpdate(
      { _id: id },
      {
        userChoices: userChoicesMap,
        options: poll.options,
        voters: poll.voters
      },
      { new: true, runValidators: true }
    ).populate('creator', '_id email username displayName showUsername color');

    const io = req.app.get('io');
    if (io) {
      io.emit('poll:update', serializePoll(updatedPoll, userId));
    }

    return res.status(200).json({
      success: true,
      message: 'Голос учтён',
      poll: serializePoll(updatedPoll, userId)
    });
  } catch (error) {
    console.error('Vote poll error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

