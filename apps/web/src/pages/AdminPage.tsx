import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  approveAllPendingSkills,
  approveVersion,
  fetchAdminReviews,
  fetchAdminUsers,
  fetchMe,
  rejectVersion,
  updateAdminUserRole,
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
  const {
    data: userRows = [],
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
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

  const approveAllSkills = useMutation({
    mutationFn: approveAllPendingSkills,
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

  const setUserRole = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string
      role: "user" | "admin"
    }) => updateAdminUserRole(userId, role),
    onSuccess: (_data, { userId }) => {
      void qc.invalidateQueries({ queryKey: ["admin-users"] })
      if (userId === me.data?.id) {
        void qc.invalidateQueries({ queryKey: ["me"] })
      }
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
    <div className="space-y-12">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-semibold">Review queue</h1>
          {!isLoading &&
          !error &&
          items.some((it) => it.type === "skill") ? (
            <button
              type="button"
              disabled={approveAllSkills.isPending}
              onClick={() => {
                const n = items.filter((it) => it.type === "skill").length
                if (
                  !window.confirm(
                    `Approve all ${n} pending skill(s)? Extension submissions are not included.`,
                  )
                ) {
                  return
                }
                approveAllSkills.mutate()
              }}
              className="px-4 py-2 rounded-md bg-emerald-700 text-white text-sm hover:opacity-95 disabled:opacity-50"
            >
              {approveAllSkills.isPending
                ? "Approving…"
                : "Approve all skills"}
            </button>
          ) : null}
        </div>
      {isLoading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{(error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-[var(--color-muted)]">No pending reviews.</p>
      ) : (
        <ul className="space-y-6">
          {approveAllSkills.isError ? (
            <p className="text-red-600 text-sm mb-2">
              {(approveAllSkills.error as Error).message}
            </p>
          ) : null}
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
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Accounts</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Promote users to admin or set them back to a normal account. At least
          one admin must remain.
        </p>
        {usersLoading ? (
          <p className="text-[var(--color-muted)]">Loading users…</p>
        ) : usersError ? (
          <p className="text-red-600">{(usersError as Error).message}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium w-[1%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt=""
                            className="size-8 rounded-full"
                          />
                        ) : (
                          <span className="size-8 rounded-full bg-[var(--color-surface)] inline-block shrink-0" />
                        )}
                        <span className="font-mono">
                          @{u.username}
                          {u.id === me.data?.id ? (
                            <span className="text-[var(--color-muted)] font-sans">
                              {" "}
                              (you)
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          u.role === "admin"
                            ? "text-amber-700 font-medium"
                            : "text-[var(--color-muted)]"
                        }
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">
                      {new Date(u.createdAt * 1000).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.role === "admin" ? (
                        <button
                          type="button"
                          disabled={setUserRole.isPending}
                          onClick={() =>
                            setUserRole.mutate({ userId: u.id, role: "user" })
                          }
                          className="px-3 py-1.5 rounded-md border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface)] disabled:opacity-50"
                        >
                          Set as user
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={setUserRole.isPending}
                          onClick={() =>
                            setUserRole.mutate({ userId: u.id, role: "admin" })
                          }
                          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white text-sm hover:opacity-90 disabled:opacity-50"
                        >
                          Set as admin
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {setUserRole.isError ? (
          <p className="text-red-600 text-sm mt-2">
            {(setUserRole.error as Error).message}
          </p>
        ) : null}
      </section>
    </div>
  )
}
