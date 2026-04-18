import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  githubId: integer("github_id").notNull().unique(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  email: text("email"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at").notNull(),
})

export const packages = sqliteTable("packages", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type", { enum: ["skill", "extension"] }).notNull(),
  description: text("description").notNull(),
  readme: text("readme"),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  /** Set after version row exists; no FK to avoid circular refs */
  latestVersionId: text("latest_version_id"),
  status: text("status", {
    enum: ["pending", "published", "rejected", "unpublished"],
  })
    .notNull()
    .default("pending"),
  downloads: integer("downloads").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const packageVersions = sqliteTable(
  "package_versions",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    version: text("version").notNull(),
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    manifest: text("manifest").notNull(),
    changelog: text("changelog"),
    status: text("status", { enum: ["pending", "published", "rejected"] })
      .notNull()
      .default("pending"),
    rejectReason: text("reject_reason"),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("pkg_version_unique").on(t.packageId, t.version)],
)

export const reviewLogs = sqliteTable("review_logs", {
  id: text("id").primaryKey(),
  versionId: text("version_id")
    .notNull()
    .references(() => packageVersions.id),
  reviewerId: text("reviewer_id")
    .notNull()
    .references(() => users.id),
  action: text("action", { enum: ["approve", "reject"] }).notNull(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  packages: many(packages),
}))

export const packagesRelations = relations(packages, ({ one, many }) => ({
  author: one(users, {
    fields: [packages.authorId],
    references: [users.id],
  }),
  versions: many(packageVersions),
  latestVersion: one(packageVersions, {
    fields: [packages.latestVersionId],
    references: [packageVersions.id],
  }),
}))

export const packageVersionsRelations = relations(packageVersions, ({ one, many }) => ({
  package: one(packages, {
    fields: [packageVersions.packageId],
    references: [packages.id],
  }),
  reviewLogs: many(reviewLogs),
}))

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  version: one(packageVersions, {
    fields: [reviewLogs.versionId],
    references: [packageVersions.id],
  }),
  reviewer: one(users, {
    fields: [reviewLogs.reviewerId],
    references: [users.id],
  }),
}))
