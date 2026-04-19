import { Hono } from "hono"
import type { AuthVariables } from "../middleware/auth.js"
import { desc, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import { badRequest, conflict, notFound } from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"

export function createAdminRoutes(db: Db) {
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

  app.post("/versions/:versionId/approve", async (c) => {
    const reviewerId = c.get("userId") as string
    const versionId = c.req.param("versionId")
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

  return app
}
