import { Hono } from "hono"
import type { AuthVariables } from "../middleware/auth.js"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import type { LocalStorageAdapter } from "../storage/local.adapter.js"
import { badRequest, conflict, notFound } from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"
import { categoryFromManifestJson } from "../lib/category.js"

type ApproveOneResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" }

async function approvePendingVersion(
  db: Db,
  versionId: string,
  reviewerId: string,
): Promise<ApproveOneResult> {
  const ver = await db.query.packageVersions.findFirst({
    where: eq(tables.packageVersions.id, versionId),
  })
  if (!ver) {
    return { ok: false, reason: "not_found" }
  }
  if (ver.status !== "pending") {
    return { ok: false, reason: "not_pending" }
  }
  const now = Math.floor(Date.now() / 1000)
  const publishedCategory = categoryFromManifestJson(ver.manifest)
  await db
    .update(tables.packageVersions)
    .set({
      status: "published",
      publishedAt: now,
      rejectReason: null,
    })
    .where(eq(tables.packageVersions.id, versionId))
  await db
    .update(tables.packages)
    .set({
      status: "published",
      latestVersionId: versionId,
      category: publishedCategory,
      updatedAt: now,
    })
    .where(eq(tables.packages.id, ver.packageId))
  await db.insert(tables.reviewLogs).values({
    id: nanoid(),
    versionId,
    reviewerId,
    action: "approve",
    reason: null,
    createdAt: now,
  })
  return { ok: true }
}

