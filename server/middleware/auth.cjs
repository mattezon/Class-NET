const jwt = require('jsonwebtoken')
const User = require('../models/User.cjs')

const protect = async (req, res, next) => {
  let token

  const authHeader = req.headers.authorization || req.headers.Authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  }

  if (!token) {
    console.warn('❌ Нет токена в запросе', {
      auth: !!authHeader,
      headers: Object.keys(req.headers),
      cookies: req.headers.cookie
    })
    return res.status(401).json({
      success: false,
      message: 'Не авторизован'
    })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'class-net-secret')
    const user = await User.findById(decoded.id)

    if (!user) {
      console.warn('❌ Пользователь не найден по ID:', decoded.id)
      return res.status(401).json({
        success: false,
        message: 'Пользователь не найден'
      })
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      showUsername: user.showUsername,
      color: user.color,
      moderator: user.moderator === true
    }
    next()
  } catch (error) {
    console.warn('❌ Ошибка проверки токена:', error.message)
    return res.status(401).json({
      success: false,
      message: 'Неверный токен авторизации'
    })
  }
}

// Опциональная авторизация: определяет req.user, если токен есть,
// но не блокирует запрос для гостей
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'class-net-secret')
      const user = await User.findById(decoded.id)

      if (user) {
        req.user = {
          id: user._id.toString(),
          email: user.email,
          username: user.username,
          showUsername: user.showUsername,
          color: user.color,
          moderator: user.moderator === true
        }
      }
    } catch (error) {
      // Токен невалиден/истёк — просто считаем гостем
    }
  }

  next()
}

// Только для модераторов (req.user.moderator === true)
const requireModerator = (req, res, next) => {
  if (!req.user?.moderator) {
    return res.status(403).json({
      success: false,
      message: 'Доступ запрещён: требуются права модератора'
    })
  }
  next()
}

module.exports = protect
module.exports.requireModerator = requireModerator
module.exports.optionalAuth = optionalAuth
