#!/usr/bin/env node
/**
 * Download ClawHub (clawhub.ai) public skills ranked by downloads — same ordering as
 * https://clawhub.ai/skills?sort=downloads — up to N items (default 1000).
 *
 * Uses Convex query `skills:listPublicPageV4` (paginated, max 200 rows per request) and
 * HTTP GET `{CONVEX_SITE}/api/download?slug=...` for each skill zip.
 *
 * The download endpoint is rate-limited (~30/min); default gap between downloads is 2.5s.
 *
 * Usage:
 *   node scripts/download-clawhub-top-skills.mjs
 *   node scripts/download-clawhub-top-skills.mjs --limit 500 --out ./third-party/my-clawhub
 *   node scripts/download-clawhub-top-skills.mjs --resume
 *   node scripts/download-clawhub-top-skills.mjs --dry-run
 *
 * Environment (optional; defaults match current production deployment — update if ClawHub changes):
 *   CLAWHUB_CONVEX_CLOUD  default https://wry-manatee-359.convex.cloud
 *   CLAWHUB_CONVEX_SITE   default https://wry-manatee-359.convex.site
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const DEFAULT_LIMIT = 1000
const PAGE_SIZE = 200
const DEFAULT_GAP_MS = 2500
const DEFAULT_OUT = join(ROOT, "third-party", "clawhub-top-1000")
const MAX_DOWNLOAD_RETRIES = 4

function parseArgs(argv) {
  const o = {
    limit: DEFAULT_LIMIT,
    out: DEFAULT_OUT,
    gapMs: DEFAULT_GAP_MS,
    resume: false,
    dryRun: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--resume") o.resume = true
    else if (a === "--dry-run") o.dryRun = true
    else if (a.startsWith("--limit="))
      o.limit = Math.max(1, parseInt(a.split("=")[1], 10) || DEFAULT_LIMIT)
    else if (a === "--limit") o.limit = Math.max(1, parseInt(argv[++i], 10) || DEFAULT_LIMIT)
    else if (a.startsWith("--out=")) o.out = a.split("=")[1]
    else if (a === "--out") o.out = argv[++i]
    else if (a.startsWith("--gap-ms="))
      o.gapMs = Math.max(0, parseInt(a.split("=")[1], 10) || DEFAULT_GAP_MS)
    else if (a === "--gap-ms") o.gapMs = Math.max(0, parseInt(argv[++i], 10) || DEFAULT_GAP_MS)
    else if (a === "-h" || a === "--help") {
      console.log(`Usage: node scripts/download-clawhub-top-skills.mjs [options]

Options:
  --limit N     Max skills to fetch (default ${DEFAULT_LIMIT})
  --out DIR     Output directory (default third-party/clawhub-top-1000)
  --gap-ms MS   Delay between download requests (default ${DEFAULT_GAP_MS})
  --resume      Skip folders that already contain SKILL.md or skill.md
  --dry-run     Only list slugs from API, do not download
`)
      process.exit(0)
    }
  }
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const opts = parseArgs(process.argv)

const CONVEX_CLOUD =
  process.env.CLAWHUB_CONVEX_CLOUD ?? "https://wry-manatee-359.convex.cloud"
const CONVEX_SITE =
  process.env.CLAWHUB_CONVEX_SITE ?? "https://wry-manatee-359.convex.site"

async function convexQuery(path, args) {
  const r = await fetch(`${CONVEX_CLOUD}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, format: "json", args: [args] }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Convex ${path}: ${r.status} ${text.slice(0, 500)}`)
  let j
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error(`Convex invalid JSON: ${text.slice(0, 200)}`)
  }
  if (j.status !== "success") throw new Error(`Convex: ${text.slice(0, 500)}`)
  return j.value
}

/** Collect slugs until `limit` or API has no more pages. */
async function listTopSlugs(limit) {
  const slugs = []
  let cursor = undefined
  while (slugs.length < limit) {
    const need = Math.min(PAGE_SIZE, limit - slugs.length)
    const page = await convexQuery("skills:listPublicPageV4", {
      numItems: need,
      sort: "downloads",
      dir: "desc",
      ...(cursor ? { cursor } : {}),
    })
    const rows = page.page ?? []
    for (const row of rows) {
      const slug = row?.skill?.slug
      if (typeof slug === "string" && slug) slugs.push(slug)
      if (slugs.length >= limit) break
    }
    if (!page.hasMore || rows.length === 0) break
    cursor = page.nextCursor
    if (!cursor) break
  }
  return slugs
}

function hasSkillMd(dir) {
  return (
    existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, "skill.md"))
  )
}

function unzipBuffer(buf, destDir) {
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  const tmpDir = join(destDir, "..", `.zip-tmp-${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`)
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  const zpath = join(tmpDir, "bundle.zip")
  writeFileSync(zpath, buf)
  execFileSync("unzip", ["-q", "-o", zpath, "-d", destDir])
  rmSync(tmpDir, { recursive: true, force: true })
}

async function downloadZip(slug, attempt = 1) {
  const url = `${CONVEX_SITE}/api/download?slug=${encodeURIComponent(slug)}`
  const r = await fetch(url)
  if (!r.ok) {
    const t = await r.text()
    if (attempt < MAX_DOWNLOAD_RETRIES) {
      await sleep(3000 * attempt)
      return downloadZip(slug, attempt + 1)
    }
    throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`)
  }
  return Buffer.from(await r.arrayBuffer())
}

async function main() {
  mkdirSync(opts.out, { recursive: true })

  console.error(`Listing up to ${opts.limit} slugs (downloads sort)…`)
  const slugs = await listTopSlugs(opts.limit)
  console.error(`Got ${slugs.length} slug(s).`)

  if (opts.dryRun) {
    console.log(JSON.stringify({ slugs }, null, 2))
    return
  }

  const manifest = {
    source: "clawhub.ai",
    convexCloud: CONVEX_CLOUD,
    convexSite: CONVEX_SITE,
    sort: "downloads",
    limitRequested: opts.limit,
    generatedAt: new Date().toISOString(),
    slugs,
    downloaded: [],
    skippedResume: [],
    failed: [],
  }

  let i = 0
  let downloadAttempts = 0
  for (const slug of slugs) {
    i += 1
    const dest = join(opts.out, slug)

    if (opts.resume && hasSkillMd(dest)) {
      manifest.skippedResume.push(slug)
      console.error(`[${i}/${slugs.length}] skip (resume): ${slug}`)
      continue
    }

    if (opts.gapMs > 0 && downloadAttempts > 0) await sleep(opts.gapMs)
    downloadAttempts += 1

    process.stderr.write(`[${i}/${slugs.length}] ${slug} … `)
    try {
      const buf = await downloadZip(slug)
      unzipBuffer(buf, dest)
      if (!hasSkillMd(dest)) {
        throw new Error("unzipped but SKILL.md not found")
      }
      manifest.downloaded.push(slug)
      console.error("ok")
    } catch (e) {
      manifest.failed.push({ slug, error: String(e?.message ?? e) })
      console.error(`FAIL: ${e?.message ?? e}`)
    }
  }

  writeFileSync(join(opts.out, "manifest.json"), JSON.stringify(manifest, null, 2))
  console.error(
    `Done. OK ${manifest.downloaded.length}, skipped ${manifest.skippedResume.length}, failed ${manifest.failed.length}. manifest: ${join(opts.out, "manifest.json")}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
