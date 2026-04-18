import { useQuery } from "@tanstack/react-query"

async function fetchToken() {
  const r = await fetch("/api/v1/auth/token", { credentials: "include" })
  if (!r.ok) throw new Error("Not authenticated")
  return (await r.json()) as { token: string }
}

export function AuthTokenPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["auth-token"],
    queryFn: fetchToken,
    retry: false,
  })

  if (isLoading) {
    return <p className="text-[var(--color-muted)]">Loading token…</p>
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <p className="text-red-600 mb-2">{(error as Error).message}</p>
        <p className="text-sm text-[var(--color-muted)]">
          Complete GitHub sign-in first (CLI flow).
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">CLI token</h1>
      <p className="text-sm text-[var(--color-muted)] mb-4">
        Copy this JWT into your xopc CLI configuration. Treat it like a password.
      </p>
      <pre className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 break-all font-mono">
        {data.token}
      </pre>
    </div>
  )
}
