import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, thumbUrl } from '../api/client'
import { ConfirmDialog } from '../components/AlbumDialogs'
import { AlbumMenu } from '../components/AlbumMenu'
import { EditAlbumDialog } from '../components/EditAlbumDialog'
import { ErrorBanner } from '../components/ErrorBanner'
import { ShareStoryDialog } from '../components/ShareStoryDialog'
import { ImageIcon, LockIcon, PlusIcon } from '../components/icons'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/Spinner'
import { useAlbum } from '../hooks/useAlbum'

export default function AlbumPage() {
  const albumId = Number(useParams().albumId)
  const { album, setAlbum, items, error } = useAlbum(albumId)
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'edit' | 'share' | 'delete' | null>(null)
  const close = () => setDialog(null)
  const addUrl = `/albums/${albumId}/items/new`

  return (
    <Layout
      title={album?.name ?? 'Album'}
      backTo="/"
      actions={
        <>
          <Link to={addUrl} className="btn-primary h-9 min-h-0 px-3 text-sm">
            <PlusIcon width={18} height={18} /> Add
          </Link>
          {album && (
            <AlbumMenu
              albumName={album.name}
              onEdit={() => setDialog('edit')}
              onShare={() => setDialog('share')}
              onDelete={() => setDialog('delete')}
            />
          )}
        </>
      }
    >
      <ErrorBanner message={error} />
      {album?.intro && (
        <p className="mb-4 whitespace-pre-wrap text-slate-600 italic dark:text-slate-400">{album.intro}</p>
      )}
      {!items && !error && <Spinner />}
      {items?.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <ImageIcon width={48} height={48} className="text-slate-400" />
          <p className="text-slate-500 dark:text-slate-400">This album is empty.</p>
          <Link to={addUrl} className="btn-primary"><PlusIcon /> Add an image</Link>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/albums/${albumId}/items/${item.id}`}
                className="group block overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                  {item.thumbKey && (
                    <img
                      src={thumbUrl(item.id, item.thumbKey)}
                      alt={item.title || `Item ${item.sequence}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  )}
                  {item.privateNotes && (
                    <span title="Has private notes" className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white">
                      <LockIcon width={14} height={14} />
                    </span>
                  )}
                </div>
                {/* Caption is the title, or the sequence number for untitled items. */}
                <p className="truncate px-2.5 py-2 text-sm font-medium">
                  {item.title || <span className="tabular-nums text-slate-500 dark:text-slate-400">#{item.sequence}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {album && dialog === 'edit' && (
        <EditAlbumDialog album={{ ...album, itemCount: items?.length ?? album.itemCount }} onSaved={setAlbum} onClose={close} />
      )}
      {album && dialog === 'share' && <ShareStoryDialog album={album} onClose={close} />}
      {album && dialog === 'delete' && (
        <ConfirmDialog
          title="Delete album?"
          message={`"${album.name}" and its ${album.itemCount} ${album.itemCount === 1 ? 'item' : 'items'} will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api.deleteAlbum(album.id)
            navigate('/', { replace: true })
          }}
          onClose={close}
        />
      )}
    </Layout>
  )
}
