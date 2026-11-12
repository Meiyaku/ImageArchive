import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Album } from '../api/types'

const byName = (a: Album, b: Album) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function useAlbums() {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setError(null)
    api.listAlbums().then(setAlbums).catch((err) => setError(err.message))
  }, [])

  useEffect(reload, [reload])

  const createAlbum = useCallback(async (name: string) => {
    const album = await api.createAlbum(name)
    setAlbums((prev) => [...(prev ?? []), album].sort(byName))
    return album
  }, [])

  /** Swaps in an album the Edit album dialog saved. */
  const replaceAlbum = useCallback((album: Album) => {
    setAlbums((prev) => (prev ?? []).map((a) => (a.id === album.id ? album : a)).sort(byName))
  }, [])

  const deleteAlbum = useCallback(async (id: number) => {
    await api.deleteAlbum(id)
    setAlbums((prev) => (prev ?? []).filter((a) => a.id !== id))
  }, [])

  return { albums, error, reload, createAlbum, replaceAlbum, deleteAlbum }
}
