import { useEffect, useState } from "react";
import axios from "axios";
import useAuthStore from "../store/authStore";
import { getAuthorDisplayName } from "../utils/userName";
import "./ModerationPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

const UserRow = ({ user, onEdit, onDelete, onResetPassword }) => {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user.username || "");
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [color, setColor] = useState(user.color || "#2f5dff");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onEdit(user.id, { username, displayName, color });
    setSaving(false);
    setEditing(false);
  };

  return (
    <li className="mod-user">
      <div className="mod-user__info">
        <span
          className="mod-user__avatar"
          style={{ "--dot": user.color || "var(--primary)" }}
        >
          {(user.displayName || user.username || "U").slice(0, 2).toUpperCase()}
        </span>
        <div className="mod-user__names">
          <strong>{user.displayName || user.username}</strong>
          <small>
            @{user.username || "\u2014"} \u00B7 {user.email}
          </small>
        </div>
        {user.moderator && (
          <span className="mod-user__badge">Модератор</span>
        )}
        {user.role === "teacher" && (
          <span className="mod-user__badge mod-user__badge--teacher">Учитель</span>
        )}
      </div>

      {editing ? (
        <div className="mod-user__form">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Отображаемое имя"
          />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Юзернейм"
          />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#2f5dff"}
            onChange={(e) => setColor(e.target.value)}
          />
          <div className="mod-user__form-actions">
            <button
              className="mod-btn mod-btn--save"
              onClick={save}
              disabled={saving}
            >
              {saving ? "..." : "Сохранить"}
            </button>
            <button className="mod-btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="mod-user__actions">
          <button className="mod-btn" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button className="mod-btn" onClick={() => onResetPassword(user.id)}>
            Пароль
          </button>
          <button
            className="mod-btn mod-btn--danger"
            onClick={() => {
              if (
                window.confirm(
                  `Удалить пользователя ${user.email}? Это удалит его посты и сообщения.`,
                )
              )
                onDelete(user.id);
            }}
          >
            Удалить
          </button>
        </div>
      )}
    </li>
  );
};

