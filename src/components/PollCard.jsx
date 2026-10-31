import { useState, useEffect } from 'react'
import usePollsStore from '../store/pollsStore'
import useAuthStore from '../store/authStore'
import { getAuthorDisplayName } from '../utils/userName'
import './PollCard.css'

const PollCard = ({ poll, isCreator = false, onDelete, accentColor }) => {
  const { user } = useAuthStore()
  const { votePoll, removeVote, error } = usePollsStore()
  const [isVoting, setIsVoting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [localPoll, setLocalPoll] = useState(poll)

  // Синхронизация с обновлением из стора (например, poll:update по сокету)
  useEffect(() => {
    setLocalPoll(poll)
  }, [poll])

  // Голосовать: повторный клик по своему варианту в одиночном опросе — снять голос
  const handleVote = async (index) => {
    if (localPoll.hasEnded || !user?.id || isVoting) return
    if (!allowsMultiple && userVote === index) {
      await handleRemoveVote()
      return
    }
    setIsVoting(true)
    const res = await votePoll(localPoll.id, index)
    setIsVoting(false)
    if (res.success) {
      setLocalPoll(res.poll)
    }
  }

  const handleRemoveVote = async () => {
    if (localPoll.hasEnded || !user?.id || isRemoving) return
    setIsRemoving(true)
    const res = await removeVote(localPoll.id)
    setIsRemoving(false)
    if (res.success) {
      setLocalPoll(res.poll)
    }
  }

  const voted = !!localPoll.voted
  const userVoteRaw = localPoll.userVote
  const allowsMultiple = localPoll.allowsMultiple
  // Нормализуем голос пользователя: число для одиночного, массив чисел для мульти
  const userVote = allowsMultiple
    ? (Array.isArray(userVoteRaw) ? userVoteRaw.map(Number) : [])
    : (userVoteRaw !== null && userVoteRaw !== undefined ? Number(userVoteRaw) : null)
  const total = localPoll.total || 0
  const myPercent = (opt) => (total > 0 ? Math.round((opt.votes / total) * 100) : 0)

  // Форматируем время: дн ч мин сек
  const timeLeft = localPoll.endsAt && !localPoll.hasEnded
    ? (() => {
        const diff = new Date(localPoll.endsAt) - new Date()
        if (diff <= 0) return 'Завершается'
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24))
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((diff % (1000 * 60)) / 1000)
        
        const parts = []
        if (days > 0) parts.push(`${days}д`)
        if (hours > 0) parts.push(`${hours}ч`)
        if (minutes > 0) parts.push(`${minutes}м`)
        if (seconds > 0) parts.push(`${seconds}с`)
        
        return `Осталось: ${parts.join(' ')}`
      })()
    : null

  // Форматируем создателя опроса
  const creatorName = (() => {
    if (!localPoll.creator) return 'Неизвестный'
    if (typeof localPoll.creator === 'object' && localPoll.creator !== null) {
      return getAuthorDisplayName(localPoll.creator) || 'Неизвестный'
    }
    return String(localPoll.creator)
  })()

  // Для allowsMultiple — показываем результаты только после окончания
  // Для одиночного — показываем после голосования или окончания
  const showResults = localPoll.hasEnded || (voted && !allowsMultiple)

  // Есть ли у текущего пользователя сохранённый ответ (можно удалить)
  const hasMyAnswer = !localPoll.hasEnded && (
    allowsMultiple ? (Array.isArray(userVote) && userVote.length > 0) : userVote !== null && userVote !== undefined
  )

  return (
    <div
      className="poll-card"
      style={{
        '--poll-accent': accentColor || undefined
      }}
    >
      <div className="poll-card__header">
        <div className="poll-card__header-top">
          <span className="poll-card__question">{localPoll.question}</span>
          {allowsMultiple && <span className="poll-card__badge">Мультивыбор</span>}
          {localPoll.hasEnded && <span className="poll-card__badge poll-card__badge--ended">Завершён</span>}
          {isCreator && (
            <button
              className="poll-card__delete"
              onClick={() => onDelete(localPoll.id, localPoll.question)}
              title="Удалить опрос"
              type="button"
            >
              🗑️
            </button>
          )}
        </div>
        <span className="poll-card__creator">Создал: {creatorName}</span>
      </div>

      <div className="poll-card__options">
        {localPoll.options.map((opt) => {
          const isSelected = allowsMultiple
            ? (userVote || []).includes(opt.index)
            : userVote === opt.index
          return (
            <button
              key={opt.index}
              type="button"
              className={`poll-card__option ${isSelected ? 'active' : ''} ${showResults ? 'result' : ''}`}
              style={{
                ...(isSelected && {
                  // Выбранный вариант — цвет текущего пользователя
                  borderColor: accentColor || undefined,
                  background: accentColor || undefined,
                  color: '#fff'
                })
              }}
              onClick={() => handleVote(opt.index)}
              disabled={localPoll.hasEnded || isVoting || isRemoving || (showResults && !isSelected)}
            >
              <span className="poll-card__option-text">{opt.text}</span>
              {showResults && (
                <span className="poll-card__option-stat">
                  {opt.votes} ({myPercent(opt)}%)
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="poll-card__footer">
        <span>👥 {localPoll.votersCount} участников</span>
        {timeLeft && <span className="poll-card__timer">{timeLeft}</span>}
        {hasMyAnswer && (
          <button
            type="button"
            className="poll-card__remove-vote"
            onClick={handleRemoveVote}
            disabled={isRemoving}
          >
            {isRemoving ? 'Удаление…' : 'Удалить ответ'}
          </button>
        )}
      </div>

      {error && <div className="poll-card__error">{error}</div>}
    </div>
  )
}

export default PollCard
