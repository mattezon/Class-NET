import useToastStore from '../store/toastStore'
import './ToastHost.css'

const ToastHost = () => {
  const toasts = useToastStore((state) => state.toasts)
  const remove = useToastStore((state) => state.remove)

  if (!toasts.length) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.type}`}
          onClick={() => remove(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}

export default ToastHost
