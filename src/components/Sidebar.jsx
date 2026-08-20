import useAuthStore from '../store/authStore'
import './Sidebar.css'

const Sidebar = ({ activeTab, onChangeTab, theme, toggleTheme }) => {
  const { user } = useAuthStore()
  const isModerator = user?.moderator === true
  const isTeacher = user?.role === 'teacher'

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">digital home <span className="sidebar__version">v1.2</span></div>
      
      {user && (
        <div className="sidebar__user-info" style={{
          padding: '10px 12px',
          marginBottom: '12px',
          background: isTeacher ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
          borderRadius: '8px',
          border: isTeacher ? '1px solid rgba(16, 185, 129, 0.3)' : 'none'
        }}>
          <div style={{ fontWeight: '600', fontSize: '14px' }}>
            {user.displayName || user.username || user.email}
          </div>
          <div style={{ fontSize: '12px', color: isTeacher ? '#10b981' : 'var(--muted)' }}>
            {isTeacher ? '🎓 Учитель' : '👤 Ученик'}
          </div>
        </div>
      )}

      <nav className="sidebar__nav">
        <a
          className={`sidebar__nav-link ${activeTab === 'feed' ? 'active' : ''}`}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onChangeTab('feed')
          }}
        >
          Лента
        </a>
                <a
          className={`sidebar__nav-link ${activeTab === 'messages' ? 'active' : ''}`}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onChangeTab('messages')
          }}
        >
          Сообщения
        </a>
        <a
          className={`sidebar__nav-link ${activeTab === 'projects' ? 'active' : ''}`}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onChangeTab('projects')
          }}
        >
          Исследование → Проекты
        </a>
        <a
          className={`sidebar__nav-link ${activeTab === 'profile' ? 'active' : ''}`}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onChangeTab('profile')
          }}
        >
          Профиль
        </a>
        {isModerator && (
          <a
            className={`sidebar__nav-link ${activeTab === 'admin' ? 'active' : ''}`}
            href="#"
            onClick={(e) => {
              e.preventDefault()
              onChangeTab('admin')
            }}
          >
            Админ
          </a>
        )}
      </nav>
      <button
        className="sidebar__theme-toggle"
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
    </aside>
  )
}

export default Sidebar
