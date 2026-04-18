import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema.js"
import path from "node:path"
import fs from "node:fs"

export type Db = ReturnType<typeof createDb>

export function createDb(databaseUrl: string) {
  const resolved =
    databaseUrl.startsWith("file:") || databaseUrl.includes("://")
      ? databaseUrl.replace(/^file:/, "")
      : path.resolve(process.cwd(), databaseUrl)
  if (!databaseUrl.includes("memory")) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
  }
  const sqlite = new Database(resolved)
  sqlite.pragma("journal_mode = WAL")
  return drizzle(sqlite, { schema })
}

export { schema }
