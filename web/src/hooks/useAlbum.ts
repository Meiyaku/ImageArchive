import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Album, Item } from '../api/types'

export function useAlbum(albumId: number) {
  const [album, setAlbum] = useState<Album | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([api.getAlbum(albumId), api.listItems(albumId)])
      .then(([a, i]) => {
        if (cancelled) return
        setAlbum(a)
        setItems(i)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [albumId])

  return { album, setAlbum, items, error }
}
