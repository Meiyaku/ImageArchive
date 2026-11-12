import { useState, type FormEvent } from 'react'
import { ErrorBanner } from './ErrorBanner'
import { Modal } from './Modal'

interface NameDialogProps {
  title: string
  submitLabel: string
  initialName?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

/** Used for both "New album" and "Rename album". */
export function AlbumNameDialog({ title, submitLabel, initialName = '', onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Album name</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
            required
            enterKeyHint="done"
          />
        </label>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-4 text-slate-600 dark:text-slate-300">{message}</p>
      <ErrorBanner message={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-danger" disabled={busy} onClick={confirm}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}
