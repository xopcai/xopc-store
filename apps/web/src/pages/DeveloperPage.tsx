import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { DeveloperPackageRow } from "@xopc-store/shared"
import { fetchDeveloperPackages, fetchMe, type CurrentUser } from "@/lib/api"

export function DeveloperPage() {
  const me = useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: fetchMe,
  })
  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ["developer-packages"],
    queryFn: fetchDeveloperPackages,
    enabled: !!me.data,
    select: (d) => d.items,
  })

  if (!me.data) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
        <p className="text-[var(--color-muted)] mb-4">
          Sign in with GitHub to manage your packages.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/api/v1/auth/github?mode=web"
          }}
          className="px-4 py-2 rounded-md bg-[var(--color-accent)] text-white font-medium"
        >
          Sign in with GitHub
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold">Developer Center</h1>
        <Link
          to="/developer/publish"
          className="px-4 py-2 rounded-md bg-[var(--color-accent)] text-white text-sm font-medium"
        >
          + Publish
        </Link>
      </div>
      <h2 className="text-sm font-medium text-[var(--color-muted)] mb-3">
        My packages
      </h2>
      {isLoading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{(error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-[var(--color-muted)]">No packages yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p: DeveloperPackageRow) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 justify-between rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 text-sm"
            >
              <span className="font-mono font-medium">{p.name}</span>
              <span
                className={
                  p.type === "skill"
                    ? "text-[var(--color-skill)]"
                    : "text-[var(--color-extension)]"
                }
              >
                {p.type === "skill" ? "Skill" : "Extension"}
              </span>
              <span className="text-[var(--color-muted)] max-w-[140px] truncate" title={p.category ?? undefined}>
                {p.category ?? "—"}
              </span>
              <StatusBadge
                status={p.status}
                versionStatus={p.latestVersionStatus}
                rejectReason={p.rejectReason}
              />
              <span className="text-[var(--color-muted)] font-mono">
                v{p.latestVersion ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge(props: {
  status: string
  versionStatus: string | null
  rejectReason: string | null
}) {
  const vs = props.versionStatus
  if (vs === "published" && props.status === "published") {
    return (
      <span className="text-emerald-600 flex items-center gap-1">
        ● Published
      </span>
    )
  }
  if (vs === "pending") {
    return <span className="text-[var(--color-muted)]">○ Pending</span>
  }
  if (vs === "rejected") {
    return (
      <span
        className="text-red-600 cursor-help"
        title={props.rejectReason ?? "Rejected"}
      >
        ✕ Rejected
      </span>
    )
  }
  return <span className="text-[var(--color-muted)]">{props.status}</span>
}