const ModerationPage = () => {
  const { user } = useAuthStore();
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const notify = (text) => setMessage(text);

  const loadUsers = () =>
    axios
      .get(`${API_BASE}/api/users`)
      .then(({ data }) => data?.success && setUsers(data.users || []))
      .catch((e) =>
        notify(
          e.response?.data?.message ||
            "Не удалось загрузить пользователей",
        ),
      );

  const loadPosts = () =>
    axios
      .get(`${API_BASE}/api/posts`)
      .then(({ data }) => data?.success && setPosts(data.posts || []))
      .catch((e) =>
        notify(
          e.response?.data?.message ||
            "Не удалось загрузить посты",
        ),
      );

  const loadRequests = () =>
    axios
      .get(`${API_BASE}/api/users/reset-requests`)
      .then(({ data }) => data?.success && setRequests(data.requests || []))
      .catch((e) =>
        notify(e.response?.data?.message || "Не удалось загрузить заявки"),
      );

  useEffect(() => {
    if (tab === "users") {
      setLoading(true);
      loadUsers().finally(() => setLoading(false));
    }
    if (tab === "posts") {
      setLoading(true);
      loadPosts().finally(() => setLoading(false));
    }
    if (tab === "requests") {
      setLoading(true);
      loadRequests().finally(() => setLoading(false));
    }
  }, [tab]);

  const editUser = async (id, payload) => {
    const res = await axios
      .put(`${API_BASE}/api/users/${id}`, payload)
      .catch((e) => {
        notify(
          e.response?.data?.message ||
            "Ошибка при обновлении пользователя",
        );
        return null;
      });
    if (res?.data?.success) {
      notify("Пользователь обновлен");
      loadUsers();
    }
  };

  const deleteUser = async (id) => {
    const res = await axios.delete(`${API_BASE}/api/users/${id}`).catch((e) => {
      notify(
        e.response?.data?.message || "Ошибка при удалении",
      );
      return null;
    });
    if (res?.data?.success) {
      notify("Пользователь удален");
      loadUsers();
    }
  };

  const resetPassword = async (id) => {
    const password = window.prompt(
      "Новый пароль пользователя (не короче 6 символов):",
    );
    if (!password) return;
    const res = await axios
      .put(`${API_BASE}/api/users/${id}/password`, { password })
      .catch((e) => {
        notify(
          e.response?.data?.message ||
            "Ошибка при смене пароля",
        );
        return null;
      });
    if (res?.data?.success) notify("Пароль обновлен");
  };

  const handleRequestReset = async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      notify("Пользователь для этой заявки не найден");
      return;
    }
    const password = window.prompt(
      "Новый пароль пользователя (не короче 6 символов):",
    );
    if (!password) return;
    const res = await axios
      .put(`${API_BASE}/api/users/${userId}/password`, { password })
      .catch((e) => {
        notify(e.response?.data?.message || "Ошибка при смене пароля");
        return null;
      });
    if (res?.data?.success) {
      notify("Пароль обновлен; заявка закрыта");
      await axios
        .put(`${API_BASE}/api/users/reset-requests/${request.id}`)
        .catch(() => {});
      loadRequests();
    }
  };

  const handleRequestDone = async (request) => {
    const res = await axios
      .put(`${API_BASE}/api/users/reset-requests/${request.id}`)
      .catch((e) => {
        notify(e.response?.data?.message || "Ошибка при обработке заявки");
        return null;
      });
    if (res?.data?.success) {
      notify("Заявка отмечена выполненной");
      loadRequests();
    }
  };

  const editPost = async (id) => {
    const post = posts.find((p) => p._id === id);
    if (!post) return;
    const text = window.prompt("Новый текст поста:", post.text);
    if (text === null) return;
    const res = await axios
      .put(`${API_BASE}/api/posts/${id}`, { text })
      .catch((e) => {
        notify(
          e.response?.data?.message ||
            "Ошибка при редактировании поста",
        );
        return null;
      });
    if (res?.data?.success) {
      notify("Пост обновлен");
      loadPosts();
    }
  };

  const deletePost = async (id) => {
    if (!window.confirm("Удалить этот пост?")) return;
    const res = await axios.delete(`${API_BASE}/api/posts/${id}`).catch((e) => {
      notify(
        e.response?.data?.message ||
          "Ошибка при удалении поста",
      );
      return null;
    });
    if (res?.data?.success) {
      notify("Пост удален");
      loadPosts();
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.username, u.displayName, u.email]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q));
  });

  return (
    <main className="mod-page">
      <h1 className="mod-page__title">Администрирование</h1>

      <div className="mod-page__tabs">
        <button
          className={`mod-tab ${tab === "users" ? "active" : ""}`}
          onClick={() => setTab("users")}
        >
          Пользователи ({users.length})
        </button>
        <button
          className={`mod-tab ${tab === "posts" ? "active" : ""}`}
          onClick={() => setTab("posts")}
        >
          Посты ({posts.length})
        </button>
        <button
          className={`mod-tab ${tab === "requests" ? "active" : ""}`}
          onClick={() => setTab("requests")}
        >
          Заявки на сброс ({requests.filter((r) => r.status === "pending").length})
        </button>
      </div>

      {message && <div className="mod-page__message">{message}</div>}

      {tab === "users" && (
        <div className="mod-users">
          <p className="mod-page__hint">
            Права модератора назначаются только
            через БД (`moderator: true`) \u2014 в интерфейсе их
            изменить нельзя.
          </p>
          <input
            className="mod-search"
            placeholder="Поиск пользователя по имени/почте\u2026"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loading ? (
            <p>Загрузка\u2026</p>
          ) : (
            <ul className="mod-list">
              {filteredUsers.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onEdit={editUser}
                  onDelete={deleteUser}
                  onResetPassword={resetPassword}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "posts" && (
        <div className="mod-posts">
          <p className="mod-page__hint">
            Редактирование и удаление любых
            постов. Удаление безвозвратно.
          </p>
          {loading ? (
            <p>Загрузка\u2026</p>
          ) : (
            <ul className="mod-list">
              {posts.map((p) => (
                <li key={p._id} className="mod-post">
                  <div className="mod-post__info">
                    <strong>
                      {p.author
                        ? getAuthorDisplayName(p.author)
                        : "неизвестен"}
                    </strong>
                    <small>
                      {new Date(p.createdAt || p._id).toLocaleString()}
                    </small>
                  </div>
                  <div className="mod-post__text">{p.text}</div>
                  <div className="mod-post__actions">
                    <button className="mod-btn" onClick={() => editPost(p._id)}>
                      Изменить
                    </button>
                    <button
                      className="mod-btn mod-btn--danger"
                      onClick={() => deletePost(p._id)}
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="mod-requests">
          <p className="mod-page__hint">
            Заявки на сброс пароля, присланные пользователями через «Забыли
            пароль?».
          </p>
          {loading ? (
            <p>Загрузка\u2026</p>
          ) : (
            <ul className="mod-list">
              {requests.map((r) => (
                <li key={r.id} className="mod-request">
                  <div className="mod-request__info">
                    <strong>{r.user?.email || r.email}</strong>
                    <small>{new Date(r.createdAt).toLocaleString()}</small>
                    <span
                      className={`mod-status ${r.status === "done" ? "done" : "pending"}`}
                    >
                      {r.status === "done" ? "Выполнена" : "Ожидает"}
                    </span>
                  </div>
                  <div className="mod-request__actions">
                    {r.status === "pending" && r.user?.id && (
                      <>
                        <button
                          className="mod-btn mod-btn--save"
                          onClick={() => handleRequestReset(r)}
                        >
                          Сбросить пароль
                        </button>
                        <button
                          className="mod-btn"
                          onClick={() => handleRequestDone(r)}
                        >
                          Готово
                        </button>
                      </>
                    )}
                    {(r.status === "done" || !r.user?.id) && (
                      <button
                        className="mod-btn"
                        onClick={() => handleRequestDone(r)}
                      >
                        Готово
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
};

export default ModerationPage;
