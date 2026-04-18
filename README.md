# xopc-store

[**xopc**](https://github.com/xopcai/xopc)（超轻量级个人 AI 助手）生态中 **Extension / Skill** 的包发布、审核与分发侧实现：本仓库提供商店用的 Web 前端与 HTTP API，供用户浏览、开发者上传并与 xopc 侧的扩展／技能包格式对接。

若你在本机同时开发 xopc 与本项目，常见做法是并列克隆，例如 `xopc` 与 `xopc-store` 两个目录同级，在各自仓库内分别安装依赖与启动服务。

> xopc 仓库：<https://github.com/xopcai/xopc>

## 技术栈

| 层级 | 说明 |
|------|------|
| 前端 `apps/web` | React 19、Vite 6、TanStack Router & Query、Tailwind CSS 4 |
| 后端 `apps/server` | Hono 4、Node.js、`better-sqlite3`、Drizzle、GitHub OAuth（jose） |
| 共享 `packages/shared` | API 类型与错误码（TypeScript） |

运行环境要求：**Node.js ≥ 22**、**pnpm 9**（见根目录 `packageManager`）。

## 快速开始

```bash
pnpm install
cp .env.example apps/server/.env
# 按需填写 GITHUB_*、JWT_SECRET 等
pnpm dev
```

- 前端开发地址：<http://localhost:5173>（Vite 将 `/api`、`/files` 代理到后端）
- 后端默认：<http://127.0.0.1:3000>，`GET /health` 返回 `{ ok: true }`

## 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 并行启动 web + server |
| `pnpm dev:web` / `pnpm dev:server` | 仅前端或仅后端 |
| `pnpm build` | 工作区内各包 build |
| `pnpm lint` | TypeScript 检查 |
| `pnpm db:generate` | 生成 Drizzle 迁移（在 `apps/server`） |
| `pnpm db:push` | 将 schema 推到数据库（开发用） |

## 仓库结构

```
apps/
  server/    # HTTP API、认证、包与审核逻辑
  web/       # 商店前端
packages/
  shared/    # 前后端共享类型
deploy/      # 部署相关示例（如 PM2、Nginx）
```

## 许可证

若根目录未包含许可证文件，以仓库后续补充为准。
