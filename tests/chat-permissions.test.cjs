const test = require('node:test');
const assert = require('node:assert/strict');

const { canDeleteMessage, canClearChat, canDeleteChat, canLeaveGroup, getAdminIds } = require('../server/utils/chatPermissions.cjs');

const groupChat = {
  type: 'group',
  createdBy: 'u1',
  admins: ['u1', 'u2'],
  participants: [{ toString: () => 'u1' }, { toString: () => 'u2' }, { toString: () => 'u3' }]
};

test('group admins can delete other users messages', () => {
  assert.equal(canDeleteMessage(groupChat, 'u2', { sender: 'u3', kind: 'text' }), true);
  assert.equal(canDeleteMessage(groupChat, 'u3', { sender: 'u2', kind: 'text' }), false);
});

test('system messages cannot be deleted', () => {
  assert.equal(canDeleteMessage(groupChat, 'u1', { sender: 'u1', kind: 'system' }), false);
});

test('clear and delete group require admin', () => {
  assert.equal(canClearChat(groupChat, 'u1'), true);
  assert.equal(canClearChat(groupChat, 'u3'), false);
  assert.equal(canDeleteChat(groupChat, 'u1'), true);
  assert.equal(canDeleteChat(groupChat, 'u3'), false);
});

test('last admin cannot leave group', () => {
  const singleAdminGroup = {
    type: 'group',
    createdBy: 'u1',
    admins: ['u1'],
    participants: [{ toString: () => 'u1' }, { toString: () => 'u2' }]
  };
  assert.equal(canLeaveGroup(singleAdminGroup, 'u1'), false);
  assert.equal(canLeaveGroup(groupChat, 'u1'), true);
  assert.deepEqual(getAdminIds({ createdBy: 'u9' }), ['u9']);
});
