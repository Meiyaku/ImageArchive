import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'

export function useAdminUsers() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listUsers().then(setUsers).catch((err) => setError(err.message))
  }, [])

  const createUser = useCallback(async (username: string, password: string, isAdmin: boolean) => {
    const user = await api.createUser(username, password, isAdmin)
    setUsers((prev) => [...(prev ?? []), user].sort((a, b) => a.username.localeCompare(b.username)))
  }, [])

  const resetPassword = useCallback(async (id: number, password: string) => {
    await api.updateUser(id, { password })
  }, [])

  const setAdmin = useCallback(async (id: number, isAdmin: boolean) => {
    const user = await api.updateUser(id, { isAdmin })
    setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? user : u)))
  }, [])

  const deleteUser = useCallback(async (id: number) => {
    await api.deleteUser(id)
    setUsers((prev) => (prev ?? []).filter((u) => u.id !== id))
  }, [])

  return { users, error, createUser, resetPassword, setAdmin, deleteUser }
}
