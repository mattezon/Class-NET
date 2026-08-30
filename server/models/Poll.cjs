const mongoose = require('mongoose');

// Опция опроса
const optionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, 'Укажите вариант ответа'],
      trim: true,
      maxlength: [200, 'Вариант не может быть длиннее 200 символов']
    },
    votes: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { _id: false }
);

const pollSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, 'Пожалуйста, укажите вопрос опроса'],
      trim: true,
      maxlength: [300, 'Вопрос не может быть длиннее 300 символов']
    },
    options: {
      type: [optionSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2 && v.length <= 10,
        message: 'Опрос должен содержать от 2 до 10 вариантов'
      }
    },
    allowsMultiple: {
      type: Boolean,
      default: false
    },
    endsAt: {
      type: Date,
      default: null
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Укажите создателя опроса']
    },
    // Пользователи, которые проголосовали (для ограничения одного голоса в single-choice)
    voters: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    // userId (string) -> индекс выбранного варианта (Number) или массив индексов (для allowsMultiple)
    userChoices: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Poll', pollSchema);
