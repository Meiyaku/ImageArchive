import { useEffect, useState } from 'react'
import { api, thumbUrl } from '../api/client'
import type { Album, Item } from '../api/types'
import { ErrorBanner } from './ErrorBanner'
import { CheckIcon, ImageIcon, ShareIcon } from './icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

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
  const [mode, setMode] = useState<'all' | 'choose'>('all')
  const [items, setItems] = useState<Item[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const preparing = status.kind === 'preparing'

  // The album's photos are only needed once the user chooses to pick some.
  useEffect(() => {
    if (mode !== 'choose' || items) return
    let cancelled = false
    api.listItems(album.id)
      .then((list) => !cancelled && setItems(list))
      .catch((err) => !cancelled && setError((err as Error).message))
    return () => {
      cancelled = true
    }
  }, [mode, items, album.id])

  // Any change to the options means the PDF already made is out of date.
  const changed = () => setStatus({ kind: 'idle' })

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
    changed()
  }

  const selectAll = (all: boolean) => {
    setSelected(new Set(all && items ? items.map((i) => i.id) : []))
    changed()
  }

  const nothingChosen = mode === 'choose' && selected.size === 0

  const create = async () => {
    setError(null)
    setStatus({ kind: 'preparing' })
    try {
      // Sent in album order for tidiness; the server orders by sequence regardless.
      const itemIds = mode === 'choose' ? (items ?? []).map((i) => i.id).filter((id) => selected.has(id)) : undefined
      setStatus({ kind: 'ready', file: await api.storyPdf(album, { coverPage, itemIds }) })
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
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Creates a PDF of <strong>{album.name}</strong>: photos in order, each with its title and public notes.
          Private notes are never included.
        </p>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <span>
            <span className="block font-medium">Include cover page</span>
            <span className="block text-sm text-gray-500 dark:text-gray-400">
              {album.coverImageKey ? 'Album name, cover photo and intro' : 'Album name and intro (no cover photo set)'}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="h-6 w-6 shrink-0"
            checked={coverPage}
            disabled={preparing}
            onChange={(e) => {
              setCoverPage(e.target.checked)
              changed()
            }}
          />
        </label>

        <fieldset disabled={preparing} className="space-y-3">
          <legend className="sr-only">Photos to include</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {([['all', 'All photos'], ['choose', 'Choose photos']] as const).map(([value, label]) => (
              <label
                key={value}
                className="cursor-pointer rounded-md px-3 py-2 text-center text-sm font-medium text-gray-600 has-checked:bg-white has-checked:text-gray-900 has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-blue-500 dark:text-gray-300 dark:has-checked:bg-gray-900 dark:has-checked:text-gray-100"
              >
                <input
                  type="radio"
                  name="story-photos"
                  value={value}
                  className="sr-only"
                  checked={mode === value}
                  onChange={() => {
                    setMode(value)
                    changed()
                  }}
                />
                {label}
              </label>
            ))}
          </div>

          {mode === 'choose' && (
            <PhotoChooser items={items} selected={selected} onToggle={toggle} onSelectAll={selectAll} />
          )}
        </fieldset>

        <ErrorBanner message={error} />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {status.kind !== 'ready' ? (
            <button type="button" className="btn-primary" onClick={create} disabled={preparing || nothingChosen}>
              {preparing ? 'Preparing…' : 'Create PDF'}
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

interface PhotoChooserProps {
  items: Item[] | null
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  onSelectAll: (all: boolean) => void
}

/** Grid of the album's items in sequence order; tap to add to or remove from the PDF. */
function PhotoChooser({ items, selected, onToggle, onSelectAll }: PhotoChooserProps) {
  if (!items) return <Spinner />
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">This album has no photos yet.</p>
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300" aria-live="polite">
          {selected.size} of {items.length} chosen
        </span>
        <span className="flex gap-3">
          <button type="button" className="text-blue-600 disabled:opacity-50 dark:text-blue-400"
            onClick={() => onSelectAll(true)} disabled={selected.size === items.length}>
            Select all
          </button>
          <button type="button" className="text-blue-600 disabled:opacity-50 dark:text-blue-400"
            onClick={() => onSelectAll(false)} disabled={selected.size === 0}>
            Clear
          </button>
        </span>
      </div>
      <ul className="grid max-h-[45dvh] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-4">
        {items.map((item) => {
          const on = selected.has(item.id)
          const name = item.title || `#${item.sequence}`
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={name}
                onClick={() => onToggle(item.id)}
                className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-gray-800 ${on ? 'ring-3 ring-blue-600' : ''}`}
              >
                {item.thumbKey ? (
                  <img src={thumbUrl(item.id, item.thumbKey)} alt="" loading="lazy"
                    className={`h-full w-full object-cover transition-opacity ${on ? '' : 'opacity-60'}`} />
                ) : (
                  <ImageIcon className="m-auto h-full text-gray-400" />
                )}
                <span
                  className={`absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow ${on ? 'bg-blue-600 text-white' : 'bg-black/30 text-transparent'}`}
                >
                  <CheckIcon width={14} height={14} strokeWidth={3} />
                </span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1.5 py-0.5 text-left text-xs text-white">
                  {name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
