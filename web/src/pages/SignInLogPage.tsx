import { useState } from 'react'
import type { LoginAttempt } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/Spinner'
import { useLoginLog } from '../hooks/useLoginLog'
import { describeDevice } from '../lib/describeDevice'

const RESULT_LABEL: Record<LoginAttempt['result'], string> = {
  success: 'Signed in',
  failed: 'Failed',
  throttled: 'Slowed down',
}

const RESULT_STYLE: Record<LoginAttempt['result'], string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  throttled: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

export default function SignInLogPage() {
  const { attempts, error, refresh } = useLoginLog()
  const [problemsOnly, setProblemsOnly] = useState(false)
  const shown = attempts?.filter((a) => !problemsOnly || a.result !== 'success')

  return (
    <Layout
      title="Sign-in log"
      backTo="/admin"
      actions={<button type="button" className="btn-secondary h-9 min-h-0 px-3 text-sm" onClick={refresh}>Refresh</button>}
    >
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Every sign-in attempt from the last 90 days, newest first.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
            Failed attempts only
          </label>
        </div>
        <ErrorBanner message={error} />
        {!attempts && !error && <Spinner />}
        {shown?.length === 0 && <p className="py-10 text-center text-slate-500 dark:text-slate-400">No sign-in attempts to show.</p>}
        {shown && shown.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {shown.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {a.username}
                    {a.result === 'failed' && a.userId === null && <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">(no such account)</span>}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <span className="tabular-nums">{a.ip ?? 'unknown IP'}</span> · <span title={a.userAgent ?? undefined}>{describeDevice(a.userAgent)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_STYLE[a.result]}`}>{RESULT_LABEL[a.result]}</span>
                  <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  )
}
