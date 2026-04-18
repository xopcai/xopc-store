import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { fetchMe } from "@/lib/api"

export function AuthCallbackPage() {
  const qc = useQueryClient()

  useEffect(() => {
    void (async () => {
      await qc.invalidateQueries({ queryKey: ["me"] })
      await qc.fetchQuery({ queryKey: ["me"], queryFn: fetchMe })
      window.location.assign("/")
    })()
  }, [qc])

  return (
    <p className="text-[var(--color-muted)]">Completing sign-in…</p>
  )
}
