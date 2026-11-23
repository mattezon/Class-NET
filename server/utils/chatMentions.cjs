const mentionRegex = /@([\p{L}\p{N}_.-]{2,32})/gu;

const extractMentionTokens = (text) => {
  const tokens = [];
  for (const match of String(text || '').matchAll(mentionRegex)) {
    const token = match[1].toLowerCase();
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
};

const matchMentions = (text, users = []) => {
  const tokens = extractMentionTokens(text);
  if (!tokens.length) return [];

  return users.filter((user) => {
    const candidates = [
      user?.username,
      user?.displayName,
      user?.email?.split('@')[0]
    ].filter(Boolean).map((value) => String(value).toLowerCase());

    return candidates.some((candidate) => tokens.includes(candidate));
  });
};

module.exports = { extractMentionTokens, matchMentions };
