export const extractMentionTokens = (text) => {
  const tokens = []
  for (const match of String(text || '').matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)) {
    const token = match[1].toLowerCase()
    if (!tokens.includes(token)) tokens.push(token)
  }
  return tokens
}

export const isMentioned = (text, member) => {
  const tokens = extractMentionTokens(text)
  const candidates = [member?.username, member?.displayName, member?.name, member?.email?.split('@')[0]]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
  return candidates.some((candidate) => tokens.includes(candidate))
}
