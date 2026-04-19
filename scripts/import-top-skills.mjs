#!/usr/bin/env node
/**
 * Fetches top skills from skills.sh (leaderboard HTML) and ClawHub (Convex API + zip download),
 * writes them under third-party/skills-corpus/ with de-duplication by SKILL.md content hash.
 *
 * Usage: node scripts/import-top-skills.mjs
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs"
import { join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const OUT = join(ROOT, "third-party", "skills-corpus")
const TMP = join(OUT, ".tmp")
const SKILLS_SH_URL = "https://skills.sh/"
const CONVEX_CLOUD = "https://wry-manatee-359.convex.cloud"
const CONVEX_SITE = "https://wry-manatee-359.convex.site"

const LIMIT = 100

/** ClawHub HTTP download is rate-limited (~30/min); stay under it between zip fetches. */
const CLAWHUB_DOWNLOAD_GAP_MS = 2500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(TMP, { recursive: true })
mkdirSync(join(OUT, "skills-sh"), { recursive: true })
mkdirSync(join(OUT, "clawhub"), { recursive: true })

function hashSkillMd(buf) {
  const s = buf.toString("utf8").replace(/\r\n/g, "\n").trim()
  return createHash("sha256").update(s).digest("hex")
}

function rmrf(p) {
  try {
    rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function findSkillDirContaining(extractRoot, skillSegment) {
  const skillDirs = []

  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        const n = e.name.toLowerCase()
        if (n === "skill.md" || n === "skills.md") {
          skillDirs.push(dirname(p))
        }
      }
    }
  }

  walk(extractRoot)

  const exact = skillDirs.filter((d) => basename(d) === skillSegment)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return exact.sort((a, b) => a.length - b.length)[0]

  const partial = skillDirs.filter(
    (d) => d.endsWith(join("/", skillSegment)) || d.includes(`/${skillSegment}/`),
  )
  if (partial.length >= 1)
    return partial.sort((a, b) => a.length - b.length)[0]

  return skillDirs[0] ?? null
}

async function githubDefaultBranch(owner, repo) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
  if (!r.ok) return "main"
  const j = await r.json()
  return typeof j.default_branch === "string" ? j.default_branch : "main"
}

async function fetchBuffer(url, attempt = 1) {
  const dest = join(TMP, `dl-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`)
  try {
    execFileSync("curl", ["-fsSL", url, "-o", dest], { stdio: "ignore" })
    return readFileSync(dest)
  } catch {
    if (attempt < 4) {
      await sleep(5000 * attempt)
      return fetchBuffer(url, attempt + 1)
    }
    throw new Error(`curl failed after retries: ${url}`)
  }
}

async function prepareRepoExtract(owner, repo) {
  const branch = await githubDefaultBranch(owner, repo)
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`
  const tgz = join(TMP, `tgz-${owner}-${repo}-${branch}.tgz`.replace(/[^a-zA-Z0-9_.-]+/g, "-"))
  try {
    execFileSync("curl", ["-fsSL", url, "-o", tgz])
  } catch {
    const urlM = `https://codeload.github.com/${owner}/${repo}/tar.gz/master`
    execFileSync("curl", ["-fsSL", urlM, "-o", tgz])
  }
  const ex = join(TMP, `ex-${owner}-${repo}`.replace(/[^a-zA-Z0-9_.-]+/g, "-"))
  rmrf(ex)
  mkdirSync(ex, { recursive: true })
  execFileSync("tar", ["-xzf", tgz, "-C", ex])
  rmSync(tgz, { force: true })
  const tops = readdirSync(ex)
  if (tops.length !== 1) {
    rmrf(ex)
    throw new Error(`Unexpected tarball layout for ${owner}/${repo}`)
  }
  return join(ex, tops[0])
}

function copySkillFromRepoRoot(repoRoot, owner, repo, skill, destDir) {
  const dir = findSkillDirContaining(repoRoot, skill)
  if (!dir) throw new Error(`SKILL.md not found for ${owner}/${repo}/${skill}`)
  rmrf(destDir)
  mkdirSync(dirname(destDir), { recursive: true })
  cpSync(dir, destDir, { recursive: true })
}

