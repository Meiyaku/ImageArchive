import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LoginAttempt } from '../api/types'

export function useLoginLog() {
  const [attempts, setAttempts] = useState<LoginAttempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(null)
    api.listLogins().then(setAttempts).catch((err) => setError(err.message))
  }, [])

  useEffect(refresh, [refresh])

  return { attempts, error, refresh }
}
