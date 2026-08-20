import { useEffect } from 'react'
import PostCard from './PostCard'
import usePostsStore from '../store/postsStore'
import useAuthStore from '../store/authStore'
import { getAuthorDisplayName } from '../utils/userName'

const PostList = () => {
  const { posts, fetchPosts, isLoading, deletePost, updatePost } = usePostsStore()
  const { user } = useAuthStore()
  const isModerator = user?.moderator === true
  const isTeacher = user?.role === 'teacher'

  useEffect(() => {
    fetchPosts()
  }, [])

  if (isLoading) {
    return (
      <div className="app-loading app-loading--inline">
        <div className="app-loading__spinner" />
        <div className="app-loading__text">Загрузка постов...</div>
      </div>
    )
  }

  if (posts.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Пока нет постов. Будьте первыми!</div>
  }

  return (
    <div>
      {posts.map((post) => {
        const isOwner = post.author?._id?.toString() === user?.id
        const rawAuthor = post.author

        return (
          <PostCard 
            key={post._id} 
            post={{
              ...post,
              avatar: '👤',
              author: getAuthorDisplayName(rawAuthor)
            }}
            accentColor={rawAuthor?.color}
            isOwner={isOwner}
            isModerator={isModerator}
            isTeacher={isTeacher}
            onDelete={(isOwner || isModerator || isTeacher) ? () => deletePost(post._id) : undefined}
            onEdit={(postId, text) => updatePost(postId, text)}
          />
        )
      })}
    </div>
  )
}

export default PostList
