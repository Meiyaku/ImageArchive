import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ErrorBanner } from '../components/ErrorBanner'
import { ImageIcon } from '../components/icons'
import { PasswordInput } from '../components/PasswordInput'
import { Spinner } from '../components/Spinner'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <Spinner fullScreen />
  if (user) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="safe-px flex min-h-dvh items-center justify-center bg-auth-bg-light py-10 dark:bg-auth-bg-dark">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ImageIcon />
          </div>
          <h1 className="text-2xl font-semibold">Image Archive</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to see your albums</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Username</span>
          <input
            className="field"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <PasswordInput
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorBanner message={error} />
        <button type="submit" className="btn w-full bg-auth-btn-light text-white hover:bg-auth-btn-light-hover dark:bg-auth-btn-dark dark:hover:bg-auth-btn-dark-hover" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">Need an account? Ask your administrator.</p>
      </form>
    </div>
  )
}
