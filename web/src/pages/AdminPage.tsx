import { useState, type FormEvent } from 'react'
import type { User } from '../api/types'
import { ConfirmDialog } from '../components/AlbumDialogs'
import { ErrorBanner } from '../components/ErrorBanner'
import { Layout } from '../components/Layout'
import { Modal } from '../components/Modal'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../context/AuthContext'
import { useAdminUsers } from '../hooks/useAdminUsers'

export default function AdminPage() {
  const { user: me } = useAuth()
  const { users, error, createUser, resetPassword, setAdmin, deleteUser } = useAdminUsers()
  const [resetting, setResetting] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  return (
    <Layout title="Manage users" backTo="/">
      <div className="mx-auto max-w-2xl space-y-6">
        <CreateUserForm onCreate={createUser} />

        <section>
          <h2 className="mb-2 font-semibold">Accounts</h2>
          <ErrorBanner message={error ?? rowError} />
          {!users && !error && <Spinner />}
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {users?.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {u.username} {u.id === me?.id && <span className="text-sm font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {u.isAdmin ? 'Admin' : 'User'} · created {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {u.id !== me?.id && (
                  <button
                    type="button"
                    className="btn-secondary h-9 min-h-0 px-3 text-sm"
                    onClick={() => setAdmin(u.id, !u.isAdmin).catch((err) => setRowError(err.message))}
                  >
                    {u.isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                )}
                <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm" onClick={() => setResetting(u)}>
                  Reset password
                </button>
                {u.id !== me?.id && (
                  <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm text-red-600 dark:text-red-400" onClick={() => setDeleting(u)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {resetting && (
        <ResetPasswordDialog user={resetting} onSubmit={(pw) => resetPassword(resetting.id, pw)} onClose={() => setResetting(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.username}?`}
          message="This permanently deletes the account and all of its albums and images."
          confirmLabel="Delete account"
          onConfirm={() => deleteUser(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Layout>
  )
}

function CreateUserForm({ onCreate }: { onCreate: (u: string, p: string, admin: boolean) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    try {
      await onCreate(username.trim(), password, isAdmin)
      setCreated(username.trim())
      setUsername('')
      setPassword('')
      setIsAdmin(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-semibold">Create account</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Username</span>
          <input className="field" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <input className="field" type="text" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
        <span>Administrator (can manage users)</span>
      </label>
      <ErrorBanner message={error} />
      {created && <p role="status" className="text-sm text-green-700 dark:text-green-400">Created "{created}". Share the password with them securely.</p>}
      <button type="submit" className="btn-primary" disabled={busy}>Create account</button>
    </form>
  )
}

function ResetPasswordDialog({ user, onSubmit, onClose }: { user: User; onSubmit: (pw: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">New password</span>
          <input className="field" type="text" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        <p className="text-sm text-slate-500 dark:text-slate-400">They'll be signed out of all devices.</p>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>Reset password</button>
        </div>
      </form>
    </Modal>
  )
}
