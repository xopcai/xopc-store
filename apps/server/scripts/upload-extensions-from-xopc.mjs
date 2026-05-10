#!/usr/bin/env node
/**
 * Zip each extension folder (xopc.extension.json) and POST to local/production xopc-store.
 *
 * Run from repo root or apps/server (paths are resolved from apps/server):
 *   node apps/server/scripts/upload-extensions-from-xopc.mjs --dir /path/to/xopc/extensions
 *   cd apps/server && node scripts/upload-extensions-from-xopc.mjs --dir /path/to/xopc/extensions
 *
 * Options:
 *   --dir PATH       Root with one subfolder per extension (required unless XOPC_EXTENSIONS_DIR)
 *   --api URL        Store API base (default XOPC_API_BASE or http://127.0.0.1:3000)
 *   --approve        After each upload, POST admin approve (default: true)
 *   --no-approve     Skip approve (versions stay pending)
 *   --dry-run
 *
 * Auth: mints a short-lived JWT from JWT_SECRET + first user row in SQLite (same machine only).
 *
 * If a version already exists (409), the script bumps semver patch and retries (up to 50 times).
 *
 * Progress logs go to stderr as: [ext-upload HH:MM:SS.mmm] …
 */
import { config } from "dotenv"
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync, execFileSync } from "node:child_process"
import Database from "better-sqlite3"
import { SignJWT } from "jose"
import semver from "semver"

const __dirname = dirname(fileURLToPath(import.meta.url))
/** apps/server — used for .env and DATABASE_URL (not process.cwd()) */
const SERVER_ROOT = join(__dirname, "..")
config({ path: join(SERVER_ROOT, ".env") })

