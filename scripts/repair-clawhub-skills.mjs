#!/usr/bin/env node
/**
 * Re-downloads ClawHub skills that failed (e.g. rate limit) and merges with
 * existing third-party/skills-corpus, using the same SKILL.md hash de-dup rules.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  cpSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const OUT = join(ROOT, "third-party", "skills-corpus")
const CONVEX_SITE = "https://wry-manatee-359.convex.site"
const TMP = join(OUT, ".repair-tmp")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function hashSkillMd(buf) {
  const s = buf.toString("utf8").replace(/\r\n/g, "\n").trim()
  return createHash("sha256").update(s).digest("hex")
}

function collectHashes(base) {
  const seen = new Map()
  function walk(dir) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (name.toLowerCase() === "skill.md") {
        const h = hashSkillMd(readFileSync(p))
        const rel = p.slice(base.length + 1)
        seen.set(h, rel)
      }
    }
  }
  walk(base)
  return seen
}

function unzipTo(buf, destDir) {
  mkdirSync(TMP, { recursive: true })
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  const z = join(TMP, `z-${createHash("sha256").update(buf).digest("hex").slice(0, 12)}.zip`)
  writeFileSync(z, buf)
  execFileSync("unzip", ["-q", "-o", z, "-d", destDir])
  rmSync(z, { force: true })
}

async function fetchZip(slug, attempt = 1) {
  const url = `${CONVEX_SITE}/api/download?slug=${encodeURIComponent(slug)}`
  const dest = join(TMP, `dl-${slug.slice(0, 40)}`)
  mkdirSync(TMP, { recursive: true })
  try {
    execFileSync("curl", ["-fsSL", url, "-o", dest], { stdio: "ignore" })
    return readFileSync(dest)
  } catch {
    rmSync(dest, { force: true })
    if (attempt < 4) {
      await sleep(5000 * attempt)
      return fetchZip(slug, attempt + 1)
    }
    throw new Error(`Failed after retries: ${slug}`)
  }
}

const duplicatesPath = join(OUT, "duplicates.json")
const dup = JSON.parse(readFileSync(duplicatesPath, "utf8"))
const failed = dup
  .filter((d) => d.skipped?.startsWith("clawhub:") && String(d.reason).startsWith("error:"))
  .map((d) => d.skipped.replace("clawhub:", ""))

const existingHashes = collectHashes(OUT)
const repairs = []
const newDups = []

for (const slug of failed) {
  await sleep(2500)
  const dest = join(OUT, "clawhub", slug)
  try {
    const buf = await fetchZip(slug)
    unzipTo(buf, dest)
    const sm = join(dest, "SKILL.md")
    const sm2 = join(dest, "skill.md")
    const p = existsSync(sm) ? sm : existsSync(sm2) ? sm2 : null
    if (!p) {
      newDups.push({ slug, reason: "missing_skill_md" })
      rmSync(dest, { recursive: true, force: true })
      continue
    }
    const h = hashSkillMd(readFileSync(p))
    if (existingHashes.has(h)) {
      newDups.push({
        slug,
        reason: `duplicate_of_existing:${existingHashes.get(h)}`,
      })
      rmSync(dest, { recursive: true, force: true })
      continue
    }
    existingHashes.set(h, `clawhub/${slug}/SKILL.md`)
    repairs.push(slug)
  } catch (e) {
    newDups.push({ slug, reason: String(e?.message ?? e) })
  }
}

rmSync(TMP, { recursive: true, force: true })

writeFileSync(
  join(OUT, "clawhub-repair.json"),
  JSON.stringify(
    { repaired: repairs, stillFailed: newDups, at: new Date().toISOString() },
    null,
    2,
  ),
)

console.log(JSON.stringify({ repaired: repairs.length, stillFailed: newDups.length }, null, 2))
