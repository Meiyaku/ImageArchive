import { useState } from 'react'
import { api } from '../api/client'
import type { Album } from '../api/types'
import { ErrorBanner } from './ErrorBanner'
import { ShareIcon } from './icons'
import { Modal } from './Modal'

type Status = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'ready'; file: File }

function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Two steps on purpose: iOS only opens the share sheet straight from a tap, and building
 * the PDF can take long enough to lose that, so we build first, then Share is its own tap.
 */
export function ShareStoryDialog({ album, onClose }: { album: Album; onClose: () => void }) {
  const [coverPage, setCoverPage] = useState(album.coverImageKey !== null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setError(null)
    setStatus({ kind: 'preparing' })
    try {
      setStatus({ kind: 'ready', file: await api.storyPdf(album, coverPage) })
    } catch (err) {
      setError((err as Error).message)
      setStatus({ kind: 'idle' })
    }
  }

  const share = async (file: File) => {
    try {
      await navigator.share({ files: [file], title: album.name })
    } catch (err) {
      // Dismissing the share sheet isn't an error.
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    }
  }

  return (
    <Modal title="Share story" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Creates a PDF of <strong>{album.name}</strong>: each photo in order with its title and public notes.
          Private notes are never included.
        </p>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <span>
            <span className="block font-medium">Include cover page</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              {album.coverImageKey ? 'Album name, cover photo and intro' : 'Album name and intro (no cover photo set)'}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="h-6 w-6 shrink-0"
            checked={coverPage}
            disabled={status.kind === 'preparing'}
            onChange={(e) => {
              setCoverPage(e.target.checked)
              setStatus({ kind: 'idle' })
            }}
          />
        </label>

        <ErrorBanner message={error} />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {status.kind !== 'ready' ? (
            <button type="button" className="btn-primary" onClick={create} disabled={status.kind === 'preparing'}>
              {status.kind === 'preparing' ? 'Preparing…' : 'Create PDF'}
            </button>
          ) : canShareFile(status.file) ? (
            <button type="button" className="btn-primary" onClick={() => share(status.file)}>
              <ShareIcon width={18} height={18} /> Share
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => download(status.file)}>
              Download PDF
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
