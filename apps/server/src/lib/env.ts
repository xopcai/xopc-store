import "dotenv/config"
import path from "node:path"
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
})

export type Env = z.infer<typeof envSchema> & {
  STORAGE_LOCAL_BASE_URL: string
}

let cached: Env | null = null

export function loadEnv(): Env {
  if (cached) return cached
  const raw = envSchema.parse(process.env)
  const STORAGE_LOCAL_DIR = path.resolve(process.cwd(), raw.STORAGE_LOCAL_DIR)
  const STORAGE_LOCAL_BASE_URL = `${raw.FRONTEND_URL.replace(/\/$/, "")}/files`
  cached = { ...raw, STORAGE_LOCAL_DIR, STORAGE_LOCAL_BASE_URL }
  return cached
}
