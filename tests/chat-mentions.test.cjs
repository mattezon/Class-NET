const test = require('node:test');
const assert = require('node:assert/strict');

const { extractMentionTokens, matchMentions } = require('../server/utils/chatMentions.cjs');

test('extractMentionTokens returns unique lowercase usernames', () => {
  const tokens = extractMentionTokens('Привет @Alice и @bob и @alice');
  assert.deepEqual(tokens, ['alice', 'bob']);
});

test('matchMentions matches users by username and email prefix', () => {
  const users = [
    { _id: '1', username: 'alice', email: 'alice@example.com' },
    { _id: '2', username: 'bob', email: 'bob@example.com' }
  ];
  const matched = matchMentions('hi @alice @bob', users);
  assert.deepEqual(matched.map((user) => user._id), ['1', '2']);
});
