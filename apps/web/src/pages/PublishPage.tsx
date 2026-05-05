import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { fetchMe, fetchPackageCategories, type CurrentUser } from "@/lib/api"

export function PublishPage() {
  const qc = useQueryClient()
  const categoryListId = useId()
  const me = useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: fetchMe,
  })
  const categoriesQuery = useQuery({
    queryKey: ["package-categories"],
    queryFn: fetchPackageCategories,
  })
  const [name, setName] = useState("")
  const [type, setType] = useState<"skill" | "extension">("skill")
  const [version, setVersion] = useState("1.0.0")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [changelog, setChangelog] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a zip file")
      if (!name.trim()) throw new Error("Package name is required")
      const fd = new FormData()
      fd.append("file", file)
      fd.append("type", type)
      fd.append("version", version.trim())
      if (changelog.trim()) fd.append("changelog", changelog.trim())
      if (description.trim()) fd.append("description", description.trim())
      if (category.trim()) fd.append("category", category.trim())
      const r = await fetch(
        `/api/v1/developer/packages/${encodeURIComponent(name.trim())}/versions`,
        {
          method: "POST",
          body: fd,
          credentials: "include",
        },
      )
      const j = (await r.json()) as { error?: { message: string } }
      if (!r.ok) {
        throw new Error(j.error?.message ?? r.statusText)
      }
      return j
    },
    onSuccess: async () => {
      setMsg("Submitted for review. Status: pending.")
      await qc.invalidateQueries({ queryKey: ["developer-packages"] })
    },
    onError: (e: Error) => {
      setMsg(e.message)
    },
  })

  if (!me.data) {
    return (
      <p className="text-[var(--color-muted)]">
        Please sign in to publish packages.
      </p>
    )
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Publish version</h1>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setMsg(null)
          publish.mutate()
        }}
      >
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">Package name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="weather"
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">Type</span>
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as "skill" | "extension")
            }
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="skill">Skill</option>
            <option value="extension">Extension</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">Version (semver)</span>
          <input
            required
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">
            Description (required for new package)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">
            Category (optional, max 64 chars; overrides manifest when set)
          </span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list={categoryListId}
            maxLength={64}
            placeholder="e.g. productivity"
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <datalist id={categoryListId}>
            {(categoriesQuery.data?.items ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">Changelog (optional)</span>
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)]">Zip archive</span>
          <input
            required
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </label>
        {msg ? (
          <p
            className={
              msg.startsWith("Submitted")
                ? "text-emerald-600 text-sm"
                : "text-red-600 text-sm"
            }
          >
            {msg}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={publish.isPending}
          className="px-5 py-2.5 rounded-lg bg-[var(--color-accent)] text-white font-medium disabled:opacity-60"
        >
          {publish.isPending ? "Uploading…" : "Submit"}
        </button>
      </form>
    </div>
  )
}
