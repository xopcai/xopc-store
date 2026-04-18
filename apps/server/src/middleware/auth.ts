import { createMiddleware } from "hono/factory"
import { jwtVerify } from "jose"
import type { UserRole } from "@xopc-store/shared"
import { unauthorized } from "../lib/errors.js"

export type AuthVariables = {
  userId: string
  role: UserRole
}

export function authMiddleware(secret: Uint8Array) {
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
      const role = payload.role as UserRole | undefined
      if (!userId || (role !== "user" && role !== "admin")) {
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
