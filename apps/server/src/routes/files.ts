import { Hono } from "hono"
import fs from "node:fs/promises"
import path from "node:path"
import type { Env } from "../lib/env.js"
import { notFound } from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"

export function createFilesRoutes(env: Env) {
  const app = new Hono()
  const root = path.resolve(env.STORAGE_LOCAL_DIR)

  app.get("/*", async (c) => {
    const pathname = new URL(c.req.url).pathname
    const sub = pathname.replace(/^\/files\/?/, "")
    if (!sub || !sub.endsWith(".zip")) {
      return notFound(c, ErrorCodes.NOT_FOUND, "Not found")
    }
    const full = path.join(root, sub)
    const resolvedRoot = path.resolve(root)
    if (!full.startsWith(resolvedRoot + path.sep) && full !== resolvedRoot) {
      return notFound(c, ErrorCodes.NOT_FOUND, "Not found")
    }
    let buf: Buffer
    try {
      buf = await fs.readFile(full)
    } catch {
      return notFound(c, ErrorCodes.NOT_FOUND, "Not found")
    }
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${path.basename(full)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    })
  })

  return app
}
