import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { prepareImage } from '../lib/prepareImage'

/** State for both the "add item" (itemId undefined) and "edit item" pages. */
export function useItemEditor(albumId: number, itemId: number | undefined) {
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(itemId !== undefined)
  const [sequence, setSequence] = useState('')
  const [nextSequence, setNextSequence] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [publicNotes, setPublicNotes] = useState('')
  const [privateNotes, setPrivateNotes] = useState('')
  const [newImage, setNewImage] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New items: show which number they'll get if the field is left blank.
  useEffect(() => {
    if (itemId !== undefined) return
    let cancelled = false
    api.getAlbum(albumId)
      .then((a) => !cancelled && setNextSequence(a.nextSequence))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [albumId, itemId])

  useEffect(() => {
    if (itemId === undefined) return
    let cancelled = false
    api.getItem(itemId)
      .then((i) => {
        if (cancelled) return
        if (i.albumId !== albumId) throw new Error('Item not found')
        setItem(i)
        setSequence(String(i.sequence))
        setTitle(i.title)
        setPublicNotes(i.publicNotes)
        setPrivateNotes(i.privateNotes)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [albumId, itemId])

  // Revoke the preview object URL when it's replaced or the page unmounts.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const pickImage = useCallback(async (file: File) => {
    setError(null)
    setPreparing(true)
    try {
      const blob = await prepareImage(file)
      setNewImage(blob)
      setPreview(URL.createObjectURL(blob))
    } finally {
      setPreparing(false)
    }
  }, [])

  const trimmedSequence = sequence.trim()
  const dirty =
    newImage !== null ||
    (item
      ? title.trim() !== item.title ||
        publicNotes !== item.publicNotes ||
        privateNotes !== item.privateNotes ||
        (trimmedSequence !== '' && trimmedSequence !== String(item.sequence))
      : false)
  const canSave = !preparing && progress === null && (item ? dirty : newImage !== null)

  /** Returns the saved item, or null if saving failed (error is set). */
  const save = useCallback(async (): Promise<Item | null> => {
    setError(null)
    setProgress(0)
    try {
      // Editing with the field cleared keeps the current number.
      const fields = { image: newImage, sequence: trimmedSequence || undefined, title: title.trim(), publicNotes, privateNotes }
      const saved = item
        ? await api.updateItem(item.id, fields, setProgress)
        : await api.createItem(albumId, fields, setProgress)
      setItem(saved)
      setSequence(String(saved.sequence))
      setTitle(saved.title)
      setNewImage(null)
      setPreview(null)
      return saved
    } catch (err) {
      setError((err as Error).message)
      return null
    } finally {
      setProgress(null)
    }
  }, [albumId, item, newImage, trimmedSequence, title, publicNotes, privateNotes])

  /** Throws away unsaved edits, restoring the fields from the saved item. */
  const discard = useCallback(() => {
    setNewImage(null)
    setPreview(null)
    setError(null)
    if (item) {
      setSequence(String(item.sequence))
      setTitle(item.title)
      setPublicNotes(item.publicNotes)
      setPrivateNotes(item.privateNotes)
    }
  }, [item])

  const remove = useCallback(async () => {
    if (item) await api.deleteItem(item.id)
  }, [item])

  return {
    item, loading, error,
    sequence, setSequence, nextSequence,
    title, setTitle, publicNotes, setPublicNotes, privateNotes, setPrivateNotes,
    preview, preparing, pickImage, progress,
    canSave, dirty, save, discard, remove,
  }
}
