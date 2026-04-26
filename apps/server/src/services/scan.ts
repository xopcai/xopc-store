import AdmZip from "adm-zip"
import matter from "gray-matter"
import semver from "semver"
import type { PackageType } from "@xopc-store/shared"
import { normalizeCategory } from "../lib/category.js"

const MAX_SKILL_BYTES = 1 * 1024 * 1024
const MAX_EXTENSION_BYTES = 10 * 1024 * 1024

export type ScanSuccess = {
  manifest: Record<string, unknown>
  readme: string | null
  fileTree: string[]
}

export type ScanFailure = { ok: false; message: string }
export type ScanResult = { ok: true; data: ScanSuccess } | ScanFailure

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "")
}

function listZipEntries(zip: AdmZip): string[] {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => normalizePath(e.entryName))
}

export function isValidPackageName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false
  if (!/^[a-z0-9-]+$/.test(name)) return false
  if (name.startsWith("-") || name.endsWith("-")) return false
  return true
}

export function scanZipPackage(
  buffer: Buffer,
  expectedName: string,
  type: PackageType,
): ScanResult {
  const maxBytes = type === "skill" ? MAX_SKILL_BYTES : MAX_EXTENSION_BYTES
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      message: `File size exceeds limit (${maxBytes} bytes for ${type})`,
    }
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    return { ok: false, message: "Invalid or corrupted zip file" }
  }

  const entries = listZipEntries(zip)
  if (entries.length === 0) {
    return { ok: false, message: "Zip archive is empty" }
  }

  const fileTree = entries.slice().sort()

  if (type === "skill") {
    const skillPath = entries.find(
      (e) => e === "SKILL.md" || e.endsWith("/SKILL.md"),
    )
    if (!skillPath) {
      return { ok: false, message: "SKILL.md not found in archive" }
    }
    const raw = zip.readAsText(skillPath)
    let parsed: ReturnType<typeof matter>
    try {
      parsed = matter(raw)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        message: `SKILL.md frontmatter could not be parsed (YAML): ${msg}`,
      }
    }
    const fm = parsed.data as Record<string, unknown>
    const name = fm.name
    const desc = fm.description
    if (typeof name !== "string" || typeof desc !== "string") {
      return {
        ok: false,
        message: "SKILL.md frontmatter must include name and description (strings)",
      }
    }
    if (name !== expectedName) {
      return {
        ok: false,
        message: `Package name mismatch: manifest name "${name}" must be "${expectedName}"`,
      }
    }
    if (Object.hasOwn(fm, "category")) {
      const cat = normalizeCategory(fm.category)
      if (!cat.ok) {
        return { ok: false, message: `SKILL.md: ${cat.message}` }
      }
    }
    const manifest = {
      name,
      description: desc,
      ...fm,
    }
    return {
      ok: true,
      data: {
        manifest,
        readme: parsed.content.trim() || null,
        fileTree,
      },
    }
  }

  const extPath = entries.find(
    (e) =>
      e === "xopc.extension.json" || e.endsWith("/xopc.extension.json"),
  )
  if (!extPath) {
    return { ok: false, message: "xopc.extension.json not found in archive" }
  }
  let json: unknown
  try {
    json = JSON.parse(zip.readAsText(extPath))
  } catch {
    return { ok: false, message: "xopc.extension.json is not valid JSON" }
  }
  if (!json || typeof json !== "object") {
    return { ok: false, message: "xopc.extension.json must be an object" }
  }
  const obj = json as Record<string, unknown>
  const id = obj.id
  const name = obj.name
  const kind = obj.kind
  if (typeof id !== "string" || typeof name !== "string" || kind === undefined) {
    return {
      ok: false,
      message: "xopc.extension.json must include id, name, and kind fields",
    }
  }
  if (name !== expectedName && id !== expectedName) {
    return {
      ok: false,
      message: `Package name mismatch: extension id/name must match "${expectedName}"`,
    }
  }
  if (Object.hasOwn(obj, "category")) {
    const cat = normalizeCategory(obj.category)
    if (!cat.ok) {
      return { ok: false, message: `xopc.extension.json: ${cat.message}` }
    }
  }
  const readmePath = entries.find(
    (e) => e === "README.md" || e.endsWith("/README.md"),
  )
  const readme = readmePath
    ? zip.readAsText(readmePath).trim() || null
    : null
  return {
    ok: true,
    data: {
      manifest: obj,
      readme,
      fileTree,
    },
  }
}

export function assertValidSemver(version: string): string | null {
  const v = semver.valid(version)
  if (!v) return "Invalid semver version"
  return null
}
