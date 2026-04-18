import type { Context } from "hono"
import { ErrorCodes } from "@xopc-store/shared"

type ErrStatus = 400 | 401 | 403 | 404 | 409 | 500

export function jsonError(
  c: Context,
  status: ErrStatus,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

export function badRequest(c: Context, code: string, message: string) {
  return jsonError(c, 400, code, message)
}

export function unauthorized(c: Context, message = "Unauthorized") {
  return jsonError(c, 401, ErrorCodes.UNAUTHORIZED, message)
}

export function forbidden(c: Context, message = "Forbidden") {
  return jsonError(c, 403, ErrorCodes.FORBIDDEN, message)
}

export function notFound(c: Context, code: string, message: string) {
  return jsonError(c, 404, code, message)
}

export function conflict(c: Context, message: string) {
  return jsonError(c, 409, ErrorCodes.CONFLICT, message)
}
