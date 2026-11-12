import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BackIcon } from './icons'

interface LayoutProps {
  title: string
  backTo?: string
  actions?: ReactNode
  children: ReactNode
}

export function Layout({ title, backTo, actions, children }: LayoutProps) {
  useEffect(() => {
    document.title = `${title} · Image Archive`
  }, [title])

  return (
    <div className="min-h-dvh">
      <header className="safe-px sticky top-0 z-20 border-b border-slate-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2">
          {backTo && (
            <Link to={backTo} aria-label="Back" className="-ml-2 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
              <BackIcon />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {actions}
          <UserMenu />
        </div>
      </header>
      <main className="safe-px safe-pb mx-auto max-w-5xl pt-4">{children}</main>
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (!user) return null
  const initial = user.username.charAt(0).toUpperCase()
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="truncate px-4 py-2 text-sm text-slate-500 dark:text-slate-400">Signed in as {user.username}</p>
          <MenuLink onClick={() => navigate('/')}>My albums</MenuLink>
          <MenuLink onClick={() => navigate('/account')}>Change password</MenuLink>
          {user.isAdmin && <MenuLink onClick={() => navigate('/admin')}>Manage users</MenuLink>}
          <MenuLink onClick={() => logout().then(() => navigate('/login'))}>Sign out</MenuLink>
        </div>
      )}
    </div>
  )
}

function MenuLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block w-full px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
      {children}
    </button>
  )
}
