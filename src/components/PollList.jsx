import { useEffect, useState } from 'react'
import usePollsStore from '../store/pollsStore'
import useAuthStore from '../store/authStore'
import PollCard from './PollCard'
import './PollList.css'

const PollList = () => {
  const [message, setMessage] = useState('')
  const { polls, fetchPolls, isLoading, error, clearError, deletePoll } = usePollsStore()
  const { user } = useAuthStore()
  const isModerator = user?.moderator === true
  const isTeacher = user?.role === 'teacher'

  useEffect(() => {
    fetchPolls()
  }, [])

  const notify = (text) => setMessage(text)

  const handleDelete = async (pollId, pollQuestion) => {
    if (!window.confirm(`Удалить опрос «${pollQuestion}»?`)) return
    const result = await deletePoll(pollId)
    if (result.success) {
      notify('Опрос удалён')
      setTimeout(() => notify(''), 2500)
    }
  }

  if (isLoading && polls.length === 0) {
    return (
      <div className="app-loading app-loading--inline" style={{ padding: '20px' }}>
        <div className="app-loading__spinner" />
        <div className="app-loading__text">Загрузка опросов…</div>
      </div>
    )
  }

  return (
    <div className="poll-list">
      {message && <div className="poll-list__message">{message}</div>}
      {error && <div className="poll-list__error">{error}</div>}
      {polls.length === 0 ? (
        <div className="poll-list__empty">Пока нет опросов. Создайте первый! 📊</div>
      ) : (
        <div className="poll-list__grid">
          {polls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              isCreator={user?.id === poll.creator?.id || isModerator || isTeacher}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default PollList
