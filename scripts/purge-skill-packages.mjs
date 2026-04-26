#!/usr/bin/env node
/**
 * Remove ALL skill-type packages (and their versions, review rows, and local zip files)
 * from the xopc-store SQLite DB + STORAGE_LOCAL_DIR.
 *
 * Does NOT remove extension packages. Does NOT remove users.
 *
 * Usage (on the server; from repo root with server .env loaded):
 *   CONFIRM_PURGE=YES node scripts/purge-skill-packages.mjs
 *
 * Environment (same as apps/server):
 *   DATABASE_URL        default ./data/store.db (relative to cwd)
 *   STORAGE_LOCAL_DIR   default ./data/packages
 */
import { existsSync, unlinkSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")
const requireFromServer = createRequire(join(ROOT, "apps/server/package.json"))
requireFromServer("dotenv").config({ path: join(ROOT, "apps/server/.env") })
requireFromServer("dotenv").config({ path: join(ROOT, ".env") })

if (process.env.CONFIRM_PURGE !== "YES") {
  console.error(
    "Refusing: set CONFIRM_PURGE=YES to delete every skill package from DB and disk.",
  )
  process.exit(1)
}

const cwd = process.cwd()
const databaseUrl = process.env.DATABASE_URL || "./data/store.db"
const dbPath = databaseUrl.startsWith("file:")
  ? databaseUrl.slice("file:".length)
  : join(cwd, databaseUrl)
const storageDir = resolve(cwd, process.env.STORAGE_LOCAL_DIR || "./data/packages")

const Database = requireFromServer("better-sqlite3")

if (!existsSync(dbPath)) {
  console.error("Database not found:", dbPath)
  process.exit(1)
}

const db = new Database(dbPath)

const skillRows = db
  .prepare(`SELECT id, name FROM packages WHERE type = 'skill'`)
  .all()

if (skillRows.length === 0) {
  console.log("No skill packages in database. Nothing to do.")
  process.exit(0)
}

const skillPackageIds = skillRows.map((r) => r.id)
const skillNames = skillRows.map((r) => r.name)

const qVersions = db.prepare(
  `SELECT id, file_key FROM package_versions WHERE package_id = ?`,
)

const allFiles = []
const allVersionIds = []
for (const pkgId of skillPackageIds) {
  for (const v of qVersions.all(pkgId)) {
    allVersionIds.push(v.id)
    if (v.file_key) allFiles.push(v.file_key)
  }
}

const delVersionIds = db.prepare(
  `DELETE FROM review_logs WHERE version_id IN (${allVersionIds.map(() => "?").join(",")})`,
)
const delVersions = db.prepare(
  `DELETE FROM package_versions WHERE package_id IN (${skillPackageIds.map(() => "?").join(",")})`,
)

const tx = db.transaction(() => {
  db.prepare(`UPDATE packages SET latest_version_id = NULL WHERE type = 'skill'`).run()
  if (allVersionIds.length > 0) {
    delVersionIds.run(...allVersionIds)
  }
  delVersions.run(...skillPackageIds)
  db.prepare(`DELETE FROM packages WHERE type = 'skill'`).run()
})

tx()

let removed = 0
let missing = 0
for (const key of allFiles) {
  const p = join(storageDir, key)
  if (existsSync(p)) {
    try {
      unlinkSync(p)
      removed += 1
    } catch (e) {
      console.error("Could not remove file", p, e)
    }
  } else {
    missing += 1
  }
}

for (const name of skillNames) {
  const dir = join(storageDir, "packages", name)
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      console.error("Could not remove directory", dir, e)
    }
  }
}

db.close()

console.log(
  JSON.stringify(
    {
      deletedSkillPackages: skillNames.length,
      names: skillNames,
      zipFilesRemoved: removed,
      zipFilesMissingOnDisk: missing,
      database: dbPath,
      storageDir,
    },
    null,
    2,
  ),
)
