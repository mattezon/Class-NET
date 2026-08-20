const User = require('../models/User.cjs');
const PasswordResetRequest = require('../models/PasswordResetRequest.cjs');
const jwt = require('jsonwebtoken');

const DEFAULT_ACCESS_EXPIRE = '14d';
const DEFAULT_REFRESH_EXPIRE = '30d';

// Фиксированный временный пароль для учителей
const TEACHER_TEMP_PASSWORD = process.env.TEACHER_TEMP_PASSWORD || 'teacher2025';

const createAccessToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'digital-home-secret',
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRE || DEFAULT_ACCESS_EXPIRE
    }
  );
};

const createRefreshToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET || 'digital-home-refresh-secret',
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRE || DEFAULT_REFRESH_EXPIRE
    }
  );
};

const sendRefreshToken = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

// @desc    Регистрация пользователя
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { email, password, passwordConfirm, isTeacher, teacherTempPassword } = req.body;

    if (!email || !password || !passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите email и пароль'
      });
    }

    if (password !== passwordConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Пароли не совпадают'
      });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь с таким email уже существует'
      });
    }

    const username = email.split('@')[0];
    const isTeacherFlag = isTeacher === true;
    
    // Если регистрируется учитель, проверяем временный пароль
    if (isTeacherFlag && teacherTempPassword !== TEACHER_TEMP_PASSWORD) {
      return res.status(400).json({
        success: false,
        message: 'Неверный временный пароль учителя'
      });
    }

    const user = await User.create({
      email,
      password,
      username,
      displayName: username,
      role: isTeacherFlag ? 'teacher' : 'student',
      needsPasswordChange: isTeacherFlag
    });

    const token = createAccessToken(user._id);
    const refreshToken = createRefreshToken(user._id);

    sendRefreshToken(res, refreshToken);

    console.log(`✅ Зарегистрирован пользователь: ${email}${isTeacherFlag ? ' (учитель)' : ''}`);

    return res.status(201).json({
      success: true,
      message: 'Пользователь успешно создан',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        displayName: user.displayName || user.username,
        showUsername: user.showUsername ?? true,
        color: user.color || null,
        moderator: user.moderator || false,
        role: user.role,
        needsPasswordChange: user.needsPasswordChange || false
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Вход пользователя
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, укажите email и пароль'
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Неправильный email или пароль'
      });
    }

    const token = createAccessToken(user._id);
    const refreshToken = createRefreshToken(user._id);

    sendRefreshToken(res, refreshToken);

    console.log(`✅ Вход пользователя: ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Успешный вход',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username || user.email.split('@')[0],
        displayName: user.displayName || user.username || user.email.split('@')[0],
        showUsername: user.showUsername ?? true,
        color: user.color || null,
        moderator: user.moderator || false,
        role: user.role,
        needsPasswordChange: user.needsPasswordChange || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Обновление access-токена
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Нет refresh токена'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'digital-home-refresh-secret');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }

    const newToken = createAccessToken(user._id);
    const newRefreshToken = createRefreshToken(user._id);

    sendRefreshToken(res, newRefreshToken);

    return res.status(200).json({
      success: true,
      token: newToken,
      user: {
        id: user._id,
        email: user.email,
        username: user.username || user.email.split('@')[0],
        displayName: user.displayName || user.username || user.email.split('@')[0],
        showUsername: user.showUsername ?? true,
        color: user.color || null,
        moderator: user.moderator || false,
        role: user.role,
        needsPasswordChange: user.needsPasswordChange || false
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Неверный refresh токен'
    });
  }
};

// @desc    Выход пользователя
// @route   POST /api/auth/logout
// @access  Public
exports.logout = (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth'
  });

  return res.status(200).json({
    success: true,
    message: 'Успешный выход'
  });
};

// @desc    Обновить профиль (юзернейм + как отображать имя)
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { username, showUsername, color } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const hasUsername = username !== undefined && username !== null && String(username).trim().length > 0;
    const hasShowUsername = typeof showUsername === 'boolean';
    const hasColor = color !== undefined && color !== null && String(color).trim().length > 0;

    if (!hasUsername && !hasShowUsername && !hasColor) {
      return res.status(400).json({ success: false, message: 'Нет данных для обновления' });
    }

    if (hasUsername) {
      const normalized = String(username).trim().toLowerCase();

      if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'Юзернейм может содержать только латинские буквы, цифры и символы _ . -'
        });
      }

      if (normalized.length < 3 || normalized.length > 20) {
        return res.status(400).json({ success: false, message: 'Юзернейм должен быть длиной от 3 до 20 символов' });
      }

      const taken = await User.findOne({ username: normalized, _id: { $ne: userId } });
      if (taken) {
        return res.status(409).json({ success: false, message: 'Этот юзернейм уже занят' });
      }

      // Юзернейм — это «ник» для поиска в сообщениях, поэтому синхронизируем и displayName
      user.username = normalized;
      user.displayName = normalized;
    }

    if (hasShowUsername) {
      user.showUsername = showUsername;
    }

    if (hasColor) {
      const normalizedColor = String(color).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(normalizedColor)) {
        return res.status(400).json({ success: false, message: 'Некорректный формат цвета' });
      }
      user.color = normalizedColor;
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Профиль обновлён',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        displayName: user.displayName || user.username,
        showUsername: user.showUsername ?? true,
        color: user.color || null,
        moderator: user.moderator || false,
        role: user.role,
        needsPasswordChange: user.needsPasswordChange || false
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Сброс пароля (для учителей)
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Укажите новый пароль и подтверждение'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Пароли не совпадают'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Пароль должен быть не менее 6 символов'
      });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    // Если есть текущий пароль, проверяем его
    if (currentPassword) {
      const isMatch = await user.matchPassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Неверный текущий пароль'
        });
      }
    }

    // Обновляем пароль
    user.password = newPassword;
    user.needsPasswordChange = false;
    await user.save();

    return res.json({
      success: true,
      message: 'Пароль успешно изменён'
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Отправить заявку на сброс пароля администратору
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();

    // Не раскрываем, какой email существует в системе
    const user = await User.findOne({ email });
    if (user) {
      const existing = await PasswordResetRequest.findOne({ user: user._id, status: 'pending' });
      if (!existing) {
        await PasswordResetRequest.create({ user: user._id, email });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Заявка отправлена. Администратор свяжется с вами для сброса пароля.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Ошибка при отправке заявки' });
  }
};
