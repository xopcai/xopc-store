import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { PackageListItem } from "@xopc-store/shared"
import { fetchPackageCategories, fetchPackages, PACKAGE_CATEGORY_UNCATEGORIZED } from "@/lib/api"

const DISPLAY_UNCATEGORIZED = "Uncategorized"

function categoryLabel(c: string | null | undefined) {
  return c ?? DISPLAY_UNCATEGORIZED
}

function groupPackages(items: PackageListItem[]) {
  const m = new Map<string, PackageListItem[]>()
  for (const p of items) {
    const key = categoryLabel(p.category)
    if (!m.has(key)) m.set(key, [])
    m.get(key)!.push(p)
  }
  return [...m.entries()].sort((a, b) => {
    if (a[0] === DISPLAY_UNCATEGORIZED) return 1
    if (b[0] === DISPLAY_UNCATEGORIZED) return -1
    return a[0].localeCompare(b[0])
  })
}

function PackageCard({ p }: { p: PackageListItem }) {
  return (
    <Link
      to="/packages/$name"
      params={{ name: p.name }}
      className="group rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
          {p.name}
        </h2>
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
            p.type === "skill"
              ? "bg-blue-50 text-[var(--color-skill)]"
              : "bg-purple-50 text-[var(--color-extension)]"
          }`}
        >
          {p.type === "skill" ? "Skill" : "Extension"}
        </span>
      </div>
      <p className="text-sm text-[var(--color-muted)] line-clamp-2 mb-4">
        {p.description}
      </p>
      <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
        <span>@{p.author.username}</span>
        <span>⬇ {p.downloads.toLocaleString()}</span>
      </div>
    </Link>
  )
}

export function HomePage() {
  const [q, setQ] = useState("")
  const [type, setType] = useState<"all" | "skill" | "extension">("all")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [sort, setSort] = useState<"downloads" | "newest">("downloads")
  const [page, setPage] = useState(1)

  const queryKey = useMemo(
    () => ["packages", q, type, sort, page, categoryFilter] as const,
    [q, type, sort, page, categoryFilter],
  )

  const categoriesQuery = useQuery({
    queryKey: ["package-categories"],
    queryFn: fetchPackageCategories,
  })

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      fetchPackages({
        q: q.trim() || undefined,
        type: type === "all" ? undefined : type,
        category: categoryFilter || undefined,
        sort,
        page,
        pageSize: 20,
      }),
  })

  const grouped = useMemo(
    () => (data?.items ? groupPackages(data.items) : []),
    [data?.items],
  )

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="search"
          placeholder="Search skills & extensions…"
          value={q}
          onChange={(e) => {
            setPage(1)
            setQ(e.target.value)
          }}
          className="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm bg-white shadow-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden bg-white">
          {(["all", "skill", "extension"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setPage(1)
                setType(t)
              }}
              className={`px-4 py-2 text-sm capitalize ${
                type === t
                  ? "bg-[var(--color-ink)] text-white"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
              }`}
            >
              {t === "all" ? "All" : t === "skill" ? "Skills" : "Extensions"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          Category
          <select
            value={categoryFilter}
            onChange={(e) => {
              setPage(1)
              setCategoryFilter(e.target.value)
            }}
            className="rounded-md border border-[var(--color-border)] px-2 py-1.5 bg-white max-w-[200px]"
          >
            <option value="">All</option>
            {(categoriesQuery.data?.items ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={PACKAGE_CATEGORY_UNCATEGORIZED}>
              {DISPLAY_UNCATEGORIZED}
            </option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          Sort
          <select
            value={sort}
            onChange={(e) =>
              setSort(e.target.value as "downloads" | "newest")
            }
            className="rounded-md border border-[var(--color-border)] px-2 py-1.5 bg-white"
          >
            <option value="downloads">Popular</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{(error as Error).message}</p>
      ) : !data?.items.length ? (
        <p className="text-[var(--color-muted)]">No packages found.</p>
      ) : (
        <>
          <div className="space-y-10">
            {grouped.map(([label, items]) => (
              <section key={label}>
                <h2 className="text-sm font-medium text-[var(--color-muted)] mb-4">
                  {label}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => (
                    <PackageCard key={p.id} p={p} />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {data.meta.totalPages > 1 ? (
            <div className="flex justify-center gap-2 mt-10">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-4 py-2 rounded-md border border-[var(--color-border)] disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-sm text-[var(--color-muted)]">
                Page {page} / {data.meta.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= data.meta.totalPages}
                onClick={() =>
                  setPage((p) =>
                    Math.min(data.meta.totalPages, p + 1),
                  )
                }
                className="px-4 py-2 rounded-md border border-[var(--color-border)] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
