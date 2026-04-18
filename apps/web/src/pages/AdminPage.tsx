import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  approveVersion,
  fetchAdminReviews,
  fetchMe,
  rejectVersion,
  type CurrentUser,
} from "@/lib/api"

export function AdminPage() {
  const qc = useQueryClient()
  const me = useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: fetchMe,
  })
  const { data: items = [], isLoading, error, refetch } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: fetchAdminReviews,
    enabled: me.data?.role === "admin",
    select: (d) => d.items,
  })
  const [reason, setReason] = useState("")
  const [rejectId, setRejectId] = useState<string | null>(null)

  const approve = useMutation({
    mutationFn: (id: string) => approveVersion(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reviews"] })
      void refetch()
    },
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectVersion(id, reason),
    onSuccess: () => {
      setRejectId(null)
      setReason("")
      void qc.invalidateQueries({ queryKey: ["admin-reviews"] })
      void refetch()
    },
  })

  if (!me.data) {
    return (
      <p className="text-[var(--color-muted)]">Sign in to access admin.</p>
    )
  }
  if (me.data.role !== "admin") {
    return (
      <p className="text-red-600">You do not have admin access.</p>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Review queue</h1>
      {isLoading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{(error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-[var(--color-muted)]">No pending reviews.</p>
      ) : (
        <ul className="space-y-6">
          {items.map((it) => (
            <li
              key={it.versionId}
              className="rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap justify-between gap-2 mb-3">
                <div>
                  <h2 className="font-semibold text-lg">{it.packageName}</h2>
                  <p className="text-sm text-[var(--color-muted)]">
                    @{it.author.username} · v{it.version} ·{" "}
                    {(it.fileSize / 1024).toFixed(1)} KB
                  </p>
                </div>
                <span
                  className={`text-xs uppercase px-2 py-1 rounded h-fit ${
                    it.type === "skill"
                      ? "bg-blue-50 text-[var(--color-skill)]"
                      : "bg-purple-50 text-[var(--color-extension)]"
                  }`}
                >
                  {it.type}
                </span>
              </div>
              <details className="mb-3">
                <summary className="cursor-pointer text-sm text-[var(--color-accent)]">
                  Manifest
                </summary>
                <pre className="mt-2 text-xs bg-[var(--color-surface)] p-3 rounded-lg overflow-x-auto">
                  {JSON.stringify(it.manifest, null, 2)}
                </pre>
              </details>
              {it.readme ? (
                <details className="mb-3">
                  <summary className="cursor-pointer text-sm text-[var(--color-accent)]">
                    README preview
                  </summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto bg-[var(--color-surface)] p-3 rounded-lg">
                    {it.readme.slice(0, 4000)}
                    {it.readme.length > 4000 ? "…" : ""}
                  </pre>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(it.versionId)}
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm"
                >
                  Approve
                </button>
                {rejectId === it.versionId ? (
                  <>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Rejection reason"
                      className="flex-1 min-w-[200px] rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        rejectMut.mutate({
                          id: it.versionId,
                          reason: reason.trim() || "No reason",
                        })
                      }
                      className="px-4 py-2 rounded-md bg-red-600 text-white text-sm"
                    >
                      Confirm reject
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRejectId(it.versionId)}
                    className="px-4 py-2 rounded-md border border-red-200 text-red-700 text-sm"
                  >
                    Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
