import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function Shell(props: {
  title?: string
  user?: { username: string; role: string } | null
  onLogin?: () => void
  onLogout?: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
          <Link to="/" className="font-semibold text-lg text-[var(--color-ink)]">
            xopc Store
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--color-muted)] flex-1">
            <Link
              to="/"
              className="hover:text-[var(--color-ink)] font-medium text-[var(--color-ink)]"
            >
              Discover
            </Link>
            <Link
              to="/developer"
              className="hover:text-[var(--color-ink)] font-medium"
            >
              Developer
            </Link>
            {props.user?.role === "admin" ? (
              <Link
                to="/admin"
                className="hover:text-[var(--color-ink)] font-medium"
              >
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3">
            {props.user ? (
              <>
                <span className="text-sm text-[var(--color-muted)]">
                  @{props.user.username}
                </span>
                <button
                  type="button"
                  onClick={props.onLogout}
                  className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-white"
                >
                  Log out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={props.onLogin}
                className="text-sm px-4 py-2 rounded-md bg-[var(--color-accent)] text-white font-medium hover:opacity-90"
              >
                Sign in with GitHub
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
        {props.title ? (
          <h1 className="text-2xl font-semibold mb-6">{props.title}</h1>
        ) : null}
        {props.children}
      </main>
      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted)]">
        xopc Store — extensions for{" "}
        <a
          href="https://github.com/xopcai/xopc"
          className="text-[var(--color-accent)] hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          xopc
        </a>
      </footer>
    </div>
  )
}
