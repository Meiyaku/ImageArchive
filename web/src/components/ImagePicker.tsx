import { useId, type ChangeEvent } from 'react'
import { CameraIcon } from './icons'

interface ImagePickerProps {
  /** URL of the image currently shown (new pick preview or the saved image). */
  src: string | null
  busy: boolean
  onPick: (file: File) => void
}

/**
 * A <label> wrapping a visually-hidden file input. On iOS this opens the native
 * sheet (Photo Library / Take Photo / Choose File); no `capture` attribute, so the
 * camera isn't forced. The input must stay in the DOM and be activated by a real
 * tap, which a label guarantees.
 */
export function ImagePicker({ src, busy, onPick }: ImagePickerProps) {
  const id = useId()

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires change.
    e.target.value = ''
    if (file) onPick(file)
  }

  return (
    <div>
      <input id={id} type="file" accept="image/*" className="sr-only" onChange={onChange} disabled={busy} />
      <label
        htmlFor={id}
        className="relative flex aspect-[4/3] w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-100 text-slate-500 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
      >
        {src ? (
          <>
            <img src={src} alt="Selected" className="h-full w-full object-contain" />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1.5 text-sm font-medium text-white">
              Change photo
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2">
            <CameraIcon width={36} height={36} />
            <span className="font-medium">{busy ? 'Preparing…' : 'Tap to choose or take a photo'}</span>
          </span>
        )}
        {busy && src && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">Preparing…</span>}
      </label>
    </div>
  )
}
