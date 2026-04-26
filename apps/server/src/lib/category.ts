const MAX_CATEGORY_LEN = 64

export type CategoryNormalizeResult =
  | { ok: true; category: string | null }
  | { ok: false; message: string }

/**
 * Optional category from manifest. Missing/null → null. Invalid type or
 * empty/too long → error (for pack scan).
 */
export function normalizeCategory(value: unknown): CategoryNormalizeResult {
  if (value === undefined || value === null) {
    return { ok: true, category: null }
  }
  if (typeof value !== "string") {
    return { ok: false, message: "category must be a string" }
  }
  const t = value.trim()
  if (!t) {
    return { ok: false, message: "category cannot be empty" }
  }
  if (t.length > MAX_CATEGORY_LEN) {
    return {
      ok: false,
      message: `category must be at most ${MAX_CATEGORY_LEN} characters`,
    }
  }
  return { ok: true, category: t }
}

/** For approve path: never throws; bad or missing category → null. */
export function categoryFromManifestJson(manifestJson: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const c = (parsed as Record<string, unknown>).category
  const r = normalizeCategory(c)
  if (!r.ok) return null
  return r.category
}
