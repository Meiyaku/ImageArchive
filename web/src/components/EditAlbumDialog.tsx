import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react'
import { albumCoverUrl, api, thumbUrl } from '../api/client'
import type { Album, Item } from '../api/types'
import { prepareImage } from '../lib/prepareImage'
import { ErrorBanner } from './ErrorBanner'
import { BackIcon, ImageIcon } from './icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

/** A cover change is held locally and only sent when the user presses Save. */
type CoverChange =
  | { kind: 'keep' }
  | { kind: 'upload'; image: Blob; preview: string }
  | { kind: 'item'; item: Item }
  | { kind: 'remove' }

interface EditAlbumDialogProps {
  album: Album
  onSaved: (album: Album) => void
  onClose: () => void
}

export function EditAlbumDialog({ album, onSaved, onClose }: EditAlbumDialogProps) {
  const fileId = useId()
  const [name, setName] = useState(album.name)
  const [intro, setIntro] = useState(album.intro)
  const [cover, setCover] = useState<CoverChange>({ kind: 'keep' })
  const [choosing, setChoosing] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Release the upload preview's object URL when it's replaced or the dialog closes.
  const uploadPreview = cover.kind === 'upload' ? cover.preview : null
  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview)
  }, [uploadPreview])

  const coverSrc =
    cover.kind === 'upload' ? cover.preview
      : cover.kind === 'item' ? thumbUrl(cover.item.id, cover.item.thumbKey)
        : cover.kind === 'keep' && album.coverThumbKey ? albumCoverUrl(album)
          : null

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPreparing(true)
    try {
      const image = await prepareImage(file)
      setCover({ kind: 'upload', image, preview: URL.createObjectURL(image) })
    } finally {
      setPreparing(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let saved = album
      if (name.trim() !== album.name || intro.trim() !== album.intro) {
        saved = await api.updateAlbum(album.id, { name: name.trim(), intro: intro.trim() })
      }
      if (cover.kind === 'upload') saved = await api.uploadAlbumCover(album.id, cover.image)
      if (cover.kind === 'item') saved = await api.setAlbumCoverFromItem(album.id, cover.item.id)
      if (cover.kind === 'remove') saved = await api.removeAlbumCover(album.id)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (choosing) {
    return (
      <Modal title="Choose a cover photo" onClose={onClose}>
        <CoverChooser
          albumId={album.id}
          onBack={() => setChoosing(false)}
          onChoose={(item) => {
            setCover({ kind: 'item', item })
            setChoosing(false)
          }}
        />
      </Modal>
    )
  }

  const hasCover = coverSrc !== null
  return (
    <Modal title="Edit album" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium">Cover photo</span>
          <div className="flex gap-3">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800">
              {preparing ? <span className="text-xs">Preparing…</span>
                : coverSrc ? <img src={coverSrc} alt="Cover" className="h-full w-full object-cover" />
                  : <ImageIcon />}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              {/* Label-wrapped hidden input: opens the iOS photo picker on tap. */}
              <input id={fileId} type="file" accept="image/*" className="sr-only" onChange={onFile} disabled={preparing || busy} />
              <label htmlFor={fileId} className="btn-secondary h-9 min-h-0 cursor-pointer px-3 text-sm">Upload photo</label>
              <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm" onClick={() => setChoosing(true)} disabled={album.itemCount === 0}>
                Choose from album
              </button>
              {hasCover && (
                <button type="button" className="px-1 text-sm text-red-600 dark:text-red-400" onClick={() => setCover({ kind: 'remove' })}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Intro <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
          </span>
          <textarea
            className="field min-h-24"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            maxLength={5000}
            placeholder="A few words to open the story…"
          />
        </label>

        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || preparing || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CoverChooser({ albumId, onBack, onChoose }: { albumId: number; onBack: () => void; onChoose: (item: Item) => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listItems(albumId).then(setItems).catch((err) => setError(err.message))
  }, [albumId])

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="-ml-1 flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400">
        <BackIcon width={16} height={16} /> Back
      </button>
      <ErrorBanner message={error} />
      {!items && !error && <Spinner />}
      {items && (
        <ul className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto">
          {items.filter((i) => i.thumbKey).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onChoose(item)}
                aria-label={`Use ${item.title || `item ${item.sequence}`} as cover`}
                className="block aspect-square w-full overflow-hidden rounded-lg bg-slate-100 ring-indigo-500 focus:ring-2 dark:bg-slate-800"
              >
                <img src={thumbUrl(item.id, item.thumbKey)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
