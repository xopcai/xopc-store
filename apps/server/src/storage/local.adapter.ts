import type { StorageAdapter } from "@xopc-store/shared"
import fs from "node:fs/promises"
import path from "node:path"

export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly baseDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  private resolvePath(key: string): string {
    const normalized = key.replace(/^\/+/, "")
    const full = path.join(this.baseDir, normalized)
    if (!full.startsWith(path.resolve(this.baseDir))) {
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
