import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { loadEnv } from "./lib/env.js"
import { jwtSecretBytes } from "./lib/jwt.js"
import { createDb } from "./db/index.js"
import { LocalStorageAdapter } from "./storage/local.adapter.js"
import { createAuthRoutes } from "./routes/auth.js"
import { createPackageRoutes } from "./routes/packages.js"
import { createDeveloperRoutes } from "./routes/developer.js"
import { createAdminRoutes } from "./routes/admin.js"
import { createFilesRoutes } from "./routes/files.js"
import { authMiddleware, requireAdmin } from "./middleware/auth.js"

const env = loadEnv()
const jwtSecret = jwtSecretBytes(env)
const db = createDb(env.DATABASE_URL)
const storage = new LocalStorageAdapter(
  env.STORAGE_LOCAL_DIR,
  env.STORAGE_LOCAL_BASE_URL,
)

const app = new Hono()

app.use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["Content-Length"],
  }),
)

app.route("/files", createFilesRoutes(env))
app.route("/api/v1/auth", createAuthRoutes(db, env, jwtSecret))
app.route("/api/v1/packages", createPackageRoutes(db, storage))

const developer = new Hono()
developer.use("*", authMiddleware(db, jwtSecret))
developer.route("/", createDeveloperRoutes(db, storage))
app.route("/api/v1/developer", developer)

const admin = new Hono()
admin.use("*", authMiddleware(db, jwtSecret))
admin.use("*", requireAdmin())
admin.route("/", createAdminRoutes(db))
app.route("/api/v1/admin", admin)

app.get("/health", (c) => c.json({ ok: true }))

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`xopc-store API listening on http://127.0.0.1:${info.port}`)
})
