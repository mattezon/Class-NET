const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const connectDB = require('./config/database.cjs');
const Chat = require('./models/Chat.cjs');

// Загрузить переменные окружения
dotenv.config();

// Подключение к MongoDB и запуск сервера
const startServer = async () => {
  try {
    try {
      await connectDB();
      console.log('✅ MongoDB подключена\n');
    } catch (dbError) {
      console.warn('⚠️ MongoDB недоступна, сервер запускается в режиме socket-only:', dbError.message);
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://class-net.onrender.com';
    const allowedOrigins = new Set([
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
      'https://class-net.onrender.com',
      'https://class-net-server.onrender.com',
      FRONTEND_URL
    ]);

    const origin = (originValue, callback) => {
      const isLocalDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(originValue || '');
      const isAllowed = !originValue || allowedOrigins.has(originValue) || isLocalDevOrigin;

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    };

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: true,
        credentials: true
      }
    });

    app.use(cors({
      origin,
      credentials: true
    }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());

    app.set('io', io);

    // Аутентификация сокетов по JWT (передаётся в auth.token или query.token)
    io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error('Не авторизован'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'class-net-secret');
        if (!decoded || !decoded.id) return next(new Error('Неверный токен'));

        socket.userId = String(decoded.id);
        next();
      } catch (error) {
        next(new Error('Неверный токен авторизации'));
      }
    });

    io.on('connection', (socket) => {
      const userId = socket.userId;
      socket.emit('socket:ready', { status: 'online', socketId: socket.id });

      // Подключать к комнате можно только участников чата
      socket.on('join-room', async (chatId) => {
        if (!chatId) return;

        try {
          const chat = await Chat.findOne({ _id: chatId, participants: userId }).select('_id');
          if (chat) {
            socket.join(String(chatId));
            socket.emit('chat:joined', { chatId: String(chatId) });
          } else {
            socket.emit('chat:error', { message: 'Доступ к чату запрещён' });
          }
        } catch (error) {
          // БД недоступна (socket-only режим) — разрешаем без проверки
          console.warn('⚠️ socket-only: не удалось проверить участника:', error.message);
          socket.join(String(chatId));
          socket.emit('chat:joined', { chatId: String(chatId), degraded: true });
        }
      });

      socket.on('leave-room', (chatId) => {
        if (chatId) socket.leave(chatId);
      });
    });

    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        message: 'Слишком много запросов. Повторите попытку позже.'
      }
    });

    // Маршруты API
            app.use('/api/auth', authLimiter, require('./routes/auth.cjs'));
    app.use('/api/posts', require('./routes/posts.cjs'));
    app.use('/api/projects', require('./routes/projects.cjs'));
    app.use('/api/polls', require('./routes/polls.cjs'));
    app.use('/api/chats', require('./routes/chat.cjs'));
    app.use('/api/db', require('./routes/db.cjs'));
    app.use('/api/users', require('./routes/users.cjs'));

    // Обработка 404
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: 'Маршрут не найден'
      });
    });

    // Обработка ошибок
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({
        success: false,
        message: 'Внутренняя ошибка сервера'
      });
    });

    // Запустить сервер
    const PORT = process.env.PORT || 5000;

    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║  🚀 Сервер Class-NET запущен!           ║
║  📍 http://localhost:${PORT}                     ║
║                                            ║
║  🔐 Демо учетные данные:                  
║     Email: demo@example.com                ║
║     Пароль: password123                    ║
╚════════════════════════════════════════════╝
  `);
    });
  } catch (error) {
    console.error('❌ Не удалось запустить сервер:', error.message);
    process.exit(1);
  }
};

startServer();