const getAdminIds = (chat) => {
  const ids = Array.isArray(chat?.admins)
    ? chat.admins.map((id) => id?.toString?.() || String(id))
    : [];
  if (ids.length) return ids;
  return chat?.createdBy ? [chat.createdBy.toString()] : [];
};

const isGroupAdmin = (chat, userId) =>
  chat?.type === 'group' && Boolean(userId) && getAdminIds(chat).includes(String(userId));

const canDeleteMessage = (chat, userId, message) => {
  if (message?.kind === 'system') return false;
  if (!chat || !userId) return false;
  const isSender = message?.sender && String(message.sender) === String(userId);
  return Boolean(isSender || isGroupAdmin(chat, userId));
};

const canClearChat = (chat, userId) => {
  if (!chat || !userId) return false;
  if (chat.type === 'group') return isGroupAdmin(chat, userId);
  return chat.participants?.some((id) => String(id) === String(userId)) || false;
};

const canDeleteChat = (chat, userId) => {
  if (!chat || !userId) return false;
  if (chat.type === 'group') return isGroupAdmin(chat, userId);
  return chat.participants?.some((id) => String(id) === String(userId)) || false;
};

const canLeaveGroup = (chat, userId) => {
  if (!chat || chat.type !== 'group' || !userId) return false;
  const isMember = chat.participants?.some((id) => String(id) === String(userId));
  if (!isMember) return false;
  const adminIds = getAdminIds(chat);
  if (adminIds.includes(String(userId)) && adminIds.length === 1) return false;
  return true;
};

module.exports = {
  getAdminIds,
  isGroupAdmin,
  canDeleteMessage,
  canClearChat,
  canDeleteChat,
  canLeaveGroup
};
