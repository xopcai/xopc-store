import { Hono } from "hono"
import type { AuthVariables } from "../middleware/auth.js"
import { and, desc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import type { LocalStorageAdapter } from "../storage/local.adapter.js"
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"
import type { PackageType } from "@xopc-store/shared"
import {
  assertValidSemver,
  isValidPackageName,
  scanZipPackage,
} from "../services/scan.js"

export function createDeveloperRoutes(
  db: Db,
  storage: LocalStorageAdapter,
) {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.get("/packages", async (c) => {
    const userId = c.get("userId") as string
    const rows = await db
      .select({
        pkg: tables.packages,
        latest: tables.packageVersions,
      })
      .from(tables.packages)
      .leftJoin(
        tables.packageVersions,
        eq(tables.packages.latestVersionId, tables.packageVersions.id),
      )
      .where(eq(tables.packages.authorId, userId))
      .orderBy(desc(tables.packages.updatedAt))

    const items = await Promise.all(
      rows.map(async (r) => {
        let rejectReason: string | null = null
        if (r.latest?.status === "rejected") {
          rejectReason = r.latest.rejectReason ?? null
        }
        return {
          id: r.pkg.id,
          name: r.pkg.name,
          type: r.pkg.type,
          description: r.pkg.description,
          status: r.pkg.status,
          downloads: r.pkg.downloads,
          latestVersion: r.latest?.version ?? null,
          latestVersionStatus: r.latest?.status ?? null,
          rejectReason,
          updatedAt: r.pkg.updatedAt,
        }
      }),
    )

    return c.json({ items })
  })

  app.patch("/packages/:name", async (c) => {
    const userId = c.get("userId") as string
    const name = c.req.param("name")
    const pkg = await db.query.packages.findFirst({
      where: eq(tables.packages.name, name),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    if (pkg.authorId !== userId && c.get("role") !== "admin") {
      return forbidden(c, "Not the package owner")
    }
    let body: { description?: string }
    try {
      body = (await c.req.json()) as { description?: string }
    } catch {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "Invalid JSON body")
    }
    if (typeof body.description !== "string" || !body.description.trim()) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "description is required")
    }
    const now = Math.floor(Date.now() / 1000)
    await db
      .update(tables.packages)
      .set({ description: body.description.trim(), updatedAt: now })
      .where(eq(tables.packages.id, pkg.id))
    return c.json({ ok: true })
  })

  app.post("/packages/:name/unpublish", async (c) => {
    const userId = c.get("userId") as string
    const name = c.req.param("name")
    const pkg = await db.query.packages.findFirst({
      where: eq(tables.packages.name, name),
    })
    if (!pkg) {
      return notFound(c, ErrorCodes.PKG_NOT_FOUND, "Package not found")
    }
    if (pkg.authorId !== userId && c.get("role") !== "admin") {
      return forbidden(c, "Not the package owner")
    }
    const now = Math.floor(Date.now() / 1000)
    await db
      .update(tables.packages)
      .set({ status: "unpublished", updatedAt: now })
      .where(eq(tables.packages.id, pkg.id))
    return c.json({ ok: true })
  })

  app.post("/packages/:name/versions", async (c) => {
    const userId = c.get("userId") as string
    const name = c.req.param("name")
    if (!isValidPackageName(name)) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "Invalid package name")
    }

    const body = await c.req.parseBody({ all: true })
    const file = body.file
    const typeRaw = body.type
    const versionRaw = body.version
    const changelogRaw = body.changelog
    const descriptionRaw = body.description

    if (!(file instanceof File) && !(file && typeof file === "object" && "arrayBuffer" in file)) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "file is required")
    }
    const buf = Buffer.from(await (file as File).arrayBuffer())

    const type =
      typeRaw === "skill" || typeRaw === "extension"
        ? (typeRaw as PackageType)
        : null
    if (!type) {
      return badRequest(
        c,
        ErrorCodes.VALIDATION_ERROR,
        "type must be skill or extension",
      )
    }
    if (typeof versionRaw !== "string" || !versionRaw.trim()) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, "version is required")
    }
    const semverErr = assertValidSemver(versionRaw.trim())
    if (semverErr) {
      return badRequest(c, ErrorCodes.VALIDATION_ERROR, semverErr)
    }
    const version = versionRaw.trim()

    const scan = scanZipPackage(buf, name, type)
    if (!scan.ok) {
      return badRequest(c, ErrorCodes.SCAN_FAILED, scan.message)
    }

    const existing = await db.query.packages.findFirst({
      where: eq(tables.packages.name, name),
    })

    if (existing) {
      if (existing.authorId !== userId && c.get("role") !== "admin") {
        return forbidden(c, "Package name already taken by another user")
      }
      if (existing.type !== type) {
        return badRequest(
          c,
          ErrorCodes.VALIDATION_ERROR,
          "Package type does not match existing package",
        )
      }
    } else {
      const desc =
        typeof descriptionRaw === "string" && descriptionRaw.trim()
          ? descriptionRaw.trim()
          : typeof scan.data.manifest.description === "string"
            ? scan.data.manifest.description
            : ""
      if (!desc) {
        return badRequest(
          c,
          ErrorCodes.VALIDATION_ERROR,
          "description is required for new package",
        )
      }
    }

    if (existing) {
      const dup = await db.query.packageVersions.findFirst({
        where: and(
          eq(tables.packageVersions.packageId, existing.id),
          eq(tables.packageVersions.version, version),
        ),
      })
      if (dup) {
        return conflict(c, "This version already exists")
      }
    }

    const fileKey = `packages/${name}/${version}/${name}-${version}.zip`
    const now = Math.floor(Date.now() / 1000)
    const manifestStr = JSON.stringify(scan.data.manifest)

    await storage.upload(fileKey, buf, "application/zip")

    const versionId = nanoid()
    const changelog =
      typeof changelogRaw === "string" && changelogRaw.trim()
        ? changelogRaw.trim()
        : null

    if (!existing) {
      const desc =
        typeof descriptionRaw === "string" && descriptionRaw.trim()
          ? descriptionRaw.trim()
          : (scan.data.manifest.description as string)
      const pkgId = nanoid()
      await db.insert(tables.packages).values({
        id: pkgId,
        name,
        type,
        description: desc,
        readme: scan.data.readme,
        authorId: userId,
        latestVersionId: null,
        status: "pending",
        downloads: 0,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(tables.packageVersions).values({
        id: versionId,
        packageId: pkgId,
        version,
        fileKey,
        fileSize: buf.length,
        manifest: manifestStr,
        changelog,
        status: "pending",
        rejectReason: null,
        publishedAt: null,
        createdAt: now,
      })
      await db
        .update(tables.packages)
        .set({ latestVersionId: versionId, updatedAt: now })
        .where(eq(tables.packages.id, pkgId))
    } else {
      await db
        .update(tables.packages)
        .set({
          readme: scan.data.readme,
          updatedAt: now,
        })
        .where(eq(tables.packages.id, existing.id))
      await db.insert(tables.packageVersions).values({
        id: versionId,
        packageId: existing.id,
        version,
        fileKey,
        fileSize: buf.length,
        manifest: manifestStr,
        changelog,
        status: "pending",
        rejectReason: null,
        publishedAt: null,
        createdAt: now,
      })
      await db
        .update(tables.packages)
        .set({ latestVersionId: versionId, updatedAt: now })
        .where(eq(tables.packages.id, existing.id))
    }

    return c.json({
      ok: true,
      versionId,
      status: "pending",
    })
  })

  return app
}
