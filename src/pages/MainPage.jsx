import { useState } from 'react'
import Sidebar from '../components/Sidebar'
import PostCreator from '../components/PostCreator'
import FeedList from '../components/FeedList'
import ProjectsSection from '../components/ProjectsSection'
import Profile from './Profile'
import ChatPanel from '../components/ChatPanel'
import UsersList from '../components/UsersList'
import ModerationPage from './ModerationPage'
import '../App.css'
import '../components/Sidebar.css'
import '../components/PostCreator.css'
import '../components/PostCard.css'
import '../pages/Profile.css'

const MainPage = ({ theme, toggleTheme }) => {
  const [activeTab, setActiveTab] = useState('feed')

  return (
    <div className={`main-layout ${activeTab === 'messages' ? 'main-layout--messages' : ''}`}>
      <Sidebar activeTab={activeTab} onChangeTab={setActiveTab} theme={theme} toggleTheme={toggleTheme} />
      <div className={`main-content ${activeTab === 'messages' ? 'main-content--messages' : ''}`}>
        {activeTab === 'feed' && (
          <>
            <PostCreator />
            <FeedList />
            <UsersList />
          </>
        )}

        {activeTab === 'messages' && (
          <ChatPanel />
        )}

        {activeTab === 'projects' && (
          <ProjectsSection />
        )}

        {activeTab === 'profile' && (
          <Profile />
        )}

        {activeTab === 'admin' && (
          <ModerationPage />
        )}
      </div>
    </div>
  )
}

export default MainPage
