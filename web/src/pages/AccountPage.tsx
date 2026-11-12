import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { ErrorBanner } from '../components/ErrorBanner'
import { Layout } from '../components/Layout'
import { PasswordInput } from '../components/PasswordInput'

export default function AccountPage() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (next !== confirm) return setError("New passwords don't match")
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="Change password" backTo="/">
      <form onSubmit={submit} className="mx-auto max-w-sm space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Current password</span>
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">New password</span>
          <PasswordInput autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Confirm new password</span>
          <PasswordInput autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <ErrorBanner message={error} />
        {done && <p role="status" className="text-sm text-green-700 dark:text-green-400">Password changed.</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>Change password</button>
      </form>
    </Layout>
  )
}
