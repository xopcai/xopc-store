import { SignJWT } from "jose"
import type { UserRole } from "@xopc-store/shared"
import type { Env } from "./env.js"

export function jwtSecretBytes(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET)
}

function parseExpiresIn(expiresIn: string): number {
  const m = expiresIn.match(/^(\d+)([smhd])$/)
  if (!m) return 7 * 24 * 60 * 60
  const n = Number(m[1])
  const u = m[2]
  const mult =
    u === "s" ? 1 : u === "m" ? 60 : u === "h" ? 3600 : 24 * 3600
  return n * mult
}

export async function signUserJwt(
  env: Env,
  secret: Uint8Array,
  userId: string,
  role: UserRole,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + parseExpiresIn(env.JWT_EXPIRES_IN)
  return new SignJWT({ userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret)
}