async function convexQuery(path, args) {
  const r = await fetch(`${CONVEX_CLOUD}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, format: "json", args: [args] }),
  })
  if (!r.ok) throw new Error(`Convex query ${path}: ${r.status} ${await r.text()}`)
  const j = await r.json()
  if (j.status !== "success") throw new Error(`Convex: ${JSON.stringify(j)}`)
  return j.value
}

async function downloadClawhubZip(slug) {
  const url = `${CONVEX_SITE}/api/download?slug=${encodeURIComponent(slug)}`
  return await fetchBuffer(url)
}

function unzipTo(buf, destDir) {
  rmrf(destDir)
  mkdirSync(destDir, { recursive: true })
  const z = join(TMP, `z-${createHash("sha256").update(buf).digest("hex").slice(0, 12)}.zip`)
  writeFileSync(z, buf)
  execFileSync("unzip", ["-q", "-o", z, "-d", destDir])
}

// --- Parse skills.sh leaderboard ---
const skillsHtml = await fetch(SKILLS_SH_URL).then((r) => {
  if (!r.ok) throw new Error(`skills.sh ${r.status}`)
  return r.text()
})

const linkRe =
  /href="\/([a-z0-9][a-z0-9_.:-]*)\/([a-z0-9][a-z0-9_.-]*)\/([a-z0-9_.:-]+)"/gi
const triples = []
let m
while ((m = linkRe.exec(skillsHtml))) {
  triples.push(`${m[1]}/${m[2]}/${m[3]}`)
}
const skillsShTop = triples.slice(0, LIMIT)

// --- ClawHub top by downloads ---
const clawPage = await convexQuery("skills:listPublicPageV4", {
  numItems: LIMIT,
  sort: "downloads",
  dir: "desc",
})
const clawSlugs = clawPage.page.map((row) => row.skill.slug)

const manifest = {
  generatedAt: new Date().toISOString(),
  skillsSh: { url: SKILLS_SH_URL, count: skillsShTop.length, paths: skillsShTop },
  clawhub: {
    convex: CONVEX_CLOUD,
    count: clawSlugs.length,
    slugs: clawSlugs,
  },
}

const duplicates = []
const seenHashes = new Map()

function noteDuplicate(keptKey, skippedKey, hash, reason) {
  duplicates.push({ kept: keptKey, skipped: skippedKey, hash, reason })
}

function tryAddUnique(fsPath, key) {
  const skillMdCandidates = [
    join(fsPath, "SKILL.md"),
    join(fsPath, "skill.md"),
  ]
  let p
  for (const c of skillMdCandidates) {
    if (existsSync(c)) {
      p = c
      break
    }
  }
  if (!p) {
    noteDuplicate(key, key, null, "missing_skill_md_at_dest")
    return false
  }
  const h = hashSkillMd(readFileSync(p))
  if (seenHashes.has(h)) {
    noteDuplicate(seenHashes.get(h), key, h, "same_skill_md_sha256")
    return false
  }
  seenHashes.set(h, key)
  return true
}

// skills.sh — group by repo
const byRepo = new Map()
for (const t of skillsShTop) {
  const [o, r, s] = t.split("/")
  const k = `${o}/${r}`
  if (!byRepo.has(k)) byRepo.set(k, [])
  byRepo.get(k).push(s)
}

for (const [repoPath, skills] of byRepo) {
  const [owner, repo] = repoPath.split("/")
  let repoRoot = null
  try {
    repoRoot = await prepareRepoExtract(owner, repo)
  } catch (e) {
    for (const skill of skills) {
      duplicates.push({
        kept: null,
        skipped: `skills-sh:${repoPath}/${skill}`,
        hash: null,
        reason: `repo_fetch_error:${e?.message ?? e}`,
      })
    }
    continue
  }
  for (const skill of skills) {
    const folderName = `${owner}__${repo}__${skill}`.replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    const dest = join(OUT, "skills-sh", folderName)
    const key = `skills-sh:${repoPath}/${skill}`
    try {
      copySkillFromRepoRoot(repoRoot, owner, repo, skill, dest)
      if (!tryAddUnique(dest, key)) {
        rmrf(dest)
      }
    } catch (e) {
      duplicates.push({
        kept: null,
        skipped: key,
        hash: null,
        reason: `error:${e?.message ?? e}`,
      })
    }
  }
  if (repoRoot) rmrf(dirname(repoRoot))
}

for (const slug of clawSlugs) {
  await sleep(CLAWHUB_DOWNLOAD_GAP_MS)
  const key = `clawhub:${slug}`
  const dest = join(OUT, "clawhub", slug)
  try {
    const zbuf = await downloadClawhubZip(slug)
    unzipTo(zbuf, dest)
    if (!tryAddUnique(dest, key)) {
      rmrf(dest)
    }
  } catch (e) {
    duplicates.push({
      kept: null,
      skipped: key,
      hash: null,
      reason: `error:${e?.message ?? e}`,
    })
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT, "duplicates.json"), JSON.stringify(duplicates, null, 2))

// counts
function countDirs(base) {
  if (!existsSync(base)) return 0
  return readdirSync(base).filter((n) => {
    const p = join(base, n)
    return statSync(p).isDirectory() && !n.startsWith(".")
  }).length
}

manifest.stats = {
  skillsShDirs: countDirs(join(OUT, "skills-sh")),
  clawhubDirs: countDirs(join(OUT, "clawhub")),
  uniqueSkillMdHashes: seenHashes.size,
  duplicateOrErrorRecords: duplicates.length,
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2))

rmrf(TMP)

console.log(JSON.stringify(manifest.stats, null, 2))
console.log(`Done. Output: ${OUT}`)
