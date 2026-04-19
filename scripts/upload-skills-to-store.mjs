#!/usr/bin/env node
/**
 * Upload local skill folders (each with SKILL.md) to an xopc-store instance via HTTP API.
 *
 * Requires:
 *   - XOPC_TOKEN: JWT from store (Authorization: Bearer). Do NOT commit this value.
 *   - Optional XOPC_API_BASE (default https://store.xopc.ai)
 *
 * Each folder is zipped; SKILL.md frontmatter `name` is rewritten to match the store package name
 * (derived from the folder/slug name, valid for isValidPackageName).
 *
 * Usage:
 *   export XOPC_TOKEN="your-jwt"
 *   node scripts/upload-skills-to-store.mjs --dir ./third-party/clawhub-top-1000
 *   node scripts/upload-skills-to-store.mjs --dir ./third-party/clawhub-top-1000 --dry-run --limit 5
 *   node scripts/upload-skills-to-store.mjs --dir ./path --approve
 *
 * Options:
 *   --dir PATH       Root containing one subfolder per skill (default: ./third-party/clawhub-top-1000)
 *   --version VER    Semver to publish (default 1.0.0)
 *   --delay MS       Pause between uploads (default 400)
 *   --limit N        Only first N folders (after sort)
 *   --dry-run        Print actions only
 *   --approve        After each successful upload, POST /api/v1/admin/versions/:id/approve (requires admin)
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { execFileSync, spawnSync } from "node:child_process"
import matter from "../apps/server/node_modules/gray-matter/index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function parseArgs(argv) {
  const o = {
    dir: join(ROOT, "third-party", "clawhub-top-1000"),
    version: "1.0.0",
    delayMs: 400,
    limit: Infinity,
    dryRun: false,
    approve: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") o.dryRun = true
    else if (a === "--approve") o.approve = true
    else if (a.startsWith("--dir=")) o.dir = a.slice(6)
    else if (a === "--dir") o.dir = argv[++i]
    else if (a.startsWith("--version=")) o.version = a.slice(10)
    else if (a === "--version") o.version = argv[++i]
    else if (a.startsWith("--delay=")) o.delayMs = parseInt(a.slice(8), 10) || 400
    else if (a === "--delay") o.delayMs = parseInt(argv[++i], 10) || 400
    else if (a.startsWith("--limit=")) o.limit = parseInt(a.slice(8), 10) || Infinity
    else if (a === "--limit") o.limit = parseInt(argv[++i], 10) || Infinity
    else if (a === "-h" || a === "--help") {
      console.log(`See script header in scripts/upload-skills-to-store.mjs`)
      process.exit(0)
    }
  }
  return o
}

const opts = parseArgs(process.argv)

const API_BASE = (process.env.XOPC_API_BASE ?? "https://store.xopc.ai").replace(/\/$/, "")
const TOKEN = process.env.XOPC_TOKEN

function isValidPackageName(name) {
  if (name.length < 1 || name.length > 64) return false
  if (!/^[a-z0-9-]+$/.test(name)) return false
  if (name.startsWith("-") || name.endsWith("-")) return false
  return true
}

/** Map folder slug → store package name (unique in this run). */
function slugToPackageName(slug, used) {
  let s = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (s.length < 2) s = `s-${slug.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "") || "pkg"}`
  if (s.length < 2) s = "skill-pkg"
  if (s.length > 64) s = s.slice(0, 64).replace(/-+$/g, "") || "skill-pkg"
  let candidate = s
  let n = 2
  while (used.has(candidate) || !isValidPackageName(candidate)) {
    const suffix = `-${n}`
    candidate = (s.slice(0, Math.max(2, 64 - suffix.length)) + suffix).replace(/-+$/g, "")
    n += 1
  }
  used.add(candidate)
  return candidate
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findSkillMd(dir) {
  const a = join(dir, "SKILL.md")
  const b = join(dir, "skill.md")
  if (existsSync(a)) return a
  if (existsSync(b)) return b
  return null
}

function patchSkillMd(raw, pkgName, descFallback) {
  try {
    const parsed = matter(raw)
    const fm = { ...parsed.data, name: pkgName }
    if (typeof fm.description !== "string" || !fm.description.trim()) {
      fm.description = descFallback
    }
    return matter.stringify(parsed.content, fm)
  } catch {
    const body = raw.replace(/^---[\s\S]*?^---\s*/m, "").trim()
    return `---\nname: ${JSON.stringify(pkgName)}\ndescription: ${JSON.stringify(descFallback)}\n---\n\n${body || raw}`
  }
}

function parseSkillMd(raw, slug) {
  const fallback = `ClawHub skill “${slug}” (imported).`
  try {
    const parsed = matter(raw)
    const desc =
      (typeof parsed.data.description === "string" && parsed.data.description.trim()) ||
      fallback
    return { parsed, desc }
  } catch {
    return { parsed: null, desc: fallback }
  }
}

function zipDir(srcDir, zipPath) {
  execFileSync("zip", ["-r", "-q", zipPath, "."], {
    cwd: srcDir,
    stdio: "ignore",
  })
}

/** Multipart: avoid newlines / NUL that break curl --form-string. */
function flattenDescription(s) {
  return s.replace(/\r?\n/g, " ").replace(/\0/g, "").trim().slice(0, 8000)
}

/**
 * Hono + Node fetch FormData/Blob is unreliable for some deployments (500).
 * Use curl -F file=@... which matches browser multipart.
 */
function httpPostMultipartCurl(url, token, zipPathAbs, version, description) {
  const desc = flattenDescription(description)
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-X",
      "POST",
      "-H",
      `Authorization: Bearer ${token}`,
      "-F",
      "type=skill",
      "-F",
      `version=${version}`,
      "--form-string",
      `description=${desc}`,
      "-F",
      `file=@${zipPathAbs};type=application/zip`,
      "-w",
      "\nHTTP_CODE:%{http_code}",
      url,
    ],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  )
  const stdout = r.stdout || ""
  if (r.error) throw r.error
  const m = stdout.match(/\nHTTP_CODE:(\d+)\s*$/)
  const code = m ? parseInt(m[1], 10) : 0
  const body = m ? stdout.slice(0, m.index) : stdout
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
    throw new Error(`${code} ${JSON.stringify(json).slice(0, 500)}`)
  }
  return json
}

