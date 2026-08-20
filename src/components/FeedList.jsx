import { useEffect, useState, useMemo } from 'react'
import PostCard from './PostCard'
import PollCard from './PollCard'
import usePostsStore from '../store/postsStore'
import usePollsStore from '../store/pollsStore'
import useAuthStore from '../store/authStore'
import './FeedList.css'

const FeedList = () => {
  const { posts, fetchPosts, isLoading: postsLoading, deletePost, updatePost } = usePostsStore()
  const { polls, fetchPolls, isLoading: pollsLoading, deletePoll } = usePollsStore()
  const { user } = useAuthStore()

  useEffect(() => {
    fetchPosts()
    fetchPolls()
  }, [])

  const isLoading = postsLoading || pollsLoading

  // Объединяем посты и опросы в единый массив и сортируем по дате (новые сверху)
  const feedItems = useMemo(() => {
    const items = []

    // Добавляем посты
    posts.forEach(post => {
      items.push({
        type: 'post',
        data: post,
        timestamp: post.createdAt || post.time || ''
      })
    })

    // Добавляем опросы
    polls.forEach(poll => {
      items.push({
        type: 'poll',
        data: poll,
        timestamp: poll.createdAt || ''
      })
    })

    // Сортируем: новые сверху
    return items.sort((a, b) => {
      const dateA = new Date(a.timestamp || 0).getTime()
      const dateB = new Date(b.timestamp || 0).getTime()
      return dateB - dateA
    })
  }, [posts, polls])

  const handleDeletePost = async (postId) => {
    if (window.confirm('Удалить этот пост?')) {
      await deletePost(postId)
    }
  }

  const handleEditPost = async (postId, text) => {
    await updatePost(postId, text)
  }

  const handleDeletePoll = async (pollId, pollQuestion) => {
    if (!window.confirm(`Удалить опрос «${pollQuestion}»?`)) return
    const result = await deletePoll(pollId)
    if (result.success) {
      // Уведомление можно добавить через стейт
    }
  }

  if (isLoading) {
    return (
      <div className="app-loading app-loading--inline">
        <div className="app-loading__spinner" />
        <div className="app-loading__text">Загрузка ленты...</div>
      </div>
    )
  }

  if (feedItems.length === 0) {
    return (
      <div className="feed-empty">
        <p>Пока ничего нет. Будьте первыми! 📝📊</p>
      </div>
    )
  }

  return (
    <div className="feed-list">
      {feedItems.map((item) => {
        if (item.type === 'post') {
          const post = item.data
          const isOwner = post.author?._id?.toString() === user?.id
          const isModerator = user?.moderator === true
          const isTeacher = user?.role === 'teacher'
          const rawAuthor = post.author

          return (
            <PostCard
              key={post._id}
              post={{
                ...post,
                avatar: '👤',
                author: rawAuthor?.username || rawAuthor?.displayName || rawAuthor?.email?.split('@')[0] || 'Пользователь'
              }}
              accentColor={rawAuthor?.color}
              isOwner={isOwner}
              isModerator={isModerator}
              isTeacher={isTeacher}
              onDelete={isOwner || isModerator || isTeacher ? () => handleDeletePost(post._id) : undefined}
              onEdit={isTeacher || isModerator || isOwner ? (postId, text) => handleEditPost(postId, text) : undefined}
            />
          )
        } else if (item.type === 'poll') {
          const poll = item.data
          const isCreator = poll.creator?.id === user?.id
          const creatorName = poll.creator?.username || poll.creator?.displayName || poll.creator?.email?.split('@')[0] || 'Пользователь'

          return (
            <PollCard
              key={poll.id}
              poll={{
                ...poll,
                creator: {
                  ...poll.creator,
                  username: creatorName,
                  displayName: creatorName
                }
              }}
              isCreator={isCreator}
              onDelete={isCreator ? () => handleDeletePoll(poll.id, poll.question) : undefined}
            />
          )
        }
        return null
      })}
    </div>
  )
}

export default FeedList
