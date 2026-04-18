import { createMiddleware } from "hono/factory"
import { eq } from "drizzle-orm"
import { jwtVerify } from "jose"
import type { UserRole } from "@xopc-store/shared"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import { unauthorized } from "../lib/errors.js"

export type AuthVariables = {
  userId: string
  role: UserRole
}

/** JWT 只用于识别用户；role 以数据库为准，便于升降级后立即生效而无需重新登录 */
export function authMiddleware(db: Db, secret: Uint8Array) {
  return createMiddleware<{
    Variables: AuthVariables
  }>(async (c, next) => {
    const header = c.req.header("Authorization")
    let token: string | undefined
    if (header?.startsWith("Bearer ")) {
      token = header.slice(7)
    }
    if (!token) {
      const cookie = c.req.header("Cookie")
      const match = cookie?.match(/(?:^|;\s*)token=([^;]+)/)
      if (match) token = decodeURIComponent(match[1])
    }
    if (!token) {
      return unauthorized(c)
    }
    try {
      const { payload } = await jwtVerify(token, secret)
      const userId = payload.userId as string | undefined
      if (!userId) {
        return unauthorized(c)
      }
      const row = await db.query.users.findFirst({
        where: eq(tables.users.id, userId),
      })
      if (!row) {
        return unauthorized(c)
      }
      const role = row.role as UserRole
      if (role !== "user" && role !== "admin") {
        return unauthorized(c)
      }
      c.set("userId", userId)
      c.set("role", role)
    } catch {
      return unauthorized(c)
    }
    await next()
  })
}

export function optionalAuthMiddleware(secret: Uint8Array) {
  return createMiddleware<{
    Variables: Partial<AuthVariables>
  }>(async (c, next) => {
    const header = c.req.header("Authorization")
    let token: string | undefined
    if (header?.startsWith("Bearer ")) {
      token = header.slice(7)
    }
    if (!token) {
      const cookie = c.req.header("Cookie")
      const match = cookie?.match(/(?:^|;\s*)token=([^;]+)/)
      if (match) token = decodeURIComponent(match[1])
    }
    if (!token) {
      await next()
      return
    }
    try {
      const { payload } = await jwtVerify(token, secret)
      const userId = payload.userId as string | undefined
      const role = payload.role as UserRole | undefined
      if (userId && (role === "user" || role === "admin")) {
        c.set("userId", userId)
        c.set("role", role)
      }
    } catch {
      // ignore invalid token
    }
    await next()
  })
}

export function requireAdmin() {
  return createMiddleware<{
    Variables: AuthVariables
  }>(async (c, next) => {
    if (c.get("role") !== "admin") {
      return unauthorized(c, "Admin role required")
    }
    await next()
  })
}
