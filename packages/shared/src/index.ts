/** Shared API types and error codes for xopc-store */

export type UserRole = "user" | "admin"

export type PackageType = "skill" | "extension"

export type PackageStatus = "pending" | "published" | "rejected" | "unpublished"

export type VersionStatus = "pending" | "published" | "rejected"

export type ReviewAction = "approve" | "reject"

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  PKG_NOT_FOUND: "PKG_NOT_FOUND",
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
  SCAN_FAILED: "SCAN_FAILED",
  OAUTH_FAILED: "OAUTH_FAILED",
  INTERNAL: "INTERNAL",
} as const

export type SortOrder = "downloads" | "newest"

export interface UserPublic {
  id: string
  username: string
  avatarUrl: string | null
  role: UserRole
}

export interface PackageVersionSummary {
  id: string
  version: string
  status: VersionStatus
  fileSize: number
  publishedAt: number | null
  createdAt: number
}

export interface PackageListItem {
  id: string
  name: string
  type: PackageType
  /** Current published category, or null = uncategorized */
  category: string | null
  description: string
  downloads: number
  author: Pick<UserPublic, "username" | "avatarUrl">
  latestVersion?: string
  updatedAt: number
}

export interface PackageDetail {
  id: string
  name: string
  type: PackageType
  category: string | null
  description: string
  readme: string | null
  status: PackageStatus
  downloads: number
  author: UserPublic
  latestVersion: {
    id: string
    version: string
    fileSize: number
    manifest: unknown
    changelog: string | null
    downloadUrl: string
    publishedAt: number | null
  } | null
  updatedAt: number
  createdAt: number
}

export interface VersionDetail {
  id: string
  version: string
  status: VersionStatus
  fileSize: number
  manifest: unknown
  changelog: string | null
  rejectReason: string | null
  publishedAt: number | null
  createdAt: number
  downloadUrl: string
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PackageListResponse {
  items: PackageListItem[]
  meta: PaginationMeta
}

export interface PackageCategoriesResponse {
  items: string[]
}

export interface DeveloperPackageRow {
  id: string
  name: string
  type: PackageType
  category: string | null
  description: string
  status: PackageStatus
  downloads: number
  latestVersion: string | null
  latestVersionStatus: VersionStatus | null
  rejectReason: string | null
  updatedAt: number
}

export interface AdminReviewItem {
  packageId: string
  packageName: string
  type: PackageType
  versionId: string
  version: string
  fileSize: number
  manifest: unknown
  readme: string | null
  status: VersionStatus
  author: Pick<UserPublic, "username" | "avatarUrl">
  createdAt: number
}

/** User row for admin account management (list + role updates). */
export interface AdminUserListItem extends UserPublic {
  createdAt: number
}

export interface StorageAdapter {
  upload(key: string, data: Uint8Array, mimeType: string): Promise<void>
  download(key: string): Promise<Uint8Array>
  getPublicUrl(key: string): string
  delete(key: string): Promise<void>
}
