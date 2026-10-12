import { useState } from 'react'
import useAuthStore from '../store/authStore'
import useProjectsStore from '../store/projectsStore'
import { getAuthorDisplayName } from '../utils/userName'
import './ProjectCard.css'

const ProjectCard = ({ project }) => {
  const { user } = useAuthStore()
  const {
    participateProject,
    leaveProject,
    removeParticipant,
    completeProject,
    deleteProject,
    error,
    clearError
  } = useProjectsStore()
  const [isParticipating, setIsParticipating] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [participated, setParticipated] = useState(false)
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [removingUserId, setRemovingUserId] = useState(null)

  const isCreator = project.creator?.id === user?.id
  const isParticipant = (project.participants || []).some((p) =>
    typeof p === 'object' ? String(p.id) === String(user?.id) : String(p) === String(user?.id)
  )
  const isCompleted = project.completed === true
  const participantList = (project.participants || []).filter((p) => typeof p === 'object' && p.id)

  const handleParticipate = async (e) => {
    e.preventDefault()
    if (!user?.id) return
    const ownNote = showNote ? note.trim() : ''
    setIsParticipating(true)
    clearError()
    const res = await participateProject(project.id, ownNote)
    setIsParticipating(false)
    setShowNote(false)
    setNote('')
    if (res.success) setParticipated(true)
  }

  const handleLeave = async () => {
    if (!user?.id || isLeaving) return
    if (!window.confirm('Отменить участие в этом проекте?')) return
    setIsLeaving(true)
    clearError()
    const res = await leaveProject(project.id)
    setIsLeaving(false)
    if (res.success) setParticipated(false)
  }

  const handleRemove = async (userId, name) => {
    if (!window.confirm(`Исключить участника «${name}» из проекта?`)) return
    setRemovingUserId(userId)
    clearError()
    await removeParticipant(project.id, userId)
    setRemovingUserId(null)
  }

  const handleComplete = async () => {
    if (!window.confirm(`Завершить проект «${project.title}»? Все участники получат уведомление.`)) return
    setIsCompleting(true)
    clearError()
    const res = await completeProject(project.id)
    setIsCompleting(false)
    if (!res.success && res.message) window.alert(res.message)
  }

  const handleDelete = async () => {
    if (!window.confirm(`Удалить проект «${project.title}» без возможности восстановления?`)) return
    setIsDeleting(true)
    clearError()
    const res = await deleteProject(project.id)
    setIsDeleting(false)
    if (!res.success && res.message) window.alert(res.message)
  }

  return (
    <div className="project-card">
      <button
        type="button"
        className="project-card__btn project-card__btn--delete project-card__delete-corner"
        onClick={handleDelete}
        disabled={isDeleting}
        title="Удалить проект"
      >
        {isDeleting ? '…' : '🗑'}
      </button>

      <div className="project-card__body">
        <div className="project-card__title">
          {project.title}
          {isCompleted && <span className="project-card__badge project-card__badge--done">Завершён</span>}
        </div>

        {project.description && <div className="project-card__desc">{project.description}</div>}
        <div className="project-card__author">Создатель: {getAuthorDisplayName(project.creator)}</div>
        <div className="project-card__meta">Участник(ов): {participantList.length}</div>
        {error && <div className="project-card__error" role="alert">{error}</div>}
      </div>

      <div className="project-card__actions">
        {isCreator ? (
          <div className="project-card__owner-actions">
            {!isCompleted && (
              <button
                type="button"
                className="project-card__btn project-card__btn--complete"
                onClick={handleComplete}
                disabled={isCompleting}
              >
                {isCompleting ? 'Завершение…' : '✔ Завершить проект'}
              </button>
            )}

            <button
              type="button"
              className="project-card__btn project-card__btn--participants"
              onClick={() => setShowParticipants(!showParticipants)}
            >
              {showParticipants ? '▾' : '▸'} 👥 Участники ({participantList.length})
            </button>

            {showParticipants && (
              <div className="project-card__participants-panel">
                {participantList.length === 0 ? (
                  <div className="project-card__participants-empty">Пока нет участников</div>
                ) : (
                  participantList.map((p) => (
                    <div key={p.id} className="project-card__participant-row">
                      <span className="project-card__participant-name">{getAuthorDisplayName(p)}</span>
                      <button
                        type="button"
                        className="project-card__btn project-card__btn--remove"
                        onClick={() => handleRemove(p.id, getAuthorDisplayName(p))}
                        disabled={removingUserId === p.id}
                      >
                        {removingUserId === p.id ? '…' : 'Исключить'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : isCompleted ? (
          <span className="project-card__state project-card__state--done">
            Проект завершён — участие закрыто
          </span>
        ) : isParticipant || participated ? (
          <button
            type="button"
            className="project-card__btn project-card__btn--leave"
            onClick={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? 'Отмена…' : 'Покинуть'}
          </button>
        ) : (
          <>
            {showNote && (
              <textarea
                className="project-card__note"
                placeholder="Комментарий для создателя (необязательно)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            )}
            <button
              type="button"
              className="project-card__btn project-card__btn--participate"
              onClick={handleParticipate}
              disabled={isParticipating}
            >
              {isParticipating ? 'Отправка…' : 'Участвовать'}
            </button>
            <button
              type="button"
              className="project-card__btn project-card__btn--note"
              onClick={() => setShowNote(!showNote)}
            >
              {showNote ? '✕' : '💬'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default ProjectCard
