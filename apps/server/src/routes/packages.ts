import { Hono } from "hono"
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import type { LocalStorageAdapter } from "../storage/local.adapter.js"
import { notFound } from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"
import type { PackageType, SortOrder } from "@xopc-store/shared"

export function createPackageRoutes(db: Db, storage: LocalStorageAdapter) {
  const app = new Hono()

  const UNCATEGORIZED = "__uncategorized"

  app.get("/categories", async (c) => {
    const rows = await db
      .selectDistinct({ category: tables.packages.category })
      .from(tables.packages)
      .where(
        and(
          eq(tables.packages.status, "published"),
          isNotNull(tables.packages.category),
        ),
      )
      .orderBy(asc(tables.packages.category))
    const items = rows
      .map((r) => r.category)
      .filter((c): c is string => typeof c === "string" && c.length > 0)
    return c.json({ items })
  })

  app.get("/", async (c) => {
    const q = c.req.query("q")?.trim() ?? ""
    const type = c.req.query("type") as PackageType | undefined
    const sort = (c.req.query("sort") ?? "downloads") as SortOrder
    const categoryParam = c.req.query("category")?.trim() ?? ""
    const page = Math.max(1, Number(c.req.query("page")) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize")) || 20))
    const offset = (page - 1) * pageSize

    const conditions = [eq(tables.packages.status, "published")]
    if (type === "skill" || type === "extension") {
      conditions.push(eq(tables.packages.type, type))
    }
    if (categoryParam === UNCATEGORIZED) {
      conditions.push(isNull(tables.packages.category))
    } else if (categoryParam) {
      conditions.push(eq(tables.packages.category, categoryParam))
    }
    if (q) {
      const safe = q.replace(/[^a-z0-9\s-]/gi, "").trim()
      if (safe) {
        const pattern = `%${safe}%`
        conditions.push(
          or(
            like(tables.packages.name, pattern),
            like(tables.packages.description, pattern),
          )!,
        )
      }
    }

    const whereClause = and(...conditions)

    const countRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(tables.packages)
      .where(whereClause)
    const total = Number(countRows[0]?.n ?? 0)

    const nullsLast = sql`(CASE WHEN ${tables.packages.category} IS NULL THEN 1 ELSE 0 END)`
    const orderBy = [
      asc(nullsLast),
      asc(tables.packages.category),
      sort === "newest"
        ? desc(tables.packages.updatedAt)
        : desc(tables.packages.downloads),
    ]

    const rows = await db
      .select({
        pkg: tables.packages,
        author: {
          username: tables.users.username,
          avatarUrl: tables.users.avatarUrl,
        },
        latestVer: tables.packageVersions.version,
      })
      .from(tables.packages)
      .innerJoin(tables.users, eq(tables.packages.authorId, tables.users.id))
      .leftJoin(
        tables.packageVersions,
        eq(tables.packages.latestVersionId, tables.packageVersions.id),
      )
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset)

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return c.json({
      items: rows.map((r) => ({
        id: r.pkg.id,
        name: r.pkg.name,
        type: r.pkg.type,
        category: r.pkg.category,
        description: r.pkg.description,
        downloads: r.pkg.downloads,
        author: {
          username: r.author.username,
          avatarUrl: r.author.avatarUrl,
        },
        latestVersion: r.latestVer ?? undefined,
        updatedAt: r.pkg.updatedAt,
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    })
  })

  app.get("/:name", async (c) => {
    const name = c.req.param("name")
    const row = await db.query.packages.findFirst({
      where: and(
        eq(tables.packages.name, name),
        eq(tables.packages.status, "published"),
      ),
      with: {
        author: true,
        latestVersion: true,
      },
    })
    if (!row || !row.latestVersion) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    const lv = row.latestVersion
    const fileKey = lv.fileKey
    const downloadUrl = storage.getPublicUrl(fileKey)
    let manifest: unknown
    try {
      manifest = JSON.parse(lv.manifest)
    } catch {
      manifest = {}
    }
    return c.json({
      id: row.id,
      name: row.name,
      type: row.type,
      category: row.category,
      description: row.description,
      readme: row.readme,
      status: row.status,
      downloads: row.downloads,
      author: {
        id: row.author.id,
        username: row.author.username,
        avatarUrl: row.author.avatarUrl,
        role: row.author.role,
      },
      latestVersion: {
        id: lv.id,
        version: lv.version,
        fileSize: lv.fileSize,
        manifest,
        changelog: lv.changelog,
        downloadUrl,
        publishedAt: lv.publishedAt,
      },
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    })
  })

  app.get("/:name/versions", async (c) => {
    const name = c.req.param("name")
    const pkg = await db.query.packages.findFirst({
      where: and(
        eq(tables.packages.name, name),
        eq(tables.packages.status, "published"),
      ),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    const versions = await db
      .select()
      .from(tables.packageVersions)
      .where(
        and(
          eq(tables.packageVersions.packageId, pkg.id),
          eq(tables.packageVersions.status, "published"),
        ),
      )
      .orderBy(desc(tables.packageVersions.publishedAt))
    return c.json({
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        fileSize: v.fileSize,
        publishedAt: v.publishedAt,
        createdAt: v.createdAt,
      })),
    })
  })

  app.get("/:name/versions/:version", async (c) => {
    const name = c.req.param("name")
    const version = c.req.param("version")
    const pkg = await db.query.packages.findFirst({
      where: and(
        eq(tables.packages.name, name),
        eq(tables.packages.status, "published"),
      ),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    const v = await db.query.packageVersions.findFirst({
      where: and(
        eq(tables.packageVersions.packageId, pkg.id),
        eq(tables.packageVersions.version, version),
        eq(tables.packageVersions.status, "published"),
      ),
    })
    if (!v) {
      return notFound(
        c,
        ErrorCodes.VERSION_NOT_FOUND,
        "Version not found",
      )
    }
    let manifest: unknown
    try {
      manifest = JSON.parse(v.manifest)
    } catch {
      manifest = {}
    }
    return c.json({
      id: v.id,
      version: v.version,
      status: v.status,
      fileSize: v.fileSize,
      manifest,
      changelog: v.changelog,
      rejectReason: v.rejectReason,
      publishedAt: v.publishedAt,
      createdAt: v.createdAt,
      downloadUrl: storage.getPublicUrl(v.fileKey),
    })
  })

  app.get("/:name/versions/:version/download", async (c) => {
    const name = c.req.param("name")
    const version = c.req.param("version")
    const pkg = await db.query.packages.findFirst({
      where: and(
        eq(tables.packages.name, name),
        eq(tables.packages.status, "published"),
      ),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    const v = await db.query.packageVersions.findFirst({
      where: and(
        eq(tables.packageVersions.packageId, pkg.id),
        eq(tables.packageVersions.version, version),
        eq(tables.packageVersions.status, "published"),
      ),
    })
    if (!v) {
      return notFound(
        c,
        ErrorCodes.VERSION_NOT_FOUND,
        "Version not found",
      )
    }
    await db
      .update(tables.packages)
      .set({ downloads: sql`${tables.packages.downloads} + 1` })
      .where(eq(tables.packages.id, pkg.id))
    const url = storage.getPublicUrl(v.fileKey)
    return c.redirect(url, 302)
  })

  return app
}
