import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("./data/store.db"),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GITHUB_CALLBACK_URL: z.string().url(),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  STORAGE_LOCAL_DIR: z.string().default("./data/packages"),
  /** Public base URL for stored files, e.g. https://store.xopc.ai/files */
  STORAGE_LOCAL_BASE_URL: z.string().url().optional(),
})

export type Env = Omit<z.infer<typeof envSchema>, "STORAGE_LOCAL_BASE_URL"> & {
  STORAGE_LOCAL_BASE_URL: string
}

let cached: Env | null = null

export function loadEnv(): Env {
  if (cached) return cached
  const raw = envSchema.parse(process.env)
  const base =
    raw.STORAGE_LOCAL_BASE_URL ??
    `http://127.0.0.1:${raw.PORT}/files`
  cached = { ...raw, STORAGE_LOCAL_BASE_URL: base }
  return cached
}
