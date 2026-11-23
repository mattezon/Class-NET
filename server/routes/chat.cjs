const express = require('express');
const protect = require('../middleware/auth.cjs');
const {
  getChats,
  searchUsersAndChats,
  createDirectChat,
  createGroupChat,
  getChatMessages,
  sendMessage,
  deleteMessage,
  clearChatMessages,
  deleteChat,
  addGroupParticipant,
  removeGroupParticipant,
  toggleGroupAdmin,
  updateGroupChat,
  leaveGroupChat,
  markChatRead,
  searchChatMessages
} = require('../controllers/chat.cjs');

const router = express.Router();

router.get('/search', protect, searchUsersAndChats);
router.get('/', protect, getChats);
router.post('/direct', protect, createDirectChat);
router.post('/group', protect, createGroupChat);
router.patch('/:chatId', protect, updateGroupChat);
router.post('/:chatId/leave', protect, leaveGroupChat);
router.post('/:chatId/read', protect, markChatRead);
router.get('/:chatId/messages/search', protect, searchChatMessages);
router.post('/:chatId/participants', protect, addGroupParticipant);
router.delete('/:chatId/participants/:userId', protect, removeGroupParticipant);
router.put('/:chatId/participants/:userId/admin', protect, toggleGroupAdmin);
router.get('/:chatId/messages', protect, getChatMessages);
router.post('/:chatId/messages', protect, sendMessage);
router.delete('/:chatId/messages/:messageId', protect, deleteMessage);
router.delete('/:chatId/messages', protect, clearChatMessages);
router.delete('/:chatId', protect, deleteChat);

module.exports = router;
