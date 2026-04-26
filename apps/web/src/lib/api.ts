import type {
  AdminReviewItem,
  AdminUserListItem,
  DeveloperPackageRow,
  PackageCategoriesResponse,
  PackageListResponse,
} from "@xopc-store/shared"

/** Use as `category` query param to list packages with no category. */
export const PACKAGE_CATEGORY_UNCATEGORIZED = "__uncategorized" as const

export type CurrentUser = {
  id: string
  username: string
  avatarUrl: string | null
  email: string | null
  role: "user" | "admin"
}

const json = async <T>(r: Response): Promise<T> => {
  const data = (await r.json()) as T & {
    error?: { code: string; message: string }
  }
  if (!r.ok && data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(data.error.message)
  }
  if (!r.ok) {
    throw new Error(r.statusText || "Request failed")
  }
  return data as T
}

export async function fetchPackages(params: {
  q?: string
  type?: "skill" | "extension"
  category?: string
  sort?: "downloads" | "newest"
  page?: number
  pageSize?: number
}): Promise<PackageListResponse> {
  const sp = new URLSearchParams()
  if (params.q) sp.set("q", params.q)
  if (params.type) sp.set("type", params.type)
  if (params.category) sp.set("category", params.category)
  if (params.sort) sp.set("sort", params.sort)
  if (params.page) sp.set("page", String(params.page))
  if (params.pageSize) sp.set("pageSize", String(params.pageSize))
  const r = await fetch(`/api/v1/packages?${sp}`, { credentials: "include" })
  return json<PackageListResponse>(r)
}

export async function fetchPackageCategories(): Promise<PackageCategoriesResponse> {
  const r = await fetch("/api/v1/packages/categories", { credentials: "include" })
  return json<PackageCategoriesResponse>(r)
}

export async function fetchPackageDetail(name: string) {
  const r = await fetch(`/api/v1/packages/${encodeURIComponent(name)}`, {
    credentials: "include",
  })
  return json(r)
}

export async function fetchPackageVersions(name: string) {
  const r = await fetch(
    `/api/v1/packages/${encodeURIComponent(name)}/versions`,
    { credentials: "include" },
  )
  return json(r)
}

export async function fetchMe() {
  const r = await fetch("/api/v1/auth/me", { credentials: "include" })
  if (r.status === 401) return null
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || r.statusText)
  }
  return (await r.json()) as CurrentUser
}

export async function logout() {
  await fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "include",
  })
}

export async function fetchDeveloperPackages() {
  const r = await fetch("/api/v1/developer/packages", {
    credentials: "include",
  })
  return json<{ items: DeveloperPackageRow[] }>(r)
}

export async function fetchAdminReviews() {
  const r = await fetch("/api/v1/admin/reviews", { credentials: "include" })
  return json<{ items: AdminReviewItem[] }>(r)
}

export async function fetchAdminUsers() {
  const r = await fetch("/api/v1/admin/users", { credentials: "include" })
  return json<{ items: AdminUserListItem[] }>(r)
}

export async function updateAdminUserRole(
  userId: string,
  role: "user" | "admin",
) {
  const r = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  })
  return json<{ ok: boolean; user: AdminUserListItem }>(r)
}

export async function approveVersion(versionId: string) {
  const r = await fetch(`/api/v1/admin/versions/${versionId}/approve`, {
    method: "POST",
    credentials: "include",
  })
  return json(r)
}

export async function approveAllPendingSkills(): Promise<{
  ok: boolean
  approved: number
  versionIds: string[]
}> {
  const r = await fetch("/api/v1/admin/reviews/approve-all-skills", {
    method: "POST",
    credentials: "include",
  })
  return json(r)
}

export async function rejectVersion(versionId: string, reason: string) {
  const r = await fetch(`/api/v1/admin/versions/${versionId}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
  return json(r)
}

export interface AdminPackageItem {
  id: string
  name: string
  type: "skill" | "extension"
  category: string | null
  description: string
  status: "pending" | "published" | "rejected" | "unpublished"
  downloads: number
  author: { username: string; avatarUrl: string | null }
  latestVersion?: string
  updatedAt: number
  createdAt: number
}

export async function fetchAdminPackages(): Promise<{ items: AdminPackageItem[] }> {
  const r = await fetch("/api/v1/admin/packages", { credentials: "include" })
  return json<{ items: AdminPackageItem[] }>(r)
}

export async function deleteAdminPackage(name: string) {
  const r = await fetch(`/api/v1/admin/packages/${encodeURIComponent(name)}`, {
    method: "DELETE",
    credentials: "include",
  })
  return json(r)
}

export async function deleteAdminVersion(versionId: string) {
  const r = await fetch(`/api/v1/admin/versions/${versionId}`, {
    method: "DELETE",
    credentials: "include",
  })
  return json(r)
}