function parseArgs(argv) {
  const o = {
    dir: process.env.XOPC_EXTENSIONS_DIR?.trim() || "",
    api: (process.env.XOPC_API_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
    approve: true,
    dryRun: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") o.dryRun = true
    else if (a === "--approve") o.approve = true
    else if (a === "--no-approve") o.approve = false
    else if (a.startsWith("--dir=")) o.dir = a.slice(6)
    else if (a === "--dir") o.dir = argv[++i] ?? ""
    else if (a.startsWith("--api=")) o.api = a.slice(6).replace(/\/$/, "")
    else if (a === "--api") o.api = (argv[++i] ?? "").replace(/\/$/, "")
    else if (a === "-h" || a === "--help") {
      console.log("See header in upload-extensions-from-xopc.mjs")
      process.exit(0)
    }
  }
  return o
}

const opts = parseArgs(process.argv)

function logTs() {
  const d = new Date()
  const z = (n) => String(n).padStart(2, "0")
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`
}

/** Progress / debug (stderr so stdout summary lines stay readable). */
function log(msg) {
  console.error(`[ext-upload ${logTs()}] ${msg}`)
}

/** curl stall guard (upload can be slow on large zips) */
const CURL_MAX_TIME_SEC = Math.max(
  30,
  Number.parseInt(process.env.XOPC_UPLOAD_CURL_MAX_TIME ?? "300", 10) || 300,
)

function getUploadErrorHttpCode(e) {
  if (e && typeof e === "object" && Number.isFinite(/** @type {{ httpCode?: unknown }} */ (e).httpCode)) {
    return /** @type {{ httpCode: number }} */ (e).httpCode
  }
  const m = String(/** @type {{ message?: unknown }} */ (e)?.message ?? "").match(/^(\d{3})\s/)
  return m ? parseInt(m[1], 10) : 0
}

function isVersionConflict(e) {
  if (getUploadErrorHttpCode(e) !== 409) return false
  const body = /** @type {{ body?: unknown }} */ (e).body
  if (!body || typeof body !== "object") return true
  const code = /** @type {{ error?: { code?: string } }} */ (body).error?.code
  return code === "CONFLICT" || code === undefined
}

function isValidPackageName(name) {
  if (!name || name.length < 1 || name.length > 64) return false
  if (!/^[a-z0-9-]+$/.test(name)) return false
  if (name.startsWith("-") || name.endsWith("-")) return false
  return true
}

function flattenDescription(s) {
  return String(s)
    .replace(/\r?\n/g, " ")
    .replace(/\0/g, "")
    .trim()
    .slice(0, 8000)
}

function zipDir(srcDir, zipPath) {
  log(`zip: cwd=${srcDir} out=${zipPath}`)
  const t0 = Date.now()
  // macOS/BSD zip: `-y` stores symlinks without dereferencing. Otherwise `node_modules` →
  // `../../../node_modules/...` can pull in the entire monorepo and appear to hang.
  execFileSync(
    "zip",
    [
      "-r",
      "-q",
      "-y",
      zipPath,
      ".",
      "-x",
      "node_modules/*",
      "-x",
      "*/node_modules/*",
      "-x",
      ".git/*",
      "-x",
      "*/.git/*",
    ],
    { cwd: srcDir, stdio: "ignore" },
  )
  let bytes = 0
  try {
    bytes = statSync(zipPath).size
  } catch {
    /* ignore */
  }
  log(`zip: done in ${Date.now() - t0}ms size=${bytes} bytes`)
}

function httpPostMultipartCurl(url, token, zipPathAbs, fields, meta) {
  const label = meta?.label ?? "POST multipart"
  let zipBytes = 0
  try {
    zipBytes = statSync(zipPathAbs).size
  } catch {
    /* ignore */
  }
  log(
    `${label}: curl start maxTime=${CURL_MAX_TIME_SEC}s zip=${zipBytes}B version=${fields.version}`,
  )
  log(`${label}: URL ${url}`)
  const args = [
    "-sS",
    "--connect-timeout",
    "15",
    "--max-time",
    String(CURL_MAX_TIME_SEC),
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    "-w",
    "\nHTTP_CODE:%{http_code}",
  ]
  for (const [k, v] of Object.entries(fields)) {
    if (k === "file") {
      args.push("-F", `file=@${zipPathAbs};type=application/zip`)
    } else {
      args.push("--form-string", `${k}=${v}`)
    }
  }
  args.push(url)
  const t0 = Date.now()
  const r = spawnSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  })
  const elapsed = Date.now() - t0
  const stdout = r.stdout || ""
  if (r.error) throw r.error
  const m = stdout.match(/\nHTTP_CODE:(\d+)\s*$/)
  const code = m ? parseInt(m[1], 10) : 0
  const body = m ? stdout.slice(0, m.index) : stdout
  if (r.status !== 0) {
    log(
      `${label}: curl process exit=${r.status} signal=${r.signal ?? "none"} httpCode=${code || "?"} ${elapsed}ms`,
    )
    if (r.stderr?.trim()) log(`${label}: curl stderr ${r.stderr.trim().slice(0, 400)}`)
  } else {
    log(`${label}: curl process exit=0 ${elapsed}ms httpCode=${code || "?"}`)
  }
  if (r.status !== 0 && !m) {
    throw new Error(`curl failed: ${(r.stderr || stdout).slice(0, 500)}`)
  }
  let json
  try {
    json = JSON.parse(body)
  } catch {
    json = { raw: body }
  }
  if (code < 200 || code >= 300) {
    const err = new Error(`${code} ${JSON.stringify(json).slice(0, 800)}`)
    err.httpCode = code
    err.body = json
    throw err
  }
  log(`${label}: HTTP ${code} OK`)
  return json
}

function httpPostApproveCurl(apiBase, versionId, token, meta) {
  const url = `${apiBase}/api/v1/admin/versions/${encodeURIComponent(versionId)}/approve`
  const label = meta?.label ?? "POST approve"
  log(`${label}: curl start versionId=${versionId}`)
  log(`${label}: URL ${url}`)
  const t0 = Date.now()
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "--connect-timeout",
      "15",
      "--max-time",
      "60",
      "-X",
      "POST",
      "-H",
      `Authorization: Bearer ${token}`,
      "-w",
      "\nHTTP_CODE:%{http_code}",
      url,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  )
  const elapsed = Date.now() - t0
  const stdout = r.stdout || ""
  const m = stdout.match(/\nHTTP_CODE:(\d+)\s*$/)
  const code = m ? parseInt(m[1], 10) : 0
  const body = m ? stdout.slice(0, m.index) : stdout
  log(
    `${label}: curl exit=${r.status} signal=${r.signal ?? "none"} httpCode=${code} ${elapsed}ms`,
  )
  if (r.stderr?.trim()) log(`${label}: curl stderr ${r.stderr.trim().slice(0, 400)}`)
  if (code < 200 || code >= 300) {
    let j
    try {
      j = JSON.parse(body)
    } catch {
      j = { raw: body }
    }
    throw new Error(`approve ${code} ${JSON.stringify(j).slice(0, 400)}`)
  }
  log(`${label}: HTTP ${code} OK`)
}

async function mintToken() {
  log("mint JWT: reading JWT_SECRET + SQLite user")
  const secret = new TextEncoder().encode(process.env.JWT_SECRET)
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    throw new Error("JWT_SECRET missing or too short in apps/server/.env")
  }
  const dbPath = resolve(
    SERVER_ROOT,
    process.env.DATABASE_URL || "./data/store.db",
  )
  log(`mint JWT: opening DB ${dbPath}`)
  const db = new Database(dbPath, { readonly: true })
  const row = db
    .prepare(
      "SELECT id, role FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1",
    )
    .get()
  db.close()
  if (!row?.id) {
    throw new Error(`No users in ${dbPath} — complete GitHub login once in the web UI`)
  }
  log(`mint JWT: picked user id=${row.id} role=${row.role}`)
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600
  const token = await new SignJWT({ userId: row.id, role: row.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret)
  log("mint JWT: signed OK (token not printed)")
  return token
}

async function uploadOne(apiBase, token, pkgName, zipPathAbs, version, description, approve) {
  const url = `${apiBase}/api/v1/developer/packages/${encodeURIComponent(pkgName)}/versions`
  const desc = flattenDescription(description)
  const maxBumps = 50
  let attemptVersion = version
  let json
  let bumpedFrom = null
  log(`upload: package=${pkgName} initialVersion=${version} approve=${approve}`)
  for (let bump = 0; bump <= maxBumps; bump++) {
    const fields = {
      type: "extension",
      version: attemptVersion,
      description: desc,
      file: true,
    }
    try {
      json = httpPostMultipartCurl(url, token, zipPathAbs, fields, {
        label: `upload[${pkgName}]`,
      })
      log(
        `upload[${pkgName}]: store OK version=${attemptVersion} versionId=${json.versionId ?? "?"}`,
      )
      if (bumpedFrom) {
        process.stderr.write(` → ${attemptVersion}`)
      }
      break
    } catch (e) {
      if (isVersionConflict(e)) {
        const next = semver.inc(attemptVersion, "patch")
        if (!next) throw e
        log(
          `upload[${pkgName}]: 409 conflict on ${attemptVersion} → bump to ${next} (attempt ${bump + 1}/${maxBumps})`,
        )
        if (bumpedFrom === null) bumpedFrom = attemptVersion
        attemptVersion = next
        if (bump === maxBumps) {
          throw new Error(
            `409 after ${maxBumps} patch bumps (from ${version}); delete old versions or raise manifest version`,
          )
        }
        continue
      }
      throw e
    }
  }
  if (approve && json.versionId) {
    log(`upload[${pkgName}]: approving versionId=${json.versionId}`)
    httpPostApproveCurl(apiBase, json.versionId, token, {
      label: `approve[${pkgName}]`,
    })
    log(`upload[${pkgName}]: approve OK`)
  }
  return json
}

async function main() {
  if (!opts.dir?.trim()) {
    console.error("Pass --dir /path/to/xopc/extensions or set XOPC_EXTENSIONS_DIR")
    process.exit(1)
  }
  const extRoot = resolve(opts.dir.trim())
  if (!existsSync(extRoot)) {
    console.error(`Not found: ${extRoot}`)
    process.exit(1)
  }

  log(
    `start extRoot=${extRoot} api=${opts.api} approve=${opts.approve} curlMaxTimeUpload=${CURL_MAX_TIME_SEC}s SERVER_ROOT=${SERVER_ROOT}`,
  )

  const names = readdirSync(extRoot)
    .filter((n) => !n.startsWith("."))
    .filter((n) => statSync(join(extRoot, n)).isDirectory())
    .sort()

  log(`found ${names.length} subdirectories under ext root`)

  let token
  if (!opts.dryRun) {
    token = await mintToken()
  }

  const results = { ok: [], fail: [] }
  let i = 0
  for (const folder of names) {
    i += 1
    log(`---------- [${i}/${names.length}] folder=${folder} ----------`)
    const src = join(extRoot, folder)
    const manifestPath = join(src, "xopc.extension.json")
    if (!existsSync(manifestPath)) {
      results.fail.push({ folder, error: "no xopc.extension.json" })
      console.error(`[${i}/${names.length}] ${folder} SKIP (no manifest)`)
      continue
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    } catch (e) {
      results.fail.push({ folder, error: String(e) })
      console.error(`[${i}/${names.length}] ${folder} SKIP (bad JSON)`)
      continue
    }
    const pkgName = typeof manifest.id === "string" ? manifest.id.trim() : ""
    const desc =
      typeof manifest.description === "string" && manifest.description.trim()
        ? manifest.description.trim()
        : `(extension ${pkgName})`
    let version =
      typeof manifest.version === "string" && semver.valid(manifest.version)
        ? semver.valid(manifest.version)
        : null
    if (!version) {
      version = "1.0.0"
    }
    if (!isValidPackageName(pkgName)) {
      results.fail.push({ folder, pkgName, error: "invalid package id" })
      console.error(`[${i}/${names.length}] ${folder} SKIP (invalid id: ${pkgName})`)
      continue
    }

    if (opts.dryRun) {
      console.log(`[${i}/${names.length}] would upload ${folder} → ${pkgName}@${version}`)
      results.ok.push({ folder, pkgName })
      continue
    }

    const zipFile = join(tmpdir(), `xopc-ext-${pkgName}-${Date.now()}.zip`)
    try {
      log(`[${i}/${names.length}] begin zip + upload folder=${folder} pkg=${pkgName}@${version}`)
      zipDir(src, zipFile)
      process.stdout.write(
        `[${i}/${names.length}] ${folder} → ${pkgName}@${version} … `,
      )
      await uploadOne(opts.api, token, pkgName, zipFile, version, desc, opts.approve)
      console.log(opts.approve ? "ok (approved)" : "ok (pending)")
      results.ok.push({ folder, pkgName })
    } catch (e) {
      console.log(`FAIL: ${e?.message ?? e}`)
      results.fail.push({ folder, pkgName, error: String(e?.message ?? e) })
    } finally {
      try {
        rmSync(zipFile, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  log("all folders processed, writing summary JSON to stderr")
  console.error(
    JSON.stringify(
      { at: new Date().toISOString(), api: opts.api, results },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
