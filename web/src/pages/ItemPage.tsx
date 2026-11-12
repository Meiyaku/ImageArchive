import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { imageUrl } from '../api/client'
import type { Item } from '../api/types'
import { ConfirmDialog } from '../components/AlbumDialogs'
import { ErrorBanner } from '../components/ErrorBanner'
import { ImagePicker } from '../components/ImagePicker'
import { LockIcon, PencilIcon, TrashIcon } from '../components/icons'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/Spinner'
import { useItemEditor } from '../hooks/useItemEditor'

/**
 * New items open straight into the form. Existing items open read-only and only
 * become editable after pressing Edit; Save or Cancel returns to the read-only view.
 */
export default function ItemPage() {
  const params = useParams()
  const albumId = Number(params.albumId)
  const itemId = params.itemId ? Number(params.itemId) : undefined
  const isNew = itemId === undefined
  const navigate = useNavigate()
  const editor = useItemEditor(albumId, itemId)
  const [editing, setEditing] = useState(isNew)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const albumUrl = `/albums/${albumId}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const saved = await editor.save()
    if (!saved) return
    if (isNew) navigate(albumUrl, { replace: true })
    else setEditing(false)
  }

  const cancel = () => {
    if (isNew) return navigate(albumUrl)
    editor.discard()
    setEditing(false)
  }

  const savedImage = editor.item?.imageKey ? imageUrl(editor.item.id, editor.item.imageKey) : null
  const saving = editor.progress !== null
  const viewing = !editing && editor.item !== null

  return (
    <Layout
      title={isNew ? 'Add item' : editing ? 'Edit item' : editor.item?.title || 'Item'}
      backTo={albumUrl}
      actions={
        viewing && (
          <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm" onClick={() => setEditing(true)}>
            <PencilIcon width={16} height={16} /> Edit
          </button>
        )
      }
    >
      {editor.loading ? (
        <Spinner />
      ) : viewing ? (
        <ItemView item={editor.item!} imageSrc={savedImage} />
      ) : !isNew && !editor.item ? (
        <ErrorBanner message={editor.error} />
      ) : (
        <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
          <ImagePicker src={editor.preview ?? savedImage} busy={editor.preparing || saving} onPick={editor.pickImage} />

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Title <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </span>
            <input
              className="field"
              value={editor.title}
              onChange={(e) => editor.setTitle(e.target.value)}
              maxLength={200}
              enterKeyHint="next"
            />
          </label>

          <div>
            <label htmlFor="item-sequence" className="mb-1 block text-sm font-medium">Sequence</label>
            <input
              id="item-sequence"
              className="field w-36"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              value={editor.sequence}
              onChange={(e) => editor.setSequence(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={isNew ? (editor.nextSequence !== null ? `${editor.nextSequence} (auto)` : 'Auto') : ''}
              aria-describedby="sequence-help"
            />
            <span id="sequence-help" className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Items in the album are sorted by this number.{isNew && ' Leave blank to put it at the end.'}
            </span>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Public notes</span>
            <textarea
              className="field min-h-28"
              value={editor.publicNotes}
              onChange={(e) => editor.setPublicNotes(e.target.value)}
              maxLength={20000}
              placeholder="Description, caption…"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <LockIcon width={14} height={14} /> Private notes
            </span>
            <textarea
              className="field min-h-28 bg-amber-50/60 dark:bg-amber-950/20"
              value={editor.privateNotes}
              onChange={(e) => editor.setPrivateNotes(e.target.value)}
              maxLength={20000}
              placeholder="Only for you"
            />
          </label>

          <ErrorBanner message={editor.error} />

          {saving && (
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Math.round(editor.progress! * 100)}>
              <div className="h-full bg-indigo-600 transition-[width]" style={{ width: `${editor.progress! * 100}%` }} />
            </div>
          )}

          <div className="flex items-center gap-2">
            {!isNew && (
              <button type="button" className="btn-secondary text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)} disabled={saving}>
                <TrashIcon width={18} height={18} /> Delete
              </button>
            )}
            <div className="flex-1" />
            <button type="button" className="btn-secondary" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!editor.canSave}>
              {saving ? 'Saving…' : isNew ? 'Add to album' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete item?"
          message="This image and its notes will be permanently deleted."
          confirmLabel="Delete"
          onConfirm={async () => {
            await editor.remove()
            navigate(albumUrl, { replace: true })
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Layout>
  )
}

function ItemView({ item, imageSrc }: { item: Item; imageSrc: string | null }) {
  return (
    <article className="mx-auto max-w-2xl space-y-5">
      {imageSrc && (
        // Tap the photo to open it full size (handy for zooming on a phone).
        <a href={imageSrc} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-900">
          <img src={imageSrc} alt={item.title || item.publicNotes || 'Album item'} className="max-h-[70dvh] w-full object-contain" />
        </a>
      )}

      {item.title && <h2 className="text-xl font-semibold break-words">{item.title}</h2>}

      <dl className="space-y-4">
        <div>
          <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">Sequence</dt>
          <dd className="mt-0.5 tabular-nums">{item.sequence}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">Public notes</dt>
          <NotesText text={item.publicNotes} />
        </div>
        <div className="rounded-xl bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <dt className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400">
            <LockIcon width={14} height={14} /> Private notes
          </dt>
          <NotesText text={item.privateNotes} />
        </div>
      </dl>
    </article>
  )
}

function NotesText({ text }: { text: string }) {
  if (!text) return <dd className="mt-0.5 italic text-slate-400 dark:text-slate-500">None</dd>
  return <dd className="mt-0.5 whitespace-pre-wrap break-words">{text}</dd>
}