function httpPostApproveCurl(versionId, token) {
  const url = `${API_BASE}/api/v1/admin/versions/${encodeURIComponent(versionId)}/approve`
  const r = spawnSync(
    "curl",
    [
      "-sS",
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
  const stdout = r.stdout || ""
  if (r.error) throw r.error
  const m = stdout.match(/\nHTTP_CODE:(\d+)\s*$/)
  const code = m ? parseInt(m[1], 10) : 0
  const body = m ? stdout.slice(0, m.index) : stdout
  if (code < 200 || code >= 300) {
    let j
    try {
      j = JSON.parse(body)
    } catch {
      j = { raw: body }
    }
    throw new Error(`approve ${code} ${JSON.stringify(j).slice(0, 400)}`)
  }
}

async function uploadOne({
  pkgName,
  zipPath,
  version,
  description,
  token,
  approve,
}) {
  const url = `${API_BASE}/api/v1/developer/packages/${encodeURIComponent(pkgName)}/versions`
  const zipPathAbs = resolve(zipPath)

  const json = httpPostMultipartCurl(url, token, zipPathAbs, version, description)

  if (approve && json.versionId) {
    httpPostApproveCurl(json.versionId, token)
  }
  return json
}

async function main() {
  if (!opts.dryRun && !TOKEN) {
    console.error(
      "Set XOPC_TOKEN to your JWT, e.g. export XOPC_TOKEN='...'\nDo not commit tokens.",
    )
    process.exit(1)
  }

  if (!existsSync(opts.dir)) {
    console.error(`Directory not found: ${opts.dir}`)
    process.exit(1)
  }

  const slugs = readdirSync(opts.dir)
    .filter((n) => !n.startsWith(".") && n !== "manifest.json")
    .filter((n) => statSync(join(opts.dir, n)).isDirectory())
    .sort()

  const slice = slugs.slice(0, opts.limit)
  const usedNames = new Set()
  const results = { ok: [], fail: [] }

  let i = 0
  for (const slug of slice) {
    i += 1
    const src = join(opts.dir, slug)
    const skillMd = findSkillMd(src)
    if (!skillMd) {
      results.fail.push({ slug, error: "no SKILL.md" })
      console.error(`[${i}/${slice.length}] ${slug} SKIP (no SKILL.md)`)
      continue
    }

    const pkgName = slugToPackageName(slug, usedNames)

    if (opts.dryRun) {
      console.log(`[${i}/${slice.length}] would upload ${slug} → package ${pkgName}`)
      continue
    }

    const raw = readFileSync(skillMd, "utf8")
    const { desc } = parseSkillMd(raw, slug)

    const tmpRoot = mkdtempSync(join(tmpdir(), "xopc-skill-"))
    try {
      mkdirSync(tmpRoot, { recursive: true })
      for (const ent of readdirSync(src, { withFileTypes: true })) {
        cpSync(join(src, ent.name), join(tmpRoot, ent.name), {
          recursive: true,
        })
      }
      const mdName = basename(skillMd)
      const patched = patchSkillMd(readFileSync(join(tmpRoot, mdName), "utf8"), pkgName, desc)
      writeFileSync(join(tmpRoot, mdName), patched)

      const zipFile = join(tmpdir(), `xopc-${pkgName}-${Date.now()}.zip`)
      zipDir(tmpRoot, zipFile)

      process.stdout.write(`[${i}/${slice.length}] ${slug} → ${pkgName} … `)
      await uploadOne({
        pkgName,
        zipPath: zipFile,
        version: opts.version,
        description: desc,
        token: TOKEN,
        approve: opts.approve,
      })
      console.log(opts.approve ? "ok (approved)" : "ok (pending review)")
      results.ok.push({ slug, pkgName })
    } catch (e) {
      console.log(`FAIL: ${e?.message ?? e}`)
      results.fail.push({ slug, pkgName, error: String(e?.message ?? e) })
    } finally {
      try {
        rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    if (opts.delayMs > 0 && i < slice.length) await sleep(opts.delayMs)
  }

  const out = join(opts.dir, `upload-report-${Date.now()}.json`)
  if (!opts.dryRun) {
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
    console.error(`Report: ${out}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
