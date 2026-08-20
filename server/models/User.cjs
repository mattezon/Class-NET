const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Пожалуйста, укажите email'],
      unique: true,
      lowercase: true
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      default: function () {
        return this.email ? this.email.split('@')[0] : undefined;
      }
    },
    displayName: {
      type: String,
      trim: true,
      default: function () {
        return this.username || this.email?.split('@')[0] || '';
      }
    },
    showUsername: {
      type: Boolean,
      default: true
    },
    color: {
      type: String,
      trim: true,
      default: null
    },
    moderator: {
      type: Boolean,
      default: false,
      // Право модератора назначается ТОЛЬКО через БД (moderator: true).
      // API-обновление профиля (auth/profile) и эндпоинты управления
      // пользователями не принимают и не меняют это поле.
    },
    role: {
      type: String,
      enum: ['student', 'teacher'],
      default: 'student'
    },
    needsPasswordChange: {
      type: Boolean,
      default: false
    },
    password: {
      type: String,
      required: [true, 'Пожалуйста, укажите пароль'],
      minlength: 6,
      select: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Хешировать пароль перед сохранением
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcryptjs.genSalt(10);
  this.password = await bcryptjs.hash(this.password, salt);
});

// Метод для сравнения паролей
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcryptjs.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);