export function Spinner({ fullScreen = false }: { fullScreen?: boolean }) {
  const spinner = (
    <div
      role="status"
      aria-label="Loading"
      className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
    />
  )
  if (!fullScreen) return <div className="flex justify-center py-12">{spinner}</div>
  return <div className="flex min-h-dvh items-center justify-center">{spinner}</div>
}