export function createAdminRoutes(db: Db, storage: LocalStorageAdapter) {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.get("/users", async (c) => {
    const rows = await db
      .select({
        id: tables.users.id,
        username: tables.users.username,
        avatarUrl: tables.users.avatarUrl,
        role: tables.users.role,
        createdAt: tables.users.createdAt,
      })
      .from(tables.users)
      .orderBy(desc(tables.users.createdAt))
    return c.json({ items: rows })
  })

  app.patch("/users/:userId", async (c) => {
    const targetId = c.req.param("userId")
    let body: { role?: string }
    try {
      body = (await c.req.json()) as { role?: string }
    } catch {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "Invalid JSON body")
    }
    if (body.role !== "user" && body.role !== "admin") {
      return badRequest(
        c,
        ErrorCodes.VALIDATION_ERROR,
        "role must be user or admin",
      )
    }
    const target = await db.query.users.findFirst({
      where: eq(tables.users.id, targetId),
    })
    if (!target) {
      return notFound(c, ErrorCodes.NOT_FOUND, "User not found")
    }
    if (target.role === body.role) {
      return c.json({
        ok: true,
        user: {
          id: target.id,
          username: target.username,
          avatarUrl: target.avatarUrl,
          role: target.role,
          createdAt: target.createdAt,
        },
      })
    }
    if (target.role === "admin" && body.role === "user") {
      const adminCountRows = await db
        .select({ n: sql<number>`count(*)` })
        .from(tables.users)
        .where(eq(tables.users.role, "admin"))
      const adminCount = Number(adminCountRows[0]?.n ?? 0)
      if (adminCount <= 1) {
        return conflict(c, "Cannot remove the last admin")
      }
    }
    await db
      .update(tables.users)
      .set({ role: body.role })
      .where(eq(tables.users.id, targetId))
    const updated = await db.query.users.findFirst({
      where: eq(tables.users.id, targetId),
    })
    if (!updated) {
      return notFound(c, ErrorCodes.NOT_FOUND, "User not found")
    }
    return c.json({
      ok: true,
      user: {
        id: updated.id,
        username: updated.username,
        avatarUrl: updated.avatarUrl,
        role: updated.role,
        createdAt: updated.createdAt,
      },
    })
  })

  app.get("/reviews", async (c) => {
    const rows = await db
      .select({
        pkg: tables.packages,
        ver: tables.packageVersions,
        author: {
          username: tables.users.username,
          avatarUrl: tables.users.avatarUrl,
        },
      })
      .from(tables.packageVersions)
      .innerJoin(
        tables.packages,
        eq(tables.packageVersions.packageId, tables.packages.id),
      )
      .innerJoin(tables.users, eq(tables.packages.authorId, tables.users.id))
      .where(eq(tables.packageVersions.status, "pending"))
      .orderBy(desc(tables.packageVersions.createdAt))

    const items = rows.map((r) => {
      let manifest: unknown = {}
      try {
        manifest = JSON.parse(r.ver.manifest)
      } catch {
        /* ignore */
      }
      return {
        packageId: r.pkg.id,
        packageName: r.pkg.name,
        type: r.pkg.type,
        versionId: r.ver.id,
        version: r.ver.version,
        fileSize: r.ver.fileSize,
        manifest,
        readme: r.pkg.readme,
        status: r.ver.status,
        author: {
          username: r.author.username,
          avatarUrl: r.author.avatarUrl,
        },
        createdAt: r.ver.createdAt,
      }
    })

    return c.json({ items })
  })

  app.post("/reviews/approve-all-skills", async (c) => {
    const reviewerId = c.get("userId") as string
    const pending = await db
      .select({ versionId: tables.packageVersions.id })
      .from(tables.packageVersions)
      .innerJoin(
        tables.packages,
        eq(tables.packageVersions.packageId, tables.packages.id),
      )
      .where(
        and(
          eq(tables.packageVersions.status, "pending"),
          eq(tables.packages.type, "skill"),
        ),
      )
      .orderBy(asc(tables.packageVersions.createdAt))

    const versionIds: string[] = []
    for (const row of pending) {
      const r = await approvePendingVersion(db, row.versionId, reviewerId)
      if (r.ok === true) {
        versionIds.push(row.versionId)
      }
    }

    return c.json({
      ok: true,
      approved: versionIds.length,
      versionIds,
    })
  })

  app.post("/versions/:versionId/approve", async (c) => {
    const reviewerId = c.get("userId") as string
    const versionId = c.req.param("versionId")
    const r = await approvePendingVersion(db, versionId, reviewerId)
    if (r.ok === false && r.reason === "not_found") {
      return notFound(c, ErrorCodes.VERSION_NOT_FOUND, "Version not found")
    }
    if (r.ok === false && r.reason === "not_pending") {
      return badRequest(
        c,
        ErrorCodes.VALIDATION_ERROR,
        "Version is not pending review",
      )
    }
    return c.json({ ok: true })
  })

  app.post("/versions/:versionId/reject", async (c) => {
    const reviewerId = c.get("userId") as string
    const versionId = c.req.param("versionId")
    let body: { reason?: string }
    try {
      body = (await c.req.json()) as { reason?: string }
    } catch {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "Invalid JSON body")
    }
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "reason is required")
    }
    const reason = body.reason.trim()
    const ver = await db.query.packageVersions.findFirst({
      where: eq(tables.packageVersions.id, versionId),
    })
    if (!ver) {
      return notFound(c, ErrorCodes.VERSION_NOT_FOUND, "Version not found")
    }
    if (ver.status !== "pending") {
      return badRequest(
        c,
        ErrorCodes.VALIDATION_ERROR,
        "Version is not pending review",
      )
    }
    const now = Math.floor(Date.now() / 1000)
    await db
      .update(tables.packageVersions)
      .set({
        status: "rejected",
        rejectReason: reason,
      })
      .where(eq(tables.packageVersions.id, versionId))
    await db.insert(tables.reviewLogs).values({
      id: nanoid(),
      versionId,
      reviewerId,
      action: "reject",
      reason,
      createdAt: now,
    })
    return c.json({ ok: true })
  })

  app.get("/packages", async (c) => {
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
      .orderBy(desc(tables.packages.updatedAt))

    const items = rows.map((r) => ({
      id: r.pkg.id,
      name: r.pkg.name,
      type: r.pkg.type,
      category: r.pkg.category,
      description: r.pkg.description,
      status: r.pkg.status,
      downloads: r.pkg.downloads,
      author: {
        username: r.author.username,
        avatarUrl: r.author.avatarUrl,
      },
      latestVersion: r.latestVer ?? undefined,
      updatedAt: r.pkg.updatedAt,
      createdAt: r.pkg.createdAt,
    }))

    return c.json({ items })
  })

  app.delete("/packages/:name", async (c) => {
    const name = c.req.param("name")
    const pkg = await db.query.packages.findFirst({
      where: eq(tables.packages.name, name),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }

    // Delete all version files
    const versions = await db
      .select({ fileKey: tables.packageVersions.fileKey })
      .from(tables.packageVersions)
      .where(eq(tables.packageVersions.packageId, pkg.id))

    for (const v of versions) {
      if (v.fileKey) {
        await storage.delete(v.fileKey).catch(() => {})
      }
    }

    // Delete from database (cascade should handle versions and review logs)
    await db.delete(tables.packages).where(eq(tables.packages.id, pkg.id))

    return c.json({ ok: true })
  })

  app.delete("/versions/:versionId", async (c) => {
    const versionId = c.req.param("versionId")
    const ver = await db.query.packageVersions.findFirst({
      where: eq(tables.packageVersions.id, versionId),
    })
    if (!ver) {
      return notFound(c, ErrorCodes.VERSION_NOT_FOUND, "Version not found")
    }

    // Delete the version file
    if (ver.fileKey) {
      await storage.delete(ver.fileKey).catch(() => {})
    }

    // If this version is the latest, update the package
    const pkg = await db.query.packages.findFirst({
      where: eq(tables.packages.id, ver.packageId),
    })
    if (pkg && pkg.latestVersionId === versionId) {
      // Find the next latest published version, or the next pending version
      const remaining = await db
        .select()
        .from(tables.packageVersions)
        .where(
          and(
            eq(tables.packageVersions.packageId, pkg.id),
            sql`${tables.packageVersions.id} != ${versionId}`,
          ),
        )
        .orderBy(desc(tables.packageVersions.publishedAt))
        .limit(1)

      const newLatestId = remaining[0]?.id ?? null
      const newStatus = newLatestId
        ? remaining[0]?.status === "published"
          ? "published"
          : "pending"
        : "pending"

      await db
        .update(tables.packages)
        .set({
          latestVersionId: newLatestId,
          status: newStatus,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(tables.packages.id, pkg.id))
    }

    // Delete the version from database
    await db.delete(tables.packageVersions).where(eq(tables.packageVersions.id, versionId))

    return c.json({ ok: true })
  })

  return app
}
