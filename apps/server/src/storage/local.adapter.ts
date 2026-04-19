import type { StorageAdapter } from "@xopc-store/shared"
import fs from "node:fs/promises"
import path from "node:path"

export class LocalStorageAdapter implements StorageAdapter {
  /** Canonical absolute root; avoids cwd/symlink edge cases vs string prefix checks. */
  private readonly rootAbs: string

  constructor(baseDir: string, private readonly publicBaseUrl: string) {
    this.rootAbs = path.resolve(baseDir)
  }

  private resolvePath(key: string): string {
    const normalized = key.replace(/^\/+/, "").trim()
    if (!normalized || normalized.includes("\0")) {
      throw new Error("Invalid storage key")
    }
    const full = path.normalize(path.resolve(this.rootAbs, normalized))
    const rel = path.relative(this.rootAbs, full)
    if (rel === "" || rel.startsWith("..")) {
      throw new Error("Invalid storage key")
    }
    if (process.platform === "win32" && path.isAbsolute(rel)) {
      throw new Error("Invalid storage key")
    }
    return full
  }

  async upload(key: string, data: Uint8Array, _mimeType: string): Promise<void> {
    const filePath = this.resolvePath(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, data)
  }

  async download(key: string): Promise<Uint8Array> {
    return fs.readFile(this.resolvePath(key))
  }

  getPublicUrl(key: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, "")
    const k = key.replace(/^\/+/, "")
    return `${base}/${k}`
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.resolvePath(key)).catch(() => {})
  }
}
