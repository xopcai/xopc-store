import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import {
  fetchPackageDetail,
  fetchPackageVersions,
} from "@/lib/api"

export function PackageDetailPage() {
  const { name } = useParams({ strict: false }) as { name: string }
  const [copied, setCopied] = useState(false)

  const detailQuery = useQuery({
    queryKey: ["package", name],
    queryFn: () => fetchPackageDetail(name),
  })

  const versionsQuery = useQuery({
    queryKey: ["package-versions", name],
    queryFn: () => fetchPackageVersions(name),
  })

  if (detailQuery.isLoading) {
    return <p className="text-[var(--color-muted)]">Loading…</p>
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <p className="text-red-600">
        {(detailQuery.error as Error)?.message ?? "Not found"}
      </p>
    )
  }

  const d = detailQuery.data as {
    name: string
    type: string
    category: string | null
    description: string
    readme: string | null
    downloads: number
    author: { username: string; avatarUrl: string | null }
    latestVersion: {
      version: string
      downloadUrl: string
      fileSize: number
      publishedAt: number | null
    } | null
    updatedAt: number
  }

  const installCmd =
    d.type === "skill"
      ? `xopc skills install ${name}`
      : `xopc extension install ${name}`

  const copy = async () => {
    await navigator.clipboard.writeText(installCmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const versionsData = versionsQuery.data as
    | {
        items: {
          version: string
          publishedAt: number | null
          downloadUrl?: string
        }[]
      }
    | undefined

  return (
    <div>
      <Link
        to="/"
        className="text-sm text-[var(--color-accent)] hover:underline mb-6 inline-block"
      >
        ← Back to Store
      </Link>
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm mb-8">
        <h2 className="text-sm font-medium text-[var(--color-muted)] mb-3">
          Install
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <code className="flex-1 text-sm bg-[var(--color-surface)] rounded-lg px-3 py-2 font-mono break-all">
            {installCmd}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium sm:self-auto"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="flex flex-wrap items-start gap-2 mb-4">
            <h1 className="text-3xl font-semibold">{d.name}</h1>
            <span
              className={`text-xs uppercase tracking-wide px-2 py-1 rounded mt-1 ${
                d.type === "skill"
                  ? "bg-blue-50 text-[var(--color-skill)]"
                  : "bg-purple-50 text-[var(--color-extension)]"
              }`}
            >
              {d.type === "skill" ? "Skill" : "Extension"}
            </span>
            {d.category ? (
              <span className="text-xs px-2 py-1 rounded mt-1 bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)]">
                {d.category}
              </span>
            ) : null}
          </div>
          <p className="text-[var(--color-muted)] mb-2">{d.description}</p>
          <p className="text-sm text-[var(--color-muted)] mb-8">
            by @{d.author.username}
          </p>
          <div
            className="prose prose-slate prose-sm max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none [&_pre]:rounded-lg [&_pre]:overflow-hidden"
          >
            {d.readme ? (
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                {d.readme}
              </ReactMarkdown>
            ) : (
              <p className="text-[var(--color-muted)] italic">
                No README content.
              </p>
            )}
          </div>
          <h2 className="text-lg font-semibold mt-10 mb-3">Version history</h2>
          {versionsQuery.isLoading ? (
            <p className="text-sm text-[var(--color-muted)]">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {(versionsData?.items ?? []).map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 bg-white"
                >
                  <span className="font-mono">{v.version}</span>
                  <span className="text-[var(--color-muted)]">
                    {v.publishedAt
                      ? new Date(v.publishedAt * 1000).toLocaleDateString()
                      : "—"}
                  </span>
                  <a
                    href={`/api/v1/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(v.version)}/download`}
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="space-y-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-5 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Version</span>
              <span className="font-mono">{d.latestVersion?.version ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Category</span>
              <span>{d.category ?? "Uncategorized"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Updated</span>
              <span>
                {new Date(d.updatedAt * 1000).toLocaleDateString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Downloads</span>
              <span>{d.downloads.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-[var(--color-border)]">
              <span className="text-[var(--color-muted)]">Author</span>
              <span className="flex items-center gap-2">
                {d.author.avatarUrl ? (
                  <img
                    src={d.author.avatarUrl}
                    alt=""
                    className="w-6 h-6 rounded-full"
                  />
                ) : null}
                @{d.author.username}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
