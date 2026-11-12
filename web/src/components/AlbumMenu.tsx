import { useEffect, useRef, useState } from 'react'
import { MoreIcon, PencilIcon, ShareIcon, TrashIcon } from './icons'

interface AlbumMenuProps {
  albumName: string
  onEdit: () => void
  onShare: () => void
  onDelete: () => void
}

/** The ⋯ button and its pop-up menu, used on the album list rows and the album page header. */
export function AlbumMenu({ albumName, onEdit, onShare, onDelete }: AlbumMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  const itemClass = 'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Options for ${albumName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <MoreIcon />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" onClick={choose(onEdit)} className={itemClass}>
            <PencilIcon width={18} height={18} /> Edit album
          </button>
          <button type="button" role="menuitem" onClick={choose(onShare)} className={itemClass}>
            <ShareIcon width={18} height={18} /> Share story
          </button>
          <button type="button" role="menuitem" onClick={choose(onDelete)} className={`${itemClass} text-red-600 dark:text-red-400`}>
            <TrashIcon width={18} height={18} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}
