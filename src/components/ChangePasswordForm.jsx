import { useState } from 'react'
import useAuthStore from '../store/authStore'
import './LoginForm.css'

const ChangePasswordForm = () => {
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { changePassword } = useAuthStore()

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (formData.newPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Пароли не совпадают')
      return
    }

    setIsLoading(true)
    const result = await changePassword(formData.newPassword, formData.confirmPassword)
    setIsLoading(false)

    if (!result.success) {
      setError(result.message)
    } else {
      // Успешная смена пароля - перенаправление на главную
      window.location.href = '/'
    }
  }

  return (
    <main className="page-shell">
      <section className="login-card">
        <div className="login-card__header">
          <h1>🔐 Смена пароля</h1>
          <p>Пожалуйста, установите новый пароль для вашего аккаунта</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Новый пароль</span>
            <input
              type="password"
              name="newPassword"
              value={formData.newPassword}
              onChange={handleChange}
              placeholder="Введите новый пароль (минимум 6 символов)"
              required
            />
          </label>

          <label className="field">
            <span>Подтверждение пароля</span>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Повторите новый пароль"
              required
            />
          </label>

          {error && <div className="error-message">{error}</div>}

          <div className="login-form__footer">
            <button type="submit" className="button" disabled={isLoading}>
              {isLoading ? 'Сохранение...' : 'Сохранить пароль'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

export default ChangePasswordForm
