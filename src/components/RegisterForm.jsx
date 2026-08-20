import { useState } from 'react'
import { Link } from 'react-router-dom'
import useAuthStore from '../store/authStore'
import './LoginForm.css'

const RegisterForm = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    isTeacher: false,
    teacherTempPassword: ''
  })
  const [error, setError] = useState('')
  const { register, isLoading } = useAuthStore()

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (formData.password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    if (formData.password !== formData.passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }

    const result = await register(
      formData.email,
      formData.password,
      formData.passwordConfirm,
      formData.isTeacher,
      formData.isTeacher ? formData.teacherTempPassword : undefined
    )

    if (!result.success) {
      setError(result.message)
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setError('')

    const newPassword = e.target.newPassword.value
    const confirmPassword = e.target.confirmPassword.value

    if (newPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }

    const result = await useAuthStore.getState().changePassword(newPassword, confirmPassword)

    if (!result.success) {
      setError(result.message)
    } else {
      // Успешная смена пароля - перенаправление на логин
      window.location.href = '/login'
    }
  }

  return (
    <main className="page-shell">
      <section className="login-card">
        <div className="login-card__header">
          <h1>Регистрация</h1>
          <p>Создайте новый аккаунт</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>E-Mail</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Введите e-mail"
              required
            />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Введите пароль (минимум 6 символов)"
              required
            />
          </label>

          <label className="field">
            <span>Подтверждение пароля</span>
            <input
              type="password"
              name="passwordConfirm"
              value={formData.passwordConfirm}
              onChange={handleChange}
              placeholder="Повторите пароль"
              required
            />
          </label>

          <label className="field">
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={formData.isTeacher}
                onChange={(e) => setFormData({...formData, isTeacher: e.target.checked})}
                style={{ width: '18px', height: '18px' }}
              />
              Я учитель
            </span>
          </label>

          {formData.isTeacher && (
            <label className="field" style={{ background: '#fef3c7', padding: '12px', borderRadius: '10px', border: '2px solid #f59e0b' }}>
              <span style={{ color: '#92400e', fontWeight: '600' }}>Временный пароль учителя</span>
              <input
                type="password"
                name="teacherTempPassword"
                value={formData.teacherTempPassword}
                onChange={(e) => setFormData({...formData, teacherTempPassword: e.target.value})}
                placeholder="Введите пароль учителя"
                style={{ background: '#fff', borderColor: '#f59e0b' }}
              />
              <small style={{ color: '#92400e', fontSize: '12px' }}>
                ⚠️ Уточните пароль у администрации
              </small>
            </label>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="login-form__footer">
            <button type="submit" className="button" disabled={isLoading}>
              {isLoading ? 'Регистрация...' : 'Создать аккаунт'}
            </button>
          </div>
        </form>

        <p className="register-hint">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </section>
    </main>
  )
}

export default RegisterForm
