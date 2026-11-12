import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { albumThumbUrl } from '../api/client'
import type { Album } from '../api/types'
import { AlbumNameDialog, ConfirmDialog } from '../components/AlbumDialogs'
import { AlbumMenu } from '../components/AlbumMenu'
import { EditAlbumDialog } from '../components/EditAlbumDialog'
import { ShareStoryDialog } from '../components/ShareStoryDialog'
import { ErrorBanner } from '../components/ErrorBanner'
import { ImageIcon, PlusIcon } from '../components/icons'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/Spinner'
import { useAlbums } from '../hooks/useAlbums'

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit' | 'share' | 'delete'; album: Album }
  | null

export default function AlbumsPage() {
  const { albums, error, createAlbum, replaceAlbum, deleteAlbum } = useAlbums()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)

  return (
    <Layout
      title="My Albums"
      actions={
        <button type="button" className="btn-primary h-9 min-h-0 px-3 text-sm" onClick={() => setDialog({ kind: 'create' })}>
          <PlusIcon width={18} height={18} /> New album
        </button>
      }
    >
      <ErrorBanner message={error} />
      {!albums && !error && <Spinner />}
      {albums?.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <ImageIcon width={48} height={48} className="text-slate-400" />
          <p className="text-slate-500 dark:text-slate-400">You don't have any albums yet.</p>
          <button type="button" className="btn-primary" onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon /> Create an album
          </button>
        </div>
      )}
      {albums && albums.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {albums.map((album) => {
            const thumb = albumThumbUrl(album)
            return (
            <li key={album.id} className="flex items-center pr-2">
              <Link to={`/albums/${album.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{album.name}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {album.itemCount} {album.itemCount === 1 ? 'item' : 'items'}
                  </p>
                </div>
              </Link>
              <AlbumMenu
                albumName={album.name}
                onEdit={() => setDialog({ kind: 'edit', album })}
                onShare={() => setDialog({ kind: 'share', album })}
                onDelete={() => setDialog({ kind: 'delete', album })}
              />
            </li>
            )
          })}
        </ul>
      )}

      {dialog?.kind === 'create' && (
        <AlbumNameDialog
          title="New album"
          submitLabel="Create"
          onSubmit={async (name) => {
            const album = await createAlbum(name)
            navigate(`/albums/${album.id}`)
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === 'edit' && <EditAlbumDialog album={dialog.album} onSaved={replaceAlbum} onClose={close} />}
      {dialog?.kind === 'share' && <ShareStoryDialog album={dialog.album} onClose={close} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete album?"
          message={`"${dialog.album.name}" and its ${dialog.album.itemCount} ${dialog.album.itemCount === 1 ? 'item' : 'items'} will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={() => deleteAlbum(dialog.album.id)}
          onClose={close}
        />
      )}
    </Layout>
  )
}
