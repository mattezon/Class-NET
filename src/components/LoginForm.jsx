import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import useAuthStore from "../store/authStore";
import "./LoginForm.css";

const LoginForm = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotErr, setForgotErr] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, isLoading } = useAuthStore();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const result = await login(formData.email, formData.password);

    if (!result.success) {
      setError(result.message);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotErr("");
    setForgotMsg("");
    setForgotLoading(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const { data } = await axios.post(`${API_URL}/api/auth/forgot-password`, {
        email: forgotEmail,
      });
      if (data?.success) {
        setForgotMsg(data.message || "Заявка отправлена администратору.");
        setForgotEmail("");
      } else {
        setForgotErr(data?.message || "Не удалось отправить заявку.");
      }
    } catch (err) {
      setForgotErr(
        err.response?.data?.message || "Не удалось отправить заявку. Проверьте соединение с сервером.",
      );
    } finally {
      setForgotLoading(false);
    }
  };

  const toggleForgot = () => {
    setShowForgot((prev) => !prev);
    setForgotErr("");
    setForgotMsg("");
  };

  return (
    <main className="page-shell">
      <section className="login-card">
        <div className="login-card__header">
          <h1>Вход</h1>
          <p>Пожалуйста, введите ваши данные</p>
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
              placeholder="Введите пароль"
              required
            />
          </label>

          {error && <div className="error-message">{error}</div>}

          <div className="login-form__footer">
            <button
              type="button"
              className="link-muted forgot-toggle"
              onClick={toggleForgot}
            >
              Забыли пароль?
            </button>
            <button type="submit" className="button" disabled={isLoading}>
              {isLoading ? "Вход..." : "Войти"}
            </button>
          </div>
        </form>

        {showForgot && (
          <form className="forgot-form" onSubmit={handleForgotSubmit}>
            <h3>Сброс пароля</h3>
            <p>
              Укажите ваш e-mail — администратор получит заявку и сбросит
              пароль.
            </p>
            <label className="field">
              <span>E-Mail</span>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="Введите e-mail"
                required
              />
            </label>
            {forgotErr && <div className="error-message">{forgotErr}</div>}
            {forgotMsg && <div className="success-message">{forgotMsg}</div>}
            <button
              type="submit"
              className="button"
              disabled={forgotLoading || !forgotEmail.trim()}
            >
              {forgotLoading ? "Отправка..." : "Отправить заявку"}
            </button>
          </form>
        )}

        <p className="register-hint">
          Еще нет аккаунта? <Link to="/register">Создать аккаунт</Link>
        </p>
      </section>
    </main>
  );
};

export default LoginForm;
