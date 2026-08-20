const Post = require('../models/Post.cjs');
const User = require('../models/User.cjs');
const Comment = require('../models/Comment.cjs');

const allowedReactionTypes = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

const enrichPost = (post, currentUserId = null) => {
  const postObj = post.toObject({ getters: true });
  const userReaction = currentUserId && postObj.userReactions
    ? postObj.userReactions[currentUserId] || null
    : null;

  return {
    ...postObj,
    userReaction,
    reactions: {
      like: postObj.reactions?.like || 0,
      love: postObj.reactions?.love || 0,
      haha: postObj.reactions?.haha || 0,
      wow: postObj.reactions?.wow || 0,
      sad: postObj.reactions?.sad || 0,
      angry: postObj.reactions?.angry || 0
    },
    likes: postObj.likes || 0
  };
};

// @desc    Создать новый пост
// @route   POST /api/posts
// @access  Private
exports.createPost = async (req, res) => {
  try {
    const { text, image } = req.body;
    const userId = req.user?.id;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите текст поста'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Не авторизован'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const post = await Post.create({
      author: user._id,
      text,
      image: image || null
    });

    await post.populate('author', '_id email username displayName showUsername color');

    console.log(`✅ Создан пост от ${user.email}: "${text.substring(0, 50)}..."`);

    return res.status(201).json({
      success: true,
      message: 'Пост успешно создан',
      post: enrichPost(post, userId)
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить все посты
// @route   GET /api/posts
// @access  Public
exports.getAllPosts = async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', '_id email username displayName showUsername color')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: posts.length,
      posts: posts.map(post => enrichPost(post, req.user?.id))
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить пост по ID
// @route   GET /api/posts/:id
// @access  Public
exports.getPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('author', '_id email username displayName showUsername color');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    return res.status(200).json({
      success: true,
      post: enrichPost(post, req.user?.id)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Обновить пост
// @route   PUT /api/posts/:id
// @access  Private
exports.updatePost = async (req, res) => {
  try {
    const { text, image } = req.body;

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const userId = req.user?.id;
    const isModerator = req.user?.moderator;
    const userRole = req.user?.role;

    // Модератор или учитель могут редактировать любой пост
    // Автор может редактировать свой пост
    if (!userId || (post.author.toString() !== String(userId) && !isModerator && userRole !== 'teacher')) {
      return res.status(403).json({
        success: false,
        message: 'Нет доступа к изменению этого поста'
      });
    }

    post.text = text ?? post.text;
    post.image = image !== undefined ? image : post.image;

    await post.save();

    await post.populate('author', '_id email username displayName showUsername color');

    console.log(`✅ Обновлен пост ${req.params.id}`);

    return res.status(200).json({
      success: true,
      message: 'Пост успешно обновлен',
      post: enrichPost(post, userId)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Удалить пост
// @route   DELETE /api/posts/:id
// @access  Private
exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const userId = req.user?.id;

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const isModerator = req.user?.moderator;
    const userRole = req.user?.role;
    
    // Модератор или учитель могут удалить любой пост
    // Автор может удалить свой пост
    if (!userId || (post.author.toString() !== String(userId) && !isModerator && userRole !== 'teacher')) {
      return res.status(403).json({
        success: false,
        message: 'Нет доступа к удалению этого поста'
      });
    }

    await Comment.deleteMany({ post: post._id });

    await post.deleteOne();

    console.log(`✅ Удален пост ${req.params.id}`);

    return res.status(200).json({
      success: true,
      message: 'Пост успешно удален'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить реакцию пользователя на пост
// @route   GET /api/posts/:id/user-reaction
// @access  Private
exports.getUserReaction = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const userId = req.user?.id;

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const userReaction = post.userReactions.get(userId.toString()) || null;

    return res.status(200).json({
      success: true,
      userReaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Получить комментарии к посту
// @route   GET /api/posts/:id/comments
// @access  Public
exports.getComments = async (req, res) => {
  try {
    const comments = await Comment.find({ post: req.params.id })
      .populate('author', '_id email username displayName showUsername color')
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: comments.length,
      comments
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Добавить комментарий к посту
// @route   POST /api/posts/:id/comments
// @access  Private
exports.createComment = async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.user?.id;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите текст комментария'
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const comment = await Comment.create({
      post: post._id,
      author: userId,
      text: text.trim()
    });

    post.comments += 1;
    await post.save();

    await comment.populate('author', '_id email username displayName showUsername color');

    console.log(`💬 Комментарий на пост ${req.params.id}`);

    return res.status(201).json({
      success: true,
      message: 'Комментарий добавлен',
      comment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Удалить комментарий
// @route   DELETE /api/posts/:postId/comments/:commentId
// @access  Private
exports.deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user?.id;

    const comment = await Comment.findById(commentId);
    if (!comment || comment.post.toString() !== postId) {
      return res.status(404).json({
        success: false,
        message: 'Комментарий не найден'
      });
    }

    const post = await Post.findById(postId);
    const isCommentAuthor = comment.author.toString() === userId;
    const isPostAuthor = post && post.author.toString() === userId;

    if (!userId || (!isCommentAuthor && !isPostAuthor)) {
      return res.status(403).json({
        success: false,
        message: 'Нет доступа к удалению этого комментария'
      });
    }
    if (post) {
      post.comments = Math.max(0, post.comments - 1);
      await post.save();
    }

    await comment.deleteOne();

    console.log(`🗑️ Комментарий ${commentId} удалён пользователем ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Комментарий удалён',
      commentId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Добавить реакцию к посту
// @route   POST /api/posts/:id/react
// @access  Private
exports.reactPost = async (req, res) => {
  try {
    const { type } = req.body;
    const userId = req.user?.id;

    if (!allowedReactionTypes.includes(type) && type !== 'none') {
      return res.status(400).json({
        success: false,
        message: 'Неверный тип реакции'
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const userIdStr = userId.toString();
    const previousReaction = post.userReactions.get(userIdStr);

    // Если пользователь хочет снять реакцию
    if (type === 'none') {
      if (previousReaction) {
        // Уменьшаем счетчик предыдущей реакции
        if (post.reactions[previousReaction]) {
          post.reactions[previousReaction] = Math.max(0, post.reactions[previousReaction] - 1);
        }
        // Если предыдущая реакция была like, уменьшаем общий счетчик likes
        if (previousReaction === 'like') {
          post.likes = Math.max(0, post.likes - 1);
        }
        // Удаляем реакцию пользователя
        post.userReactions.delete(userIdStr);
      }

      await post.save();
      await post.populate('author', '_id email username displayName showUsername color');

      console.log(`🚫 Снята реакция с поста ${req.params.id} пользователем ${userId}`);

      return res.status(200).json({
        success: true,
        message: 'Реакция снята',
        post,
        userReaction: null
      });
    }

    // Если пользователь уже ставил реакцию
    if (previousReaction && previousReaction !== type) {
      // Уменьшаем счетчик предыдущей реакции
      if (post.reactions[previousReaction]) {
        post.reactions[previousReaction] = Math.max(0, post.reactions[previousReaction] - 1);
      }
      // Если предыдущая реакция была like, уменьшаем общий счетчик likes
      if (previousReaction === 'like') {
        post.likes = Math.max(0, post.likes - 1);
      }
    }

    // Если новая реакция — это та же самая реакция, то просто оставляем
    if (previousReaction === type) {
      await post.save();
      await post.populate('author', '_id email username displayName showUsername color');

      return res.status(200).json({
        success: true,
        message: 'Реакция уже установлена',
        post: enrichPost(post, userId),
        userReaction: type
      });
    }

    // Устанавливаем новую реакцию
    post.userReactions.set(userIdStr, type);
    post.reactions[type] = (post.reactions[type] || 0) + 1;

    // Если новая реакция - like, увеличиваем общий счетчик likes
    if (type === 'like') {
      post.likes += 1;
    }

    await post.save();
    await post.populate('author', '_id email username displayName showUsername color');

    console.log(`🎯 Реакция ${type} на пост ${req.params.id} от пользователя ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Реакция добавлена',
      post: enrichPost(post, userId),
      userReaction: type
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Лайкнуть пост
// @route   POST /api/posts/:id/like
// @access  Private
exports.likePost = async (req, res) => {
  try {
    const userId = req.user?.id;
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Пост не найден'
      });
    }

    const userIdStr = userId.toString();
    const previousReaction = post.userReactions.get(userIdStr);

    if (previousReaction === 'like') {
      post.userReactions.delete(userIdStr);
      post.reactions.like = Math.max(0, (post.reactions.like || 0) - 1);
      post.likes = Math.max(0, post.likes - 1);
    } else {
      if (previousReaction) {
        if (post.reactions[previousReaction]) {
          post.reactions[previousReaction] = Math.max(0, post.reactions[previousReaction] - 1);
        }
        if (previousReaction === 'like') {
          post.likes = Math.max(0, post.likes - 1);
        }
      }
      post.userReactions.set(userIdStr, 'like');
      post.reactions.like = (post.reactions.like || 0) + 1;
      post.likes += 1;
    }

    await post.save();
    await post.populate('author', '_id email username displayName showUsername color');

    console.log(`👍 Лайк на пост ${req.params.id} от пользователя ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Пост понравился',
      post: enrichPost(post, userId)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
