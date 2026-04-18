import { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { Db } from "../db/index.js"
import * as tables from "../db/schema.js"
import type { Env } from "../lib/env.js"
import { signUserJwt } from "../lib/jwt.js"
import { badRequest, jsonError } from "../lib/errors.js"
import { ErrorCodes } from "@xopc-store/shared"
import { SignJWT, jwtVerify } from "jose"

export function createAuthRoutes(
  db: Db,
  env: Env,
  jwtSecret: Uint8Array,
) {
  const app = new Hono()

  app.get("/github", async (c) => {
    const mode = c.req.query("mode") === "cli" ? "cli" : "web"
    const stateToken = await new SignJWT({ mode })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(jwtSecret)
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: env.GITHUB_CALLBACK_URL,
      scope: "read:user user:email",
      state: stateToken,
    })
    const url = `https://github.com/login/oauth/authorize?${params}`
    return c.redirect(url)
  })

  app.get("/github/callback", async (c) => {
    const code = c.req.query("code")
    const state = c.req.query("state")
    if (!code || !state) {
      return badRequest(c, ErrorCodes.OAUTH_FAILED, "Missing code or state")
    }
    let mode: "web" | "cli" = "web"
    try {
      const { payload } = await jwtVerify(state, jwtSecret)
      mode = payload.mode === "cli" ? "cli" : "web"
    } catch {
      return badRequest(c, ErrorCodes.OAUTH_FAILED, "Invalid state")
    }

    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    )
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      error?: string
    }
    if (!tokenJson.access_token) {
      return jsonError(
        c,
        400,
        ErrorCodes.OAUTH_FAILED,
        tokenJson.error ?? "Failed to exchange code",
      )
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
      },
    })
    if (!userRes.ok) {
      return jsonError(c, 400, ErrorCodes.OAUTH_FAILED, "GitHub user fetch failed")
    }
    const gh = (await userRes.json()) as {
      id: number
      login: string
      avatar_url?: string
      email?: string | null
    }

    const now = Math.floor(Date.now() / 1000)
    const existing = await db.query.users.findFirst({
      where: eq(tables.users.githubId, gh.id),
    })
    let userId: string
    if (existing) {
      userId = existing.id
      await db
        .update(tables.users)
        .set({
          username: gh.login,
          avatarUrl: gh.avatar_url ?? null,
          email: gh.email ?? existing.email,
        })
        .where(eq(tables.users.id, userId))
    } else {
      userId = nanoid()
      await db.insert(tables.users).values({
        id: userId,
        githubId: gh.id,
        username: gh.login,
        avatarUrl: gh.avatar_url ?? null,
        email: gh.email ?? null,
        role: "user",
        createdAt: now,
      })
    }

    const row = await db.query.users.findFirst({
      where: eq(tables.users.id, userId),
    })
    if (!row) {
      return jsonError(c, 500, ErrorCodes.INTERNAL, "User persist failed")
    }

    const jwt = await signUserJwt(env, jwtSecret, row.id, row.role)

    const redirectBase = env.FRONTEND_URL.replace(/\/$/, "")
    if (mode === "cli") {
      const target = `${redirectBase}/auth/token`
      setCookie(c, "token", jwt, {
        path: "/",
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 60 * 60 * 24 * 7,
      })
      return c.redirect(`${target}?done=1`)
    }

    setCookie(c, "token", jwt, {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7,
    })
    return c.redirect(`${redirectBase}/auth/callback`)
  })

  app.get("/me", async (c) => {
    const header = c.req.header("Authorization")
    let token: string | undefined
    if (header?.startsWith("Bearer ")) {
      token = header.slice(7)
    }
    if (!token) {
      token = getCookie(c, "token")
    }
    if (!token) {
      return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, "Not logged in")
    }
    let userId: string
    try {
      const { payload } = await jwtVerify(token, jwtSecret)
      userId = payload.userId as string
    } catch {
      return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, "Invalid token")
    }
    const row = await db.query.users.findFirst({
      where: eq(tables.users.id, userId),
    })
    if (!row) {
      return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, "User not found")
    }
    return c.json({
      id: row.id,
      username: row.username,
      avatarUrl: row.avatarUrl,
      email: row.email,
      role: row.role,
    })
  })

  app.get("/token", async (c) => {
    const header = c.req.header("Authorization")
    let token: string | undefined
    if (header?.startsWith("Bearer ")) {
      token = header.slice(7)
    }
    if (!token) {
      token = getCookie(c, "token")
    }
    if (!token) {
      return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, "Not logged in")
    }
    try {
      await jwtVerify(token, jwtSecret)
    } catch {
      return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, "Invalid token")
    }
    return c.json({ token })
  })

  app.post("/logout", (c) => {
    setCookie(c, "token", "", {
      path: "/",
      maxAge: 0,
    })
    return c.json({ ok: true })
  })

  return app
}
