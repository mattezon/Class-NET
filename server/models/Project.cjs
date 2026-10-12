const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Пожалуйста, укажите название проекта'],
      trim: true,
      maxlength: [120, 'Название не может быть длиннее 120 символов']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Описание не может быть длиннее 2000 символов'],
      default: ''
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Укажите создателя проекта']
    },
    // Пользователи, откликнувшиеся на проект (нажали «Участвовать»)
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    // Проект завершён создателем (участники уведомлены, участие закрыто)
    completed: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
